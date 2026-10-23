import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Main modules import electron; only the session cache calls matter here.
vi.mock("electron", () => ({
	app: { getAppPath: () => process.cwd(), getPath: () => process.cwd(), isPackaged: false },
	shell: { openPath: async () => "", showItemInFolder: () => undefined },
	session: { defaultSession: { getCacheSize: async () => 0, clearCache: async () => undefined } },
	dialog: {},
	clipboard: { writeText: () => undefined },
	BrowserWindow: class {},
	Notification: class {
		static isSupported() {
			return false;
		}
	},
	utilityProcess: { fork: () => ({ on: () => undefined, postMessage: () => undefined, kill: () => undefined }) },
}));

import { BrandKitData, brandStamp, defaultBrandKit, type BrandStamp } from "../src/shared/brand";
import { VideoPlan } from "../src/shared/plan/schema";
import { computeTimeline, sceneAt } from "../src/shared/plan/timing";
import { buildSrt, buildYoutubePack, youtubeChapters } from "../src/shared/render";
import { ensureFolders, folderLayout, setAppFolders } from "../src/main/app/folders";
import { mediaPath } from "../src/main/app/media-url";
import { db, openDatabase } from "../src/main/db/connection";
import { runMigrations } from "../src/main/db/migrate";
import { MIGRATIONS } from "../src/main/db/migrations";
import { repos } from "../src/main/db/repos";
import { clearLogo, createKit, kitForDraft, LOGO_MAX_BYTES, logoType, removeKit, setDefaultKit, setLogo, stampForDraft, updateKit } from "../src/main/brand";
import { duplicateForLevel, listDrafts } from "../src/main/library";
import { addToSeries, createSeries, listSeries, moveEpisode, removeFromSeries, removeSeries, renumber } from "../src/main/series";
import { cleanStorage, findLeftovers, storageReport } from "../src/main/storage";
import { SAMPLE_PLAN } from "../video/src/samples/web-page-journey";
import { tempDir } from "./helpers";

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201a2b5d4f40000000049454e44ae426082", "hex");
const plan = VideoPlan.parse(SAMPLE_PLAN);

function stamped(b: BrandStamp) {
	return VideoPlan.parse({ ...SAMPLE_PLAN, meta: { ...SAMPLE_PLAN.meta, brand: b } });
}

describe("brand kit data", () => {
	it("fills defaults from a channel name and checks colours and lengths", () => {
		const k = defaultBrandKit("Science with Sam");
		expect(k).toMatchObject({ channel: "Science with Sam", logo: null, font: "Inter", intro: { enabled: true, seconds: 3 }, outro: { enabled: true, seconds: 10, endScreen: true }, watermark: { enabled: true, corner: "bottom-right" } });
		expect(BrandKitData.safeParse({ ...k, colors: { ...k.colors, primary: "red" } }).success).toBe(false);
		expect(BrandKitData.safeParse({ ...k, outro: { ...k.outro, seconds: 4 } }).success, "YouTube end screens need 5 s or more").toBe(false);
		expect(BrandKitData.safeParse({ ...k, logo: "../evil.png" }).success).toBe(false);
		expect(BrandKitData.safeParse({ ...k, channel: " " }).success).toBe(false);
	});

	it("stamps only the parts that are switched on", () => {
		const k = defaultBrandKit("Ch");
		expect(brandStamp(k, null)).toMatchObject({ intro: 3, outro: 10, endScreen: true, series: null });
		const off = brandStamp({ ...k, intro: { ...k.intro, enabled: false }, outro: { ...k.outro, enabled: false } }, null, { title: "Unit 2", episode: 4 });
		expect(off).toMatchObject({ intro: 0, outro: 0, endScreen: false, series: { title: "Unit 2", episode: 4 } });
	});
});

describe("timeline with a brand intro and outro", () => {
	const plain = computeTimeline(plan);
	const b = brandStamp(defaultBrandKit("Ch"), null);
	const t = computeTimeline(stamped(b));
	const fps = t.fps;

	it("adds the intro before the first scene and the outro after the last", () => {
		expect(t.intro).toBe(3 * fps);
		expect(t.outro).toBe(10 * fps);
		expect(t.durationInFrames).toBe(plain.durationInFrames + 13 * fps);
		t.scenes.forEach((s, i) => expect(s.from).toBe(plain.scenes[i]!.from + 3 * fps));
	});

	it("keeps the chapters covering every frame, so render parts and YouTube chapters still fit", () => {
		expect(t.chapters[0]!.from).toBe(0);
		const last = t.chapters.at(-1)!;
		expect(last.from + last.durationInFrames).toBe(t.durationInFrames);
		expect(t.chapters.reduce((n, c) => n + c.durationInFrames, 0)).toBe(t.durationInFrames);
		expect(youtubeChapters(t)?.[0]?.ms).toBe(0);
	});

	it("moves the captions with the scenes", () => {
		const first = (srt: string) => /\d\d:\d\d:\d\d,\d{3}/.exec(srt)![0];
		const ms = (s: string) => {
			const [h, m, rest] = s.split(":");
			const [sec, milli] = rest!.split(",");
			return ((Number(h) * 60 + Number(m)) * 60 + Number(sec)) * 1000 + Number(milli);
		};
		expect(ms(first(buildSrt(t))) - ms(first(buildSrt(plain)))).toBe(3000);
	});

	it("shows the first scene in the Studio list during the intro", () => {
		expect(sceneAt(t, 10)?.scene.id).toBe(t.scenes[0]!.scene.id);
	});

	it("names the series episode and the channel in the YouTube text", () => {
		const pack = buildYoutubePack(plan, t, [], { series: { title: "Unit 2", episode: 3 }, channel: "Ch" });
		expect(pack.description).toContain('Episode 3 of the series "Unit 2".');
		expect(pack.description).toContain("Subscribe to Ch");
	});
});

describe("logo files", () => {
	it("accepts PNG, JPEG and WebP by their bytes, never SVG or other files", () => {
		expect(logoType(PNG)).toBe("png");
		expect(logoType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe("jpg");
		expect(logoType(Buffer.from("RIFF\0\0\0\0WEBPVP8 ", "latin1"))).toBe("webp");
		expect(logoType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).toBeNull();
		expect(logoType(Buffer.from("GIF89a"))).toBeNull();
		expect(logoType(Buffer.from([]))).toBeNull();
	});

	it("serves only logo names from the brand folder", () => {
		const roots = { drafts: "D:/d", assets: "D:/a" };
		const kit = "0b4c3f62-0000-4000-8000-000000000001";
		expect(mediaPath(`es-media://brand/${kit}/logo-0123abcd.png`, roots)).toBe(join("D:/a", "brand", kit, "logo-0123abcd.png"));
		for (const bad of [`es-media://brand/${kit}/../../secret.png`, `es-media://brand/${kit}/logo.svg`, `es-media://brand/not-a-uuid/logo-0123abcd.png`, `es-media://brand/${kit}/logo-0123abcd.png?x=1`, `es-media://brand/${kit}/sub/logo-0123abcd.png`])
			expect(mediaPath(bad, roots), bad).toBeNull();
	});
});

describe("brand kits, series, level copies and storage (app database)", () => {
	let root = "";
	const draft = (title: string, extra: Record<string, unknown> = {}) =>
		repos.drafts.create({ title, level: "High school", stage: "preview", source: { title, sections: [] }, plan, settings: { level: "High school", language: "en", tone: "Friendly", targetMinutes: null, style: "auto" }, ...extra });

	beforeAll(async () => {
		root = tempDir("es-creator-");
		setAppFolders(ensureFolders(folderLayout(root)));
		openDatabase(join(root, "data", "studio.db"));
		await runMigrations(db(), MIGRATIONS);
	});
	afterAll(() => db().close());

	it("migration 6 adds episode numbers to drafts", () => {
		const cols = (db().prepare("PRAGMA table_info(drafts)").all() as { name: string }[]).map((c) => c.name);
		expect(cols).toContain("episode");
	});

	it("uses the default kit for renders; a series kit wins over it", () => {
		const d = draft("Plain");
		expect(stampForDraft(d)).toBeNull();
		const a = createKit("Main", defaultBrandKit("Main channel"));
		expect(a.isDefault).toBe(true);
		const b = createKit("Kids", { ...defaultBrandKit("Kids corner"), colors: { primary: "#ff0000", secondary: "#00ff00", accent: "#0000ff", dark: true } });
		expect(b.isDefault).toBe(false);
		expect(stampForDraft(repos.drafts.get(d.id)!)?.channel).toBe("Main channel");
		const s = createSeries({ title: "Kids series", description: "", brandKitId: b.id });
		addToSeries(s.id, d.id, false);
		const stamp = stampForDraft(repos.drafts.get(d.id)!)!;
		expect(stamp.channel).toBe("Kids corner");
		expect(stamp.colors.dark).toBe(true);
		expect(stamp.series).toEqual({ title: "Kids series", episode: 1 });
		removeSeries(s.id);
		setDefaultKit(b.id);
		expect(kitForDraft(repos.drafts.get(d.id)!)?.id).toBe(b.id);
		expect(repos.brandKits.get(a.id)?.isDefault).toBe(false);
	});

	it("copies a picked logo in by its bytes and refuses other files", async () => {
		const k = createKit("Logo test", defaultBrandKit("Logo channel"));
		const png = join(root, "logo.PNG");
		writeFileSync(png, PNG);
		const v = await setLogo(k.id, png);
		expect(v.data.logo).toMatch(/^logo-[0-9a-f]{8}\.png$/);
		expect(v.logoUrl).toBe(`es-media://brand/${k.id}/${v.data.logo}`);
		expect(existsSync(join(root, "assets", "brand", k.id, v.data.logo!))).toBe(true);
		// The form never changes the logo.
		expect(updateKit(k.id, "Renamed", { ...v.data, logo: null, channel: "New name" }).data.logo).toBe(v.data.logo);

		const svg = join(root, "logo.png");
		writeFileSync(svg, '<svg xmlns="http://www.w3.org/2000/svg"/>');
		await expect(setLogo(k.id, svg)).rejects.toThrow(/not a PNG, JPEG or WebP/);
		const big = join(root, "big.png");
		writeFileSync(big, Buffer.concat([PNG, Buffer.alloc(LOGO_MAX_BYTES)]));
		await expect(setLogo(k.id, big)).rejects.toThrow(/bigger than 5 MB/);

		expect((await clearLogo(k.id)).logoUrl).toBeNull();
		expect(existsSync(join(root, "assets", "brand", k.id))).toBe(false);
		await removeKit(k.id);
		expect(repos.brandKits.get(k.id)).toBeNull();
	});

	it("deleting the default kit makes another kit the default", async () => {
		const def = repos.brandKits.list().find((k) => k.isDefault)!;
		await removeKit(def.id);
		expect(repos.brandKits.list().filter((k) => k.isDefault)).toHaveLength(1);
	});

	it("numbers episodes, shares the look, and renumbers after moves and removals", () => {
		const s = createSeries({ title: "Class 11 CS – Unit 2", description: "Data structures", brandKitId: null });
		const first = draft("Arrays");
		const firstPlan = { ...plan, meta: { ...plan.meta, style: "chalkboard" as const } };
		repos.drafts.update(first.id, { plan: firstPlan, voice: { voice: "bf_emma", speed: 1.1, lexicon: [] } });
		const second = draft("Linked lists");
		const third = draft("Stacks");

		let v = addToSeries(s.id, first.id, true);
		expect(v.look).toEqual({ style: "chalkboard", voice: { voice: "bf_emma", speed: 1.1, lexicon: [] } });
		v = addToSeries(s.id, second.id, true);
		v = addToSeries(s.id, third.id, false);
		expect(v.episodes.map((e) => [e.title, e.episode])).toEqual([
			["Arrays", 1],
			["Linked lists", 2],
			["Stacks", 3],
		]);
		// Episode 2 took the series look; episode 3 kept its own.
		expect((repos.drafts.get(second.id)!.plan as VideoPlan).meta.style).toBe("chalkboard");
		expect(repos.drafts.get(second.id)!.voice).toEqual({ voice: "bf_emma", speed: 1.1, lexicon: [] });
		expect((repos.drafts.get(third.id)!.plan as VideoPlan).meta.style).toBe(plan.meta.style);

		v = moveEpisode(third.id, -1);
		expect(v.episodes.map((e) => e.title)).toEqual(["Arrays", "Stacks", "Linked lists"]);
		expect(listDrafts().find((d) => d.id === third.id)?.series).toEqual({ id: s.id, title: "Class 11 CS – Unit 2", episode: 2 });

		removeFromSeries(first.id);
		v = listSeries().find((x) => x.id === s.id)!;
		expect(v.episodes.map((e) => [e.title, e.episode])).toEqual([
			["Stacks", 1],
			["Linked lists", 2],
		]);
		expect(repos.drafts.get(first.id)).toMatchObject({ seriesId: null, episode: null });

		// A deleted episode leaves no gap.
		const fourth = draft("Queues");
		addToSeries(s.id, fourth.id, false);
		repos.drafts.remove(second.id);
		renumber(s.id);
		expect(listSeries().find((x) => x.id === s.id)!.episodes.map((e) => [e.title, e.episode])).toEqual([
			["Stacks", 1],
			["Queues", 2],
		]);

		removeSeries(s.id);
		expect(repos.drafts.get(third.id)).toMatchObject({ seriesId: null, episode: null });
	});

	it("makes a version for another level: same material and figures, no outline or script", async () => {
		const src = draft("Photosynthesis (copy)", { outline: { title: "x" }, report: { ok: true }, voice: { voice: "af_heart", speed: 1, lexicon: [] } });
		const figs = join(root, "drafts", src.id, "source", "figures");
		mkdirSync(figs, { recursive: true });
		writeFileSync(join(figs, "in1-001.png"), PNG);
		mkdirSync(join(root, "drafts", src.id, "voice"), { recursive: true });
		writeFileSync(join(root, "drafts", src.id, "voice", "a.wav"), "x");

		const id = await duplicateForLevel(src.id, "Kindergarten");
		const d = repos.drafts.get(id)!;
		expect(d).toMatchObject({ title: "Photosynthesis (Kindergarten version)", level: "Kindergarten", stage: "source", outline: null, plan: null, report: null, voice: null, seriesId: null, episode: null });
		expect(d.settings).toMatchObject({ level: "Kindergarten", language: "en", tone: "Friendly" });
		expect(d.source).toEqual(src.source);
		expect(readdirSync(join(root, "drafts", id, "source", "figures"))).toEqual(["in1-001.png"]);
		expect(existsSync(join(root, "drafts", id, "voice")), "voice clips are for the old script").toBe(false);
		// The first draft is unchanged.
		expect(repos.drafts.get(src.id)).toMatchObject({ level: "High school", outline: { title: "x" } });
	});

	it("finds leftover folders, keeps folders a render job still owns", async () => {
		const known = draft("Known");
		const leftDraft = "11111111-2222-4333-8444-555555555555";
		const ownedVideo = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
		const leftVideo = "99999999-8888-4777-8666-555555555555";
		for (const p of [join(root, "drafts", known.id), join(root, "drafts", leftDraft, "voice"), join(root, "videos", ownedVideo, ".work"), join(root, "videos", leftVideo), join(root, "videos", "not-a-uuid")]) mkdirSync(p, { recursive: true });
		writeFileSync(join(root, "drafts", leftDraft, "voice", "x.wav"), Buffer.alloc(1000));
		writeFileSync(join(root, "videos", leftVideo, "video.mp4"), Buffer.alloc(3000));
		writeFileSync(join(root, "videos", ownedVideo, ".work", "input.json"), "{}");
		// A failed render keeps its folder for a retry.
		repos.jobs.create({ kind: "render", status: "error", draftId: known.id, payload: { videoId: ownedVideo } });

		const found = await findLeftovers({ drafts: join(root, "drafts"), videos: join(root, "videos"), draftIds: new Set(repos.drafts.list().map((d) => d.id)), videoIds: new Set(), keepVideoIds: new Set([ownedVideo]) });
		expect(found.sort()).toEqual([join(root, "drafts", leftDraft), join(root, "videos", leftVideo)].sort());

		mkdirSync(join(root, "cache", "voice-preview"), { recursive: true });
		writeFileSync(join(root, "cache", "voice-preview", "p.wav"), Buffer.alloc(2500));
		writeFileSync(join(root, "cache", "model-prices.json"), Buffer.alloc(500));
		// Chromium's own web cache lives in the same folder on Windows: never deleted as files.
		mkdirSync(join(root, "cache", "Cache_Data"), { recursive: true });
		writeFileSync(join(root, "cache", "Cache_Data", "data_0"), Buffer.alloc(800));

		const before = await storageReport();
		expect(before.cleanups.find((c) => c.id === "cache")).toMatchObject({ bytes: 3000, files: 2, blocked: null });
		expect(before.cleanups.find((c) => c.id === "leftovers")).toMatchObject({ bytes: 4000, files: 2 });
		expect(before.areas.map((a) => a.area)).toContain("videos");

		const r = await cleanStorage(["cache", "leftovers"]);
		expect(r).toEqual({ freedBytes: 7000, removedFiles: 4, skipped: [] });
		expect(readdirSync(join(root, "cache"))).toEqual(["Cache_Data"]);
		expect(existsSync(join(root, "drafts", leftDraft))).toBe(false);
		expect(existsSync(join(root, "videos", leftVideo))).toBe(false);
		expect(existsSync(join(root, "videos", ownedVideo, ".work", "input.json")), "owned by a failed render").toBe(true);
		expect(existsSync(join(root, "drafts", known.id))).toBe(true);
		expect(existsSync(join(root, "videos", "not-a-uuid")), "only uuid folders are ever removed").toBe(true);
		const after = await storageReport();
		expect(after.cleanups.find((c) => c.id === "leftovers")?.bytes).toBe(0);
	});
});
