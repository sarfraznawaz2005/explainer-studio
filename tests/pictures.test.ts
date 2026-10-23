import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { classifyLicense } from "@shared/assets";
import { Outline, PlanSettings } from "@shared/planner";
import { EMPTY_SOURCE, Source, type Figure } from "@shared/source";
import { candidatesFor, findPictures, nextNumber, pickPicture, pictureCount, picturesCalls, type PictureNeed } from "../src/main/pictures/find";
import { creditFor, downloadImage, openverseSearch, wikidataPictures, wikimediaThumb, type Candidate } from "../src/main/pictures/web";
import type { PlannerAi } from "../src/main/planner/ai";
import { chapterPictures, figureRefs, scriptPrompt } from "../src/main/planner/script";
import { classifyLink } from "../src/main/security/links";

/* A tiny real JPEG header (SOF0 says 1200×800) and PNG header (1x1), enough for the type and size checks. */
const jpeg = (w = 1200, h = 800) => Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

type Route = (url: URL) => unknown | Buffer | Response | undefined;
/** A fetch that answers from a route function: JSON for objects, bytes for Buffers, 404 for undefined. */
function fakeFetch(route: Route, seen: string[] = []) {
	return (async (input: string | URL) => {
		const url = new URL(String(input));
		seen.push(url.toString());
		const r = route(url);
		if (r instanceof Response) return r;
		if (r === undefined) return new Response("no", { status: 404 });
		if (Buffer.isBuffer(r)) return new Response(new Uint8Array(r), { status: 200 });
		return new Response(JSON.stringify(r), { status: 200, headers: { "content-type": "application/json" } });
	}) as unknown as typeof fetch;
}

const ovResult = (id: string, over: Record<string, unknown> = {}) => ({
	id,
	title: `Photo ${id}`,
	creator: "Jane Doe",
	license: "by",
	license_version: "2.0",
	url: `https://live.staticflickr.com/1/${id}_b.jpg`,
	thumbnail: `https://api.openverse.org/v1/images/${id}/thumb/`,
	foreign_landing_url: `https://www.flickr.com/photos/x/${id}`,
	width: 1024,
	height: 768,
	source: "flickr",
	mature: false,
	...over,
});

const outline = Outline.parse({
	title: "Imran Khan",
	hook: ["From cricket to politics."],
	chapters: [
		{ id: "c1", title: "Cricket years", goal: "Know his cricket career.", keyPoints: ["1992 World Cup"], minutes: 1, sources: [] },
		{ id: "c2", title: "Politics", goal: "Know his political career.", keyPoints: ["Prime Minister 2018"], minutes: 1, sources: [] },
	],
	approved: true,
});
const settings = PlanSettings.parse({ level: "High school", targetMinutes: 2 });

describe("licenses", () => {
	it("keeps CC0, public domain and every CC BY version, refuses ShareAlike, NonCommercial and unknown", () => {
		expect(classifyLicense("CC BY 2.0")).toEqual({ ok: true, code: "CC-BY-2.0" });
		expect(classifyLicense("cc by 2.5")).toEqual({ ok: true, code: "CC-BY-2.5" });
		expect(creditFor({ title: "A", creator: "B", license: "CC BY 3.0", pageUrl: "https://commons.wikimedia.org/wiki/File:A.jpg", provider: "wikimedia" })?.line).toMatch(/"A" by B .*CC BY 3\.0/);
		expect(creditFor({ title: "A", creator: null, license: "CC0", pageUrl: "https://x.org/a", provider: "wikimedia" })).toMatchObject({ license: "CC0-1.0", line: null });
		expect(creditFor({ title: "A", creator: null, license: "Public domain", pageUrl: "https://x.org/a", provider: "nasa" })).toMatchObject({ license: "PD", line: null });
		for (const bad of ["CC BY-SA 4.0", "CC BY-NC 2.0", "CC BY-ND 3.0", "GFDL", ""]) expect(creditFor({ title: "A", creator: null, license: bad, pageUrl: "https://x.org/a", provider: "flickr" }), bad).toBeNull();
		// A credit must point at an https page.
		expect(creditFor({ title: "A", creator: null, license: "CC0", pageUrl: "http://x.org/a", provider: "flickr" })).toBeNull();
	});

	it("lets the credit pages of photo sites open in the browser", () => {
		for (const u of ["https://commons.wikimedia.org/wiki/File:A.jpg", "https://www.flickr.com/photos/x/1", "https://images.nasa.gov/details/a"]) expect(classifyLink(u).verdict).toBe("open");
	});
});

describe("web sources", () => {
	it("builds standard Wikimedia thumbnail sizes, and nothing for other hosts or SVG", () => {
		const o = "https://upload.wikimedia.org/wikipedia/commons/f/f1/Prime_Minister_Imran_Khan.jpg";
		expect(wikimediaThumb(o, 500)).toBe("https://upload.wikimedia.org/wikipedia/commons/thumb/f/f1/Prime_Minister_Imran_Khan.jpg/500px-Prime_Minister_Imran_Khan.jpg");
		expect(wikimediaThumb("https://upload.wikimedia.org/wikipedia/commons/a/ab/Map.svg", 500)).toBeNull();
		expect(wikimediaThumb("https://example.org/a.jpg", 500)).toBeNull();
	});

	it("reads Openverse results: allowed licenses only, no mature results, Wikimedia previews from Wikimedia", async () => {
		const fetchImpl = fakeFetch((u) =>
			u.host === "api.openverse.org"
				? {
						results: [
							ovResult("a"),
							ovResult("sa", { license: "by-sa" }),
							ovResult("m", { mature: true }),
							ovResult("w", { url: "https://upload.wikimedia.org/wikipedia/commons/4/48/Imran_Khan%2C_portrait.jpg", source: "wikimedia", width: 3000, height: 4000 }),
						],
					}
				: undefined,
		);
		const list = await openverseSearch("imran khan portrait", { fetchImpl });
		expect(list.map((c) => c.key)).toEqual(["openverse:a", "wikimedia:Imran Khan, portrait.jpg"]);
		expect(list[0]).toMatchObject({ preview: "https://api.openverse.org/v1/images/a/thumb/", full: "https://live.staticflickr.com/1/a_b.jpg", credit: { license: "CC-BY-2.0", provider: "flickr", creator: "Jane Doe" } });
		// Big Wikimedia files are fetched at 1920 px, previews at 500 px.
		expect(list[1]!.full).toMatch(/\/thumb\/4\/48\/Imran_Khan%2C_portrait\.jpg\/1920px-/);
		expect(list[1]!.preview).toMatch(/\/500px-/);
		expect([list[1]!.width, list[1]!.height]).toEqual([1920, 2560]);
	});

	it("takes Wikidata's own photo, reading its license from Wikipedia when Commons cannot be reached", async () => {
		const seen: string[] = [];
		const fetchImpl = fakeFetch((u) => {
			if (u.host === "www.wikidata.org" && u.searchParams.get("action") === "wbsearchentities") return { search: [{ id: "Q155164", label: "Imran Khan", description: "Prime Minister of Pakistan from 2018 to 2022" }] };
			if (u.host === "www.wikidata.org") return { claims: { P18: [{ mainsnak: { datavalue: { value: "Imran Khan Forum.jpg" } } }] } };
			if (u.host === "commons.wikimedia.org") return new Response("reset", { status: 503 });
			if (u.host === "en.wikipedia.org")
				return {
					query: {
						pages: {
							"-1": {
								imageinfo: [
									{
										url: "https://upload.wikimedia.org/wikipedia/commons/f/f1/Imran_Khan_Forum.jpg",
										width: 831,
										height: 1078,
										descriptionurl: "https://commons.wikimedia.org/wiki/File:Imran_Khan_Forum.jpg",
										extmetadata: { LicenseShortName: { value: "CC BY 3.0" }, Artist: { value: '<a href="x">Imran Khan</a>' }, ObjectName: { value: "Imran Khan at the forum" } },
									},
								],
							},
						},
					},
				};
			return undefined;
		}, seen);
		const r = await wikidataPictures("Imran Khan", { fetchImpl });
		expect(r.entity).toMatchObject({ id: "Q155164" });
		expect(r.candidates).toHaveLength(1);
		expect(r.candidates[0]).toMatchObject({ canonical: true, key: "wikimedia:Imran Khan Forum.jpg", full: "https://upload.wikimedia.org/wikipedia/commons/f/f1/Imran_Khan_Forum.jpg", credit: { license: "CC-BY-3.0", creator: "Imran Khan", title: "Imran Khan at the forum" } });
		expect(seen.some((u) => u.startsWith("https://commons.wikimedia.org/"))).toBe(true);
	});

	it("downloads only real pictures over https, within the size limit", async () => {
		const fetchImpl = fakeFetch((u) => (u.pathname.endsWith("ok.jpg") ? jpeg() : u.pathname.endsWith("page.jpg") ? Buffer.from("<html>not a picture</html>") : undefined));
		await expect(downloadImage("https://x.org/ok.jpg", { fetchImpl })).resolves.toMatchObject({ mediaType: "image/jpeg", width: 1200, height: 800 });
		await expect(downloadImage("https://x.org/page.jpg", { fetchImpl })).rejects.toThrow(/not a PNG, JPEG/);
		await expect(downloadImage("http://x.org/ok.jpg", { fetchImpl })).rejects.toThrow(/https/);
		const huge = (async () => new Response(new Uint8Array(1), { headers: { "content-length": String(30 * 1024 * 1024) } })) as unknown as typeof fetch;
		await expect(downloadImage("https://x.org/big.jpg", { fetchImpl: huge })).rejects.toThrow(/25 MB/);
	});
});

describe("choosing pictures", () => {
	const cand = (key: string, over: Partial<Candidate> = {}): Candidate => ({
		key,
		title: key,
		preview: `https://x.org/${key}-p.jpg`,
		full: `https://x.org/${key}.jpg`,
		width: 1200,
		height: 800,
		credit: { title: key, creator: "A", license: "CC0-1.0", pageUrl: `https://x.org/${key}`, provider: "flickr", line: null },
		canonical: false,
		...over,
	});
	const need: PictureNeed = { chapter: 1, subject: "Imran Khan", entity: "Imran Khan", queries: ["imran khan portrait"], kind: "person", why: "Show who he is" };

	it("skips pictures already used, too small, or listed twice", async () => {
		const fetchImpl = fakeFetch((u) =>
			u.host === "api.openverse.org" ? { results: [ovResult("a"), ovResult("a"), ovResult("tiny", { width: 300, height: 200 }), ovResult("used"), ovResult("b")] } : u.host === "www.wikidata.org" ? { search: [] } : undefined,
		);
		const r = await candidatesFor(need, { fetchImpl }, new Set(["openverse:used"]));
		expect(r.list.map((c) => c.key)).toEqual(["openverse:a", "openverse:b"]);
	});

	it("without a vision model, uses only Wikidata's own photo of the subject", async () => {
		expect(await pickPicture(need, { list: [cand("a")], entity: null }, null, {})).toBeNull();
		const p = await pickPicture(need, { list: [cand("a"), cand("w", { canonical: true })], entity: "Imran Khan, Prime Minister of Pakistan" }, null, {});
		expect(p?.candidate.key).toBe("w");
	});

	it("with a vision model, takes its best pick and refuses a watermarked or wrong one", async () => {
		const fetchImpl = fakeFetch(() => jpeg(500, 400));
		const ai = (best: number | null, flags: { shows?: boolean; watermark?: boolean } = {}): PlannerAi & { prompts: string[]; images: number[] } => {
			const prompts: string[] = [];
			const images: number[] = [];
			return {
				prompts,
				images,
				async structured(req, call) {
					expect(call.slot).toBe("vision");
					prompts.push(req.prompt);
					images.push(req.images?.length ?? 0);
					return { pictures: [1, 2].map((n) => ({ n, shows: flags.shows ?? true, watermark: n === best ? (flags.watermark ?? false) : false, unsafe: false, quality: "good" })), best, description: best ? "Imran Khan speaking at a forum." : null } as never;
				},
			};
		};
		const found = { list: [cand("a", { canonical: true }), cand("b")], entity: "Imran Khan, Prime Minister of Pakistan" };
		const good = ai(2);
		expect(await pickPicture(need, found, good, { fetchImpl })).toMatchObject({ candidate: { key: "b" }, description: "Imran Khan speaking at a forum." });
		expect(good.images).toEqual([2]);
		// The model is told which picture is the subject's own Wikidata photo.
		expect(good.prompts[0]).toMatch(/Picture 1: "a" \(the subject's own Wikidata photo\)/);
		expect(await pickPicture(need, found, ai(1, { watermark: true }), { fetchImpl })).toBeNull();
		expect(await pickPicture(need, found, ai(1, { shows: false }), { fetchImpl })).toBeNull();
		expect(await pickPicture(need, found, ai(null), { fetchImpl })).toBeNull();
	});

	it("numbers new files after the ones already there", () => {
		expect(nextNumber([{ file: "source/figures/web-002.jpg" }, { file: "source/figures/my-007.png" }, { file: "source/figures/in1-003.png" }], "web")).toBe(3);
		expect(nextNumber([], "my")).toBe(1);
	});

	it("asks for about one photo a minute, at most 12, and prices the vision checks", () => {
		expect(pictureCount(outline, settings)).toBe(3);
		expect(pictureCount(outline, { ...settings, targetMinutes: 60 })).toBe(12);
		const calls = picturesCalls(outline, settings, { figures: [{ origin: "mine", caption: null } as Figure] }, true);
		expect(calls.filter((c) => c.slot === "planner")).toHaveLength(1);
		expect(calls.filter((c) => c.slot === "vision")).toHaveLength(1 + 3);
		expect(picturesCalls(outline, settings, { figures: [] }, false)).toHaveLength(1);
	});
});

describe("findPictures", () => {
	it("describes the user's pictures, plans photos, checks them and saves each once with its credit", async () => {
		const dir = mkdtempSync(join(tmpdir(), "es-pics-"));
		const fetchImpl = fakeFetch((u) => {
			if (u.host === "www.wikidata.org") return { search: [] };
			if (u.host === "api.openverse.org" && u.pathname.endsWith("/thumb/")) return jpeg(500, 400);
			if (u.host === "api.openverse.org") return { results: [ovResult(`r-${u.searchParams.get("q")!.replace(/\W+/g, "")}`), ovResult("shared")] };
			if (u.host === "live.staticflickr.com") return jpeg();
			if (u.host === "x.org") return jpeg(600, 400);
			return undefined;
		});
		const purposes: string[] = [];
		const ai: PlannerAi = {
			async structured(req, call) {
				purposes.push(call.purpose);
				if (call.purpose === "pictures.describe") return { description: "A boy holding a cricket bat." } as never;
				if (call.purpose === "pictures.plan") {
					expect(req.prompt).toMatch(/A boy holding a cricket bat/);
					return {
						pictures: [
							{ chapter: 1, subject: "1992 Cricket World Cup", queries: ["cricket world cup 1992"], kind: "event", why: "the win" },
							{ chapter: 2, subject: "Parliament House", queries: ["parliament house islamabad"], kind: "place", why: "where he worked" },
							{ chapter: 9, subject: "Out of range", queries: ["nothing"], kind: "thing", why: "bad chapter" },
						],
					} as never;
				}
				return { pictures: [{ n: 1, shows: true, watermark: false, unsafe: false, quality: "good" }], best: 1, description: `Checked: ${req.prompt.split("\n")[0]}`, focus: { x: 70, y: 30 } } as never;
			},
		};
		const mine: Figure = { id: "my1", file: "source/figures/my-001.jpg", caption: null, page: null, input: 0, width: 800, height: 600, mediaType: "image/jpeg", origin: "mine", mustUse: true };
		const { mkdirSync, writeFileSync } = await import("node:fs");
		mkdirSync(join(dir, "source", "figures"), { recursive: true });
		writeFileSync(join(dir, mine.file), jpeg(800, 600));
		const progress: string[] = [];
		const r = await findPictures({
			draftDir: dir,
			source: Source.parse({ ...EMPTY_SOURCE, figures: [mine] }),
			outline,
			settings,
			ai,
			vision: true,
			deps: { fetchImpl },
			onProgress: (p) => progress.push(p.detail),
		});
		expect(purposes).toEqual(["pictures.describe", "pictures.plan", "pictures.check", "pictures.check"]);
		expect(r.added).toBe(2);
		const web = r.source.figures.filter((f) => f.origin === "web");
		expect(web.map((f) => f.file).sort()).toEqual(["source/figures/web-001.jpg", "source/figures/web-002.jpg"]);
		for (const f of web) {
			expect(existsSync(join(dir, f.file))).toBe(true);
			expect(f.credit).toMatchObject({ license: "CC-BY-2.0", creator: "Jane Doe" });
			expect(f.caption).toMatch(/^Checked: Subject: /);
			expect(f.focus).toEqual({ x: 70, y: 30 });
		}
		expect(web.map((f) => f.search?.chapter).sort()).toEqual([1, 2]);
		expect(r.source.figures.find((f) => f.id === "my1")!.caption).toBe("A boy holding a cricket bat.");
		expect(r.source.pictureSearch?.found).toBe(2);
		expect(readFileSync(join(dir, web[0]!.file))[0]).toBe(0xff);
		expect(progress.at(-1)).toMatch(/2 of 2 checked/);
	});
});

describe("photos in the script", () => {
	it("gives each chapter its own web photos and spreads the user's must-use pictures", () => {
		const figs = figureRefs({
			figures: [
				{ id: "web1", file: "source/figures/web-001.jpg", caption: "Cup", page: null, input: 0, width: 1, height: 1, mediaType: "image/jpeg", origin: "web", search: { subject: "Cup", queries: ["cup"], chapter: 2 } },
				{ id: "my1", file: "source/figures/my-001.jpg", caption: "Me", page: null, input: 0, width: 1, height: 1, mediaType: "image/jpeg", origin: "mine", mustUse: true },
				{ id: "my2", file: "source/figures/my-002.jpg", caption: "Me too", page: null, input: 0, width: 1, height: 1, mediaType: "image/jpeg", origin: "mine", mustUse: true },
				{ id: "my3", file: "source/figures/my-003.jpg", caption: "Optional", page: null, input: 0, width: 1, height: 1, mediaType: "image/jpeg", origin: "mine", mustUse: false },
			],
		});
		expect(chapterPictures(figs, 2, 0).map((f) => f.id)).toEqual(["my1"]);
		expect(chapterPictures(figs, 2, 1).map((f) => f.id)).toEqual(["web1", "my2"]);
		const ctx = { source: { title: "T", sections: [], figures: figs.map((f) => ({ id: f.id, file: `source/figures/${f.file}`, caption: f.caption, page: null, input: 0, width: 1, height: 1, mediaType: "image/jpeg", origin: f.origin, mustUse: f.mustUse, search: f.chapter ? { subject: "Cup", queries: [], chapter: f.chapter } : undefined })) }, outline, settings, map: null };
		expect(scriptPrompt(ctx, 1)).toMatch(/Photos planned for this chapter[^\n]*\n- web1: Cup\n- my2: Me too/);
		expect(scriptPrompt(ctx, 0)).not.toMatch(/web1/);
	});
});

describe("fitting photos to the video", () => {
	it("fills the frame and keeps the subject in view when the shapes are close, else fits the whole photo", async () => {
		const { photoLayout } = await import("../video/src/scenes/photo-layout");
		const wide = { width: 1920, height: 1080 };
		// 3:2 photo in 16:9: fill, cropped top and bottom; a subject high up stays in the frame.
		const a = photoLayout({ width: 1500, height: 1000 }, wide, { x: 50, y: 5 });
		expect(a.mode).toBe("fill");
		expect(a.width).toBe(1920);
		expect(a.top).toBe(0); // pulled to the top edge, never past it
		// Subject on the right of a wider photo: the crop moves right, no edge shows.
		const b = photoLayout({ width: 2400, height: 1080 }, wide, { x: 90, y: 50 });
		expect(b.left).toBe(1920 - 2400);
		// Tall portrait in a wide video: the whole photo, centred, inside the margin.
		const c = photoLayout({ width: 800, height: 1200 }, wide);
		expect(c).toMatchObject({ mode: "fit", height: 1080 - 120 });
		expect(c.left).toBeCloseTo((1920 - c.width) / 2);
		// The same portrait in a vertical video fills it.
		expect(photoLayout({ width: 800, height: 1200 }, { width: 1080, height: 1920 }).mode).toBe("fill");
	});

	it("ranks pictures of the video's shape first and asks the search for that shape", async () => {
		const { shapeScore } = await import("../src/main/pictures/find");
		expect(shapeScore({ width: 800, height: 1200 }, "vertical")).toBe(2);
		expect(shapeScore({ width: 800, height: 1200 }, "landscape")).toBe(0);
		expect(shapeScore({ width: 1000, height: 1050 }, "landscape")).toBe(1);
		const seen: string[] = [];
		const fetchImpl = fakeFetch(
			(u) => (u.host === "api.openverse.org" ? { results: [ovResult("wide1", { width: 1600, height: 900 }), ovResult("tall1", { width: 900, height: 1600 }), ovResult("tall2", { width: 800, height: 1400 })] } : undefined),
			seen,
		);
		const need: PictureNeed = { chapter: 1, subject: "Badshahi Mosque", queries: ["badshahi mosque"], kind: "place", why: "" };
		const r = await candidatesFor(need, { fetchImpl, format: "vertical" }, new Set());
		expect(r.list.map((c) => c.key)).toEqual(["openverse:tall1", "openverse:tall2", "openverse:wide1"]);
		expect(new URL(seen[0]!).searchParams.get("aspect_ratio")).toBe("tall");
		// Three results are enough: no second search for any shape.
		expect(seen.filter((u) => u.includes("api.openverse.org")).length).toBe(1);
	});

	it("reads a JPEG's rotation tag", async () => {
		const { jpegOrientation } = await import("../src/main/ingest/images");
		// SOI, APP1 "Exif", TIFF little endian, one IFD entry: Orientation (0x0112) = 6.
		const tiff = Buffer.from([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
		const app1 = Buffer.concat([Buffer.from([0xff, 0xe1]), Buffer.from([0x00, 2 + 6 + tiff.length]), Buffer.from("Exif\0\0", "ascii"), tiff]);
		expect(jpegOrientation(Buffer.concat([Buffer.from([0xff, 0xd8]), app1, jpeg()]))).toBe(6);
		expect(jpegOrientation(jpeg())).toBe(1);
		expect(jpegOrientation(Buffer.from("not a jpeg"))).toBe(1);
	});

	it("saves pictures fitted when they are big or turned, as they are otherwise", async () => {
		const { savePicture } = await import("../src/main/pictures/fit");
		const dir = mkdtempSync(join(tmpdir(), "es-fit-"));
		const jobs: { image: string; out: string; max: number }[] = [];
		const { writeFileSync } = await import("node:fs");
		const fit = async (list: typeof jobs) => {
			jobs.push(...list);
			writeFileSync(`${list[0]!.out}.jpg`, jpeg(1620, 2160));
			return new Map([[list[0]!.image, { out: `${list[0]!.out}.jpg`, width: 1620, height: 2160 }]]);
		};
		const big = await savePicture(jpeg(4000, 3000), join(dir, "my-001"), ".jpg", { width: 4000, height: 3000, orientation: 6 }, fit);
		expect(big).toMatchObject({ width: 1620, height: 2160, mediaType: "image/jpeg" });
		expect(jobs[0]).toMatchObject({ max: 2160, out: join(dir, "my-001") });
		expect(existsSync(jobs[0]!.image)).toBe(false); // the raw copy is gone
		const small = await savePicture(jpeg(1200, 800), join(dir, "my-002"), ".jpg", { width: 1200, height: 800, orientation: 1 }, fit);
		expect(small).toMatchObject({ path: join(dir, "my-002.jpg"), width: 1200, height: 800 });
		expect(jobs).toHaveLength(1);
		// No Python: kept as it is, but a turned photo reports its upright size.
		const turned = await savePicture(jpeg(4000, 3000), join(dir, "my-003"), ".jpg", { width: 4000, height: 3000, orientation: 6 }, null);
		expect(turned).toMatchObject({ width: 3000, height: 4000 });
	});
});

describe("polite downloads", () => {
	it("waits and tries once more when a site says too many requests", async () => {
		let calls = 0;
		const fetchImpl = (async () => {
			calls++;
			return calls === 1 ? new Response("slow down", { status: 429, headers: { "retry-after": "1" } }) : new Response(new Uint8Array(jpeg()), { status: 200 });
		}) as unknown as typeof fetch;
		const t0 = Date.now();
		await expect(downloadImage("https://upload.wikimedia.org/x.jpg", { fetchImpl })).resolves.toMatchObject({ mediaType: "image/jpeg" });
		expect(calls).toBe(2);
		expect(Date.now() - t0).toBeGreaterThanOrEqual(900);
		// A second refusal is final.
		const always = (async () => new Response("no", { status: 429, headers: { "retry-after": "1" } })) as unknown as typeof fetch;
		await expect(downloadImage("https://upload.wikimedia.org/y.jpg", { fetchImpl: always })).rejects.toThrow(/HTTP 429/);
	});
});
