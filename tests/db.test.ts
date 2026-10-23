import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createBackup, listBackups, newestGoodBackup, rotateBackups, verifyBackup } from "../src/main/db/backup";
import { DbCorruptError, openFile, type Db } from "../src/main/db/connection";
import { runMigrations, schemaVersion } from "../src/main/db/migrate";
import { MIGRATIONS, TABLES, type Migration } from "../src/main/db/migrations";
import { createRepos } from "../src/main/db/repos";
import { tempDir } from "./helpers";

const open: Db[] = [];
function fresh(file = join(tempDir(), "studio.db")): Db {
	const d = openFile(file);
	open.push(d);
	return d;
}
afterEach(() => {
	for (const d of open.splice(0)) if (d.isOpen) d.close();
});

const tables = (d: Db) =>
	(d.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]).map((r) => r.name);

describe("migrations", () => {
	it("create every table on a fresh profile", async () => {
		const d = fresh();
		const r = await runMigrations(d, MIGRATIONS);
		expect(r.from).toBe(0);
		expect(r.to).toBe(MIGRATIONS.at(-1)!.version);
		expect(tables(d).sort()).toEqual([...TABLES].sort());
		expect((d.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number }).foreign_keys).toBe(1);
		expect((d.prepare("PRAGMA journal_mode").get() as { journal_mode: string }).journal_mode).toBe("wal");
	});

	it("do nothing when the schema is current", async () => {
		const d = fresh();
		await runMigrations(d, MIGRATIONS);
		let backups = 0;
		const r = await runMigrations(d, MIGRATIONS, async () => backups++);
		expect(r.applied).toEqual([]);
		expect(backups).toBe(0);
	});

	it("skip the backup on an empty database", async () => {
		let backups = 0;
		await runMigrations(fresh(), MIGRATIONS, async () => backups++);
		expect(backups).toBe(0);
	});

	it("write a verified backup before migrating an existing database", async () => {
		const dir = tempDir();
		const backupDir = join(dir, "backups");
		const d = fresh(join(dir, "studio.db"));
		await runMigrations(d, MIGRATIONS);
		createRepos(() => d).drafts.create({ title: "Photosynthesis", level: "Grade 6" });

		const next: Migration = { version: MIGRATIONS.length + 1, name: "probe", sql: "ALTER TABLE drafts ADD COLUMN probe TEXT;" };
		const events: string[] = [];
		await runMigrations(d, [...MIGRATIONS, next], async () => {
			// At backup time the new migration has not run yet.
			events.push(`backup@v${schemaVersion(d)}`);
			await createBackup(d, backupDir, "pre-migration");
		});
		events.push(`after@v${schemaVersion(d)}`);
		expect(events).toEqual([`backup@v${MIGRATIONS.length}`, `after@v${next.version}`]);

		const [b] = listBackups(backupDir);
		expect(b?.reason).toBe("pre-migration");
		expect(verifyBackup(b!.path)).toBe(true);
		// The backup holds the data as it was before the migration.
		const copy = openFile(b!.path);
		open.push(copy);
		expect(copy.prepare("SELECT title FROM drafts").get()).toEqual({ title: "Photosynthesis" });
		expect(copy.prepare("SELECT name FROM pragma_table_info('drafts') WHERE name = 'probe'").get()).toBeUndefined();
	});

	it("do not migrate when the backup fails", async () => {
		const d = fresh();
		await runMigrations(d, MIGRATIONS);
		createRepos(() => d).settings.set("x", 1);
		const next: Migration = { version: MIGRATIONS.length + 1, name: "probe", sql: "CREATE TABLE probe (id INTEGER);" };
		await expect(
			runMigrations(d, [...MIGRATIONS, next], async () => {
				throw new Error("disk full");
			}),
		).rejects.toThrow("disk full");
		expect(schemaVersion(d)).toBe(MIGRATIONS.length);
		expect(tables(d)).not.toContain("probe");
	});

	it("roll back a failing migration completely", async () => {
		const d = fresh();
		const bad: Migration = { version: 1, name: "bad", sql: "CREATE TABLE a (id INTEGER); CREATE TABLE a (id INTEGER);" };
		await expect(runMigrations(d, [bad])).rejects.toThrow();
		expect(schemaVersion(d)).toBe(0);
		expect(tables(d)).toEqual([]);
	});

	it("refuse a database from a newer app version", async () => {
		const d = fresh();
		d.exec("PRAGMA user_version = 99");
		await expect(runMigrations(d, MIGRATIONS)).rejects.toThrow(/newer than this app/);
	});
});

describe("backups", () => {
	it("keep only the newest files", async () => {
		const dir = tempDir();
		const d = fresh();
		await runMigrations(d, MIGRATIONS);
		for (let i = 0; i < 4; i++) await createBackup(d, dir, "manual");
		expect(listBackups(dir)).toHaveLength(4);
		expect(rotateBackups(dir, 2)).toHaveLength(2);
		expect(listBackups(dir)).toHaveLength(2);
		expect(existsSync(listBackups(dir)[0]!.path + "-wal")).toBe(false);
	});

	it("skip damaged files when looking for a good backup", async () => {
		const dir = tempDir();
		const d = fresh();
		await runMigrations(d, MIGRATIONS);
		const good = await createBackup(d, dir, "manual");
		writeFileSync(join(dir, "studio-2999-01-01T00-00-00-000Z-manual.db"), "not a database");
		expect(newestGoodBackup(dir)?.file).toBe(good.file);
	});

	it("detect a damaged database file on open", () => {
		const file = join(tempDir(), "studio.db");
		writeFileSync(file, Buffer.alloc(8192, 7));
		expect(() => openFile(file)).toThrow(DbCorruptError);
	});
});

describe("repos", () => {
	async function setup() {
		const d = fresh();
		await runMigrations(d, MIGRATIONS);
		return createRepos(() => d);
	}

	it("drafts: create, read, update, delete with JSON fields", async () => {
		const r = await setup();
		const draft = r.drafts.create({ title: "Waterfall vs Agile", level: "Age 10", source: { kind: "text", chars: 120 } });
		expect(draft.id).toMatch(/^[0-9a-f-]{36}$/);
		expect(draft.stage).toBe("source");
		expect(draft.plan).toBeNull();
		expect(r.drafts.get(draft.id)?.source).toEqual({ kind: "text", chars: 120 });

		const plan = { meta: { title: "x" }, chapters: [{ title: "Intro", scenes: [] }] };
		const updated = r.drafts.update(draft.id, { stage: "outline", plan });
		expect(updated?.stage).toBe("outline");
		expect(updated?.plan).toEqual(plan);
		expect(updated!.updatedAt >= draft.updatedAt).toBe(true);
		expect(updated!.createdAt).toBe(draft.createdAt);

		expect(r.drafts.list()).toHaveLength(1);
		expect(r.drafts.count({ stage: "outline" })).toBe(1);
		expect(r.drafts.remove(draft.id)).toBe(true);
		expect(r.drafts.get(draft.id)).toBeNull();
		expect(r.drafts.remove(draft.id)).toBe(false);
		expect(r.drafts.update(draft.id, { title: "gone" })).toBeNull();
	});

	it("series, brand kits and videos keep their links", async () => {
		const r = await setup();
		const kit = r.brandKits.create({ name: "Default", isDefault: true, data: { accent: "#6366f1" } });
		expect(kit.isDefault).toBe(true);
		const series = r.series.create({ title: "Class 11 CS", brandKitId: kit.id });
		const draft = r.drafts.create({ title: "Binary", level: "Class 11", seriesId: series.id });
		const video = r.videos.create({ title: "Binary numbers", filePath: "C:/v.mp4", width: 1920, height: 1080, draftId: draft.id, seriesId: series.id, episode: 1 });
		expect(video.durationMs).toBe(0);
		expect(video.youtube).toEqual({});
		expect(r.videos.list({ where: { seriesId: series.id } })).toHaveLength(1);

		// Deleting the draft keeps the video but clears the link.
		r.drafts.remove(draft.id);
		expect(r.videos.get(video.id)?.draftId).toBeNull();
		// Deleting the brand kit clears it from the series.
		r.brandKits.remove(kit.id);
		expect(r.series.get(series.id)?.brandKitId).toBeNull();
	});

	it("assets: license fields, tags and kind check", async () => {
		const r = await setup();
		const a = r.assets.create({ kind: "sfx", title: "Click", filePath: "C:/a.ogg", source: "kenney", license: "CC0-1.0", tags: ["ui", "click"], sha256: "abc" });
		expect(a.tags).toEqual(["ui", "click"]);
		expect(a.license).toBe("CC0-1.0");
		expect(r.assets.update(a.id, { tags: ["ui"] })?.tags).toEqual(["ui"]);
		expect(() => r.assets.create({ kind: "video" as never, title: "x", filePath: "x", source: "x", license: "x" })).toThrow();
		expect(() => r.assets.create({ kind: "sfx", title: "dupe", filePath: "y", source: "x", license: "x", sha256: "abc" })).toThrow();
		expect(r.assets.remove(a.id)).toBe(true);
	});

	it("jobs: status flow, paging and cascade from drafts", async () => {
		const r = await setup();
		const draft = r.drafts.create({ title: "d", level: "PhD" });
		const ids = [1, 2, 3].map((n) => r.jobs.create({ kind: "render", draftId: draft.id, payload: { n } }).id);
		r.jobs.update(ids[0]!, { status: "running", progress: 0.5, startedAt: new Date().toISOString() });
		expect(r.jobs.get(ids[0]!)?.progress).toBe(0.5);
		expect(r.jobs.list({ where: { status: "queued" } })).toHaveLength(2);
		expect(r.jobs.list({ limit: 2 })).toHaveLength(2);
		expect(r.jobs.list({ limit: 2, offset: 2 })).toHaveLength(1);
		expect(() => r.jobs.update(ids[1]!, { status: "weird" as never })).toThrow();
		r.drafts.remove(draft.id);
		expect(r.jobs.count()).toBe(0);
	});

	it("providers store the sealed key as bytes", async () => {
		const r = await setup();
		const p = r.providers.create({ kind: "openrouter", name: "OpenRouter", secret: new Uint8Array([1, 2, 3]) });
		expect(p.enabled).toBe(true);
		expect(Array.from(r.providers.get(p.id)!.secret!)).toEqual([1, 2, 3]);
		expect(r.providers.update(p.id, { enabled: false })?.enabled).toBe(false);
		expect(r.providers.remove(p.id)).toBe(true);
	});

	it("settings: set, overwrite, read all, remove", async () => {
		const r = await setup();
		expect(r.settings.get("render.fps")).toBeUndefined();
		r.settings.set("render.fps", 30);
		r.settings.set("render.fps", 60);
		r.settings.set("voice", { id: "af_heart", speed: 1 });
		expect(r.settings.get("render.fps")).toBe(60);
		expect(r.settings.all()).toEqual({ "render.fps": 60, voice: { id: "af_heart", speed: 1 } });
		expect(r.settings.remove("voice")).toBe(true);
	});

	it("reject unknown fields instead of building SQL from them", async () => {
		const r = await setup();
		expect(() => r.drafts.list({ where: { "title = '' OR 1=1 --": "x" } as never })).toThrow(/unknown field/);
		expect(() => r.drafts.list({ orderBy: "id; DROP TABLE drafts" as never })).toThrow(/unknown field/);
		// Values are bound, so quotes in data are just data.
		const d = r.drafts.create({ title: "'); DROP TABLE drafts; --", level: "x" });
		expect(r.drafts.get(d.id)?.title).toBe("'); DROP TABLE drafts; --");
		expect(r.drafts.count()).toBe(1);
	});
});
