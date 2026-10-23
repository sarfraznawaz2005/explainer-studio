import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { crc32, deflateRawSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { attributionFor, classifyLicense, LicenseError, SoundSetup } from "../src/shared/assets";
import { mediaPath } from "../src/main/app/media-url";
import { audioDurationMs, sniff } from "../src/main/assets/audio-meta";
import { importFreesound, searchFreesound } from "../src/main/assets/freesound";
import { createAssetLibrary } from "../src/main/assets/library";
import { installStarter, starterInstalled, type StarterPack } from "../src/main/assets/starter";
import { STARTER_MUSIC, STARTER_ROLES, STARTER_ZIPS } from "../src/main/assets/starter-manifest";
import { readZipEntry, ZipError } from "../src/main/assets/zip";
import { openFile, type Db } from "../src/main/db/connection";
import { runMigrations } from "../src/main/db/migrate";
import { MIGRATIONS } from "../src/main/db/migrations";
import { createRepos } from "../src/main/db/repos";
import { tempDir } from "./helpers";

/* ---------- Fixtures ---------- */

/** 16-bit mono PCM WAV of a given length. */
function wav(ms: number, rate = 8000): Buffer {
	const samples = Math.round((ms / 1000) * rate);
	const b = Buffer.alloc(44 + samples * 2);
	b.write("RIFF", 0, "latin1");
	b.writeUInt32LE(36 + samples * 2, 4);
	b.write("WAVEfmt ", 8, "latin1");
	b.writeUInt32LE(16, 16);
	b.writeUInt16LE(1, 20);
	b.writeUInt16LE(1, 22);
	b.writeUInt32LE(rate, 24);
	b.writeUInt32LE(rate * 2, 28);
	b.writeUInt16LE(2, 32);
	b.writeUInt16LE(16, 34);
	b.write("data", 36, "latin1");
	b.writeUInt32LE(samples * 2, 40);
	for (let i = 0; i < samples; i++) b.writeInt16LE(Math.round(Math.sin(i / (3 + (ms % 7))) * 8000), 44 + i * 2);
	return b;
}

/** CBR MP3: n silent MPEG-1 Layer III frames, 128 kbps, 44.1 kHz. */
function mp3(n: number): Buffer {
	const frame = Buffer.alloc(417);
	frame.set([0xff, 0xfb, 0x90, 0x00]);
	return Buffer.concat(Array.from({ length: n }, () => frame));
}

/** A ZIP with stored and deflated entries. */
function zip(files: { name: string; data: Buffer; deflate?: boolean; badCrc?: boolean }[]): Buffer {
	const locals: Buffer[] = [];
	const centrals: Buffer[] = [];
	let offset = 0;
	for (const f of files) {
		const body = f.deflate ? deflateRawSync(f.data) : f.data;
		const name = Buffer.from(f.name);
		const crc = (crc32(f.data) ^ (f.badCrc ? 1 : 0)) >>> 0;
		const lh = Buffer.alloc(30);
		lh.writeUInt32LE(0x04034b50, 0);
		lh.writeUInt16LE(20, 4);
		lh.writeUInt16LE(f.deflate ? 8 : 0, 8);
		lh.writeUInt32LE(crc, 14);
		lh.writeUInt32LE(body.length, 18);
		lh.writeUInt32LE(f.data.length, 22);
		lh.writeUInt16LE(name.length, 26);
		const ch = Buffer.alloc(46);
		ch.writeUInt32LE(0x02014b50, 0);
		ch.writeUInt16LE(20, 4);
		ch.writeUInt16LE(20, 6);
		ch.writeUInt16LE(f.deflate ? 8 : 0, 10);
		ch.writeUInt32LE(crc, 16);
		ch.writeUInt32LE(body.length, 20);
		ch.writeUInt32LE(f.data.length, 24);
		ch.writeUInt16LE(name.length, 28);
		ch.writeUInt32LE(offset, 42);
		locals.push(lh, name, body);
		centrals.push(ch, name);
		offset += 30 + name.length + body.length;
	}
	const cd = Buffer.concat(centrals);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(files.length, 8);
	end.writeUInt16LE(files.length, 10);
	end.writeUInt32LE(cd.length, 12);
	end.writeUInt32LE(offset, 16);
	return Buffer.concat([...locals, cd, end]);
}

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

/* ---------- Database per test ---------- */

const open: Db[] = [];
afterEach(() => {
	for (const d of open.splice(0)) if (d.isOpen) d.close();
});

async function setup() {
	const dir = tempDir("es-assets-");
	const d = openFile(join(dir, "studio.db"));
	open.push(d);
	await runMigrations(d, MIGRATIONS);
	const repos = createRepos(() => d);
	const root = join(dir, "assets");
	const lib = createAssetLibrary({ repos, root: () => root });
	return { dir, repos, root, lib };
}

/* ---------- Licenses ---------- */

describe("license gate", () => {
	it("allows CC0, public domain and CC BY", () => {
		for (const [raw, code] of [
			["Creative Commons 0", "CC0-1.0"],
			["http://creativecommons.org/publicdomain/zero/1.0/", "CC0-1.0"],
			["https://creativecommons.org/publicdomain/zero/1.0/", "CC0-1.0"],
			["Attribution", "CC-BY-4.0"],
			["http://creativecommons.org/licenses/by/3.0/", "CC-BY-3.0"],
			["https://creativecommons.org/licenses/by/4.0/", "CC-BY-4.0"],
			["CC BY 4.0", "CC-BY-4.0"],
			["Public domain", "PD"],
			["OWNED", "OWNED"],
		] as const)
			expect(classifyLicense(raw), raw).toEqual({ ok: true, code });
	});

	it("refuses NonCommercial in every spelling", () => {
		for (const raw of [
			"Attribution NonCommercial",
			"Attribution Noncommercial",
			"http://creativecommons.org/licenses/by-nc/3.0/",
			"https://creativecommons.org/licenses/by-nc/4.0/",
			"https://creativecommons.org/licenses/by-nc-sa/4.0/",
			"https://creativecommons.org/licenses/by-nc-nd/4.0/",
			"CC BY-NC 4.0",
			"cc-by-nc",
			"Non-commercial use only",
		]) {
			const v = classifyLicense(raw);
			expect(v.ok, raw).toBe(false);
			if (!v.ok) expect(v.reason, raw).toMatch(/NonCommercial/);
		}
	});

	it("refuses ShareAlike, NoDerivatives, Sampling+ and unknown licenses", () => {
		for (const raw of ["https://creativecommons.org/licenses/by-sa/4.0/", "https://creativecommons.org/licenses/by-nd/4.0/", "Sampling+", "GPL", "", null, "All rights reserved"])
			expect(classifyLicense(raw).ok, String(raw)).toBe(false);
	});

	it("writes a credit line only when the license needs one", () => {
		expect(attributionFor({ title: "Rain", author: "Ana", license: "CC-BY-4.0", sourceUrl: "https://freesound.org/s/1/" })).toBe(
			'"Rain" by Ana (https://freesound.org/s/1/), licensed under CC BY 4.0: https://creativecommons.org/licenses/by/4.0/',
		);
		expect(attributionFor({ title: "Rain", author: "Ana", license: "CC0-1.0", sourceUrl: null })).toBeNull();
	});
});

/* ---------- File readers ---------- */

describe("audio and zip readers", () => {
	it("measure WAV and MP3 and spot the real file type", () => {
		expect(audioDurationMs(wav(1500))).toEqual({ ext: "wav", durationMs: 1500 });
		const m = audioDurationMs(mp3(200));
		expect(m?.ext).toBe("mp3");
		expect(m?.durationMs).toBe(Math.round((200 * 1152 * 1000) / 44100));
		expect(audioDurationMs(Buffer.from("this is not audio at all"))).toBeNull();
		expect(sniff(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]))).toBe("png");
	});

	it("read stored and deflated entries by exact name, and refuse damaged ones", () => {
		const a = Buffer.from("hello ".repeat(100));
		const z = zip([
			{ name: "License.txt", data: a },
			{ name: "Audio/pop.wav", data: wav(200), deflate: true },
			{ name: "../../evil.txt", data: a },
			{ name: "bad.bin", data: a, deflate: true, badCrc: true },
		]);
		expect(readZipEntry(z, "License.txt").equals(a)).toBe(true);
		expect(audioDurationMs(readZipEntry(z, "Audio/pop.wav"))?.durationMs).toBe(200);
		// A path-like name is just a name: it is only ever compared, never written to disk.
		expect(readZipEntry(z, "../../evil.txt").equals(a)).toBe(true);
		expect(() => readZipEntry(z, "bad.bin")).toThrow(/damaged/);
		expect(() => readZipEntry(z, "missing.ogg")).toThrow(ZipError);
		expect(() => readZipEntry(z, "License.txt", 10)).toThrow(/too large/);
		expect(() => readZipEntry(Buffer.from("nope nope nope nope nope nope"), "x")).toThrow(/Not a ZIP/);
	});
});

/* ---------- Library ---------- */

describe("asset library", () => {
	it("refuses NC-licensed files and never stores them", async () => {
		const { lib, repos, root } = await setup();
		for (const license of ["Attribution NonCommercial", "https://creativecommons.org/licenses/by-nc/4.0/", "CC BY-NC-SA 4.0"]) {
			await expect(lib.add({ kind: "sfx", title: "Nope", bytes: wav(300), source: "import", license, author: "X" })).rejects.toThrow(LicenseError);
		}
		expect(repos.assets.count()).toBe(0);
		expect(existsSync(join(root, "library")) ? readdirSync(join(root, "library")) : []).toEqual([]);
	});

	it("needs an author for CC BY and writes the credit", async () => {
		const { lib } = await setup();
		await expect(lib.add({ kind: "sfx", title: "Rain", bytes: wav(300), source: "import", license: "CC-BY-4.0" })).rejects.toThrow(/author/);
		const { asset } = await lib.add({ kind: "sfx", title: "Rain", bytes: wav(300), source: "import", license: "CC-BY-4.0", author: "Ana" });
		expect(asset.license).toBe("CC-BY-4.0");
		expect(asset.attribution).toContain('"Rain" by Ana');
		expect(asset.durationMs).toBe(300);
	});

	it("checks the real file type and length", async () => {
		const { lib } = await setup();
		await expect(lib.add({ kind: "music", title: "Fake", bytes: Buffer.from("MZ this is an exe renamed to mp3 ......"), source: "import", license: "OWNED" })).rejects.toThrow(/not a supported/);
		await expect(lib.add({ kind: "image", title: "Song as image", bytes: wav(300), source: "import", license: "OWNED" })).rejects.toThrow(/not a supported/);
		await expect(lib.add({ kind: "sfx", title: "Long", bytes: wav(31_000, 2000), source: "import", license: "OWNED" })).rejects.toThrow(/shorter than 30 seconds/);
	});

	it("stores each file once and drafts share it by id", async () => {
		const { lib, repos, root } = await setup();
		const bytes = mp3(300);
		const first = await lib.add({ kind: "music", title: "Theme", bytes, source: "import", license: "CC0-1.0" });
		const again = await lib.add({ kind: "music", title: "Theme (copy)", bytes, source: "import", license: "CC0-1.0" });
		expect(first.existed).toBe(false);
		expect(again.existed).toBe(true);
		expect(again.asset.id).toBe(first.asset.id);
		expect(readdirSync(join(root, "library"))).toEqual([first.asset.filePath]);
		expect(first.asset.filePath).toBe(`${sha(bytes).slice(0, 32)}.mp3`);
		// Two drafts point at the same asset; no copies in their folders.
		const setupWith = SoundSetup.parse({ music: { picks: { ch1: first.asset.id } } });
		repos.drafts.create({ title: "Cells", level: "Grade 6", audio: setupWith });
		repos.drafts.create({ title: "Atoms", level: "Grade 9", audio: setupWith });
		expect(lib.usage(first.asset.id).sort()).toEqual(["Atoms", "Cells"]);
		// The library URL resolves to the one stored file.
		const view = lib.view(first.asset);
		expect(mediaPath(view.url, { drafts: join(root, "x"), assets: root })).toBe(join(root, "library", first.asset.filePath));
		expect(await lib.remove(first.asset.id)).toBe(true);
		expect(readdirSync(join(root, "library"))).toEqual([]);
	});

	it("edits tags, mood, energy, BPM and favourites", async () => {
		const { lib } = await setup();
		const { asset } = await lib.add({ kind: "music", title: "Theme", bytes: mp3(100), source: "import", license: "CC0-1.0" });
		const a = lib.update(asset.id, { mood: "curious", energy: "high", bpm: 120, favorite: true, tags: ["Piano", "piano", "Bright"] });
		expect(lib.view(a)).toMatchObject({ mood: "curious", energy: "high", bpm: 120, favorite: true, tags: ["piano", "bright"] });
	});
});

/* ---------- Starter pack ---------- */

describe("starter pack", () => {
	it("pins every real file and gives every role a sound", () => {
		for (const m of STARTER_MUSIC) {
			expect(m.url.startsWith("https://")).toBe(true);
			expect(m.sha256).toMatch(/^[0-9a-f]{64}$/);
		}
		for (const z of STARTER_ZIPS) {
			expect(z.url.startsWith("https://kenney.nl/")).toBe(true);
			expect(z.license).toBe("CC0-1.0");
			for (const f of z.files) expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
		}
		expect(Object.keys(STARTER_ROLES).sort()).toEqual(["correct", "reveal", "transition"]);
	});

	function fakePack() {
		const song = mp3(500);
		const pop = wav(150);
		const whoosh = wav(400);
		const license = Buffer.from("License: (Creative Commons Zero, CC0)\r\n");
		const z = zip([
			{ name: "License.txt", data: license },
			{ name: "Audio/pop.wav", data: pop, deflate: true },
			{ name: "Audio/whoosh.wav", data: whoosh, deflate: true },
			{ name: "Audio/unused.wav", data: wav(100) },
		]);
		const pack: StarterPack = {
			music: [{ url: "https://example.test/song.mp3", bytes: song.length, sha256: sha(song), title: "Song", author: "Kevin MacLeod", mood: "calm", energy: "low", tags: ["piano"] }],
			zips: [
				{
					id: "kenney-test",
					url: "https://example.test/pack.zip",
					bytes: z.length,
					sha256: sha(z),
					title: "Test Sounds",
					author: "Kenney (kenney.nl)",
					pageUrl: "https://kenney.nl/assets/test",
					license: "CC0-1.0",
					files: [
						{ entry: "Audio/pop.wav", bytes: pop.length, sha256: sha(pop), title: "Pop", tags: ["pop"], role: "reveal" },
						{ entry: "Audio/whoosh.wav", bytes: whoosh.length, sha256: sha(whoosh), title: "Whoosh", tags: ["whoosh"], role: "transition" },
					],
				},
			],
		};
		const files: Record<string, Buffer> = { "https://example.test/song.mp3": song, "https://example.test/pack.zip": z };
		const hits: string[] = [];
		const fetchImpl = (async (url: string) => {
			hits.push(url);
			const b = files[url];
			return b ? new Response(new Uint8Array(b)) : new Response("no", { status: 404 });
		}) as unknown as typeof fetch;
		return { pack, fetchImpl, hits };
	}

	it("installs every file with license metadata and a license file per pack, and resumes", async () => {
		const { lib, repos, dir } = await setup();
		const { pack, fetchImpl, hits } = fakePack();
		const licenses = join(dir, "licenses");
		const s = await installStarter({ lib, tmp: join(dir, "tmp"), licenses, pack, fetchImpl });
		expect(s).toMatchObject({ state: "installed", done: 3, total: 3 });
		const rows = repos.assets.list();
		expect(rows).toHaveLength(3);
		for (const a of rows) {
			expect(a.source).toBe("starter");
			expect(["PD", "CC0-1.0"]).toContain(a.license);
			expect(a.licenseUrl).toMatch(/^https:\/\/creativecommons\.org\//);
			expect(a.author).toBeTruthy();
			expect(a.sourceUrl).toMatch(/^https:\/\//);
			expect(a.pack).toBeTruthy();
		}
		expect(rows.find((a) => a.title === "Song")).toMatchObject({ kind: "music", mood: "calm", energy: "low", license: "PD", author: "Kevin MacLeod" });
		expect(readdirSync(licenses).sort()).toEqual(["freepd.txt", "kenney-test.txt"]);
		expect(readFileSync(join(licenses, "kenney-test.txt"), "utf8")).toContain("Creative Commons Zero");
		expect(starterInstalled(lib, pack)).toBe(3);
		// Run again: nothing is downloaded twice.
		hits.length = 0;
		await installStarter({ lib, tmp: join(dir, "tmp"), licenses, pack, fetchImpl });
		expect(hits).toEqual([]);
		expect(repos.assets.count()).toBe(3);
	});

	it("tries again after a server error, but not after a 404", async () => {
		const { lib, repos, dir } = await setup();
		const { pack, fetchImpl } = fakePack();
		let fails = 2;
		const flaky = (async (url: string, init?: RequestInit) => (fails-- > 0 ? new Response("busy", { status: 500 }) : fetchImpl(url, init))) as unknown as typeof fetch;
		const s = await installStarter({ lib, tmp: join(dir, "tmp"), licenses: join(dir, "l"), pack, fetchImpl: flaky, retryDelays: [1, 1, 1] });
		expect(s.state).toBe("installed");
		expect(repos.assets.count()).toBe(3);
		const gone = (async () => new Response("no", { status: 404 })) as unknown as typeof fetch;
		const other = await setup();
		await expect(installStarter({ lib: other.lib, tmp: join(other.dir, "tmp"), licenses: join(other.dir, "l"), pack, fetchImpl: gone, retryDelays: [1, 1, 1] })).rejects.toThrow(/HTTP 404/);
	});

	it("refuses a download that does not match its pin", async () => {
		const { lib, repos, dir } = await setup();
		const { pack, fetchImpl } = fakePack();
		pack.music[0]!.sha256 = "0".repeat(64);
		await expect(installStarter({ lib, tmp: join(dir, "tmp"), licenses: join(dir, "l"), pack, fetchImpl })).rejects.toThrow(/checksum/);
		expect(repos.assets.count()).toBe(0);
		expect(readdirSync(join(dir, "tmp"))).toEqual([]);
	});
});

/* ---------- Freesound ---------- */

describe("Freesound", () => {
	const sound = (id: number, license: string, preview = `https://cdn.freesound.org/previews/0/${id}_hq.mp3`) => ({
		id,
		name: `sound ${id}.wav`,
		username: `user${id}`,
		license,
		duration: 1.5,
		previews: { "preview-hq-mp3": preview },
		tags: ["pop"],
		url: `https://freesound.org/people/user${id}/sounds/${id}/`,
	});
	const results = [
		sound(1, "http://creativecommons.org/publicdomain/zero/1.0/"),
		sound(2, "https://creativecommons.org/licenses/by/4.0/"),
		sound(3, "https://creativecommons.org/licenses/by-nc/4.0/"),
		sound(4, "Attribution NonCommercial"),
		sound(5, "http://creativecommons.org/licenses/sampling+/1.0/"),
		sound(6, "Creative Commons 0", "https://evil.example.com/x.mp3"),
	];

	function fake() {
		const seen: { url: string; auth: string | null }[] = [];
		const fetchImpl = (async (url: string, init?: RequestInit) => {
			seen.push({ url, auth: new Headers(init?.headers).get("authorization") });
			const u = new URL(url);
			if (u.pathname === "/apiv2/search/text/") return Response.json({ count: results.length, results });
			const m = /^\/apiv2\/sounds\/(\d+)\/$/.exec(u.pathname);
			if (m) {
				const s = results.find((r) => r.id === Number(m[1]));
				return s ? Response.json(s) : new Response("", { status: 404 });
			}
			if (u.hostname === "cdn.freesound.org") {
				const r = new Response(new Uint8Array(mp3(60)));
				Object.defineProperty(r, "url", { value: url });
				return r;
			}
			return new Response("", { status: 404 });
		}) as unknown as typeof fetch;
		return { fetchImpl, seen };
	}

	it("asks only for CC0 and CC BY, and drops anything else that comes back", async () => {
		const { fetchImpl, seen } = fake();
		const r = await searchFreesound("abc123def456", { query: "pop", kind: "sfx", page: 1 }, { fetchImpl });
		expect(r.hits.map((h) => [h.id, h.license])).toEqual([
			[1, "CC0-1.0"],
			[2, "CC-BY-4.0"],
		]);
		expect(r.skipped).toBe(4);
		const url = new URL(seen[0]!.url);
		expect(url.searchParams.get("filter")).toContain('license:("Creative Commons 0" OR "Attribution")');
		// The key travels in a header, not in the URL.
		expect(seen[0]!.auth).toBe("Token abc123def456");
		expect(seen[0]!.url).not.toContain("abc123def456");
	});

	it("imports a CC BY sound with its author and credit, and refuses NC by id", async () => {
		const { lib, repos } = await setup();
		const { fetchImpl } = fake();
		const r = await importFreesound("abc123def456", 2, "sfx", { lib, fetchImpl });
		expect(r.asset).toMatchObject({ source: "freesound", license: "CC-BY-4.0", author: "user2", title: "sound 2", sourceUrl: "https://freesound.org/people/user2/sounds/2/" });
		expect(r.asset.attribution).toContain("by user2");
		await expect(importFreesound("abc123def456", 3, "sfx", { lib, fetchImpl })).rejects.toThrow(/NonCommercial/);
		await expect(importFreesound("abc123def456", 4, "sfx", { lib, fetchImpl })).rejects.toThrow(LicenseError);
		await expect(importFreesound("abc123def456", 6, "sfx", { lib, fetchImpl })).rejects.toThrow(/no preview/);
		expect(repos.assets.count()).toBe(1);
	});

	it("needs a key", async () => {
		await expect(searchFreesound("", { query: "pop", kind: "sfx", page: 1 })).rejects.toThrow(/API key/);
	});
});
