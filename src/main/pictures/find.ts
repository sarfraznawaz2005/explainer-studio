import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { z } from "zod";
import { lengthLabel, type Outline, type PlanSettings, type VideoFormat } from "@shared/planner";
import { jpegOrientation } from "../ingest/images";
import { savePicture, type Fitter } from "./fit";
import type { Figure, Source } from "@shared/source";
import type { ImageInput } from "../ai/providers/types";
import { jsonInstructions } from "../ai/structured";
import type { EstimateCall } from "../planner/estimate";
import { tokens } from "../planner/estimate";
import type { PlannerAi } from "../planner/ai";
import { downloadImage, nasaSearch, openverseSearch, wikidataPictures, type Candidate, type WebDeps } from "./web";

/**
 * Finds free photos for a video before its script is written (step 2 of the
 * picture plan). The planner AI lists the few real things that deserve a photo
 * (people, places, objects, events); abstract ideas get none, because the
 * diagrams draw those better. For each, Wikidata gives the subject's own photo
 * and Openverse (and NASA for space) give more; a vision model looks at small
 * previews and picks one that really shows the subject, with no watermark.
 * Without a vision model only Wikidata's own photo of a named subject is used.
 * The winners are saved as figures, so the script can show them.
 */

export const PictureNeed = z.object({
	chapter: z.number().int().min(1),
	subject: z.string().trim().min(1).max(120),
	/** The exact name of one specific person, place, building, artwork or event, as on Wikipedia. */
	entity: z.string().trim().max(80).optional(),
	queries: z.array(z.string().trim().min(1).max(60)).min(1).max(3),
	kind: z.enum(["person", "place", "thing", "event", "artwork", "nature", "space", "other"]),
	why: z.string().trim().max(200),
});
export type PictureNeed = z.infer<typeof PictureNeed>;
export const AiNeeds = z.object({ pictures: z.array(PictureNeed).max(12) });

/** About one photo for every minute, never more than 12. Shorts change picture often, so they get a few. */
export function pictureCount(outline: Outline, s: PlanSettings): number {
	const minutes = s.targetMinutes ?? outline.chapters.reduce((n, c) => n + c.minutes, 0);
	return Math.max(2, Math.min(12, Math.round(minutes * 1.1) + 1));
}

export function needsSystem(): string {
	return [
		"You choose the few real photos an explainer video should show. The video draws its own diagrams, charts and animations; photos are only for real things.",
		"Rules:",
		"- Ask for a photo only for something real and specific that viewers should SEE: a named person, a place, a building, an object, an animal or plant, an artwork, a historic event, a space object.",
		"- Never ask for photos of abstract ideas (democracy, inflation, an algorithm, a feeling). Never a generic stock photo (people at laptops, a handshake). Those are filler.",
		"- entity: the exact name of ONE specific named subject as its Wikipedia article is titled (\"Imran Khan\", \"Eiffel Tower\", \"1992 Cricket World Cup\"). Leave it out for general things (a red blood cell, a volcano).",
		"- queries: 1 to 3 picture searches in English, 2 to 4 words each, subject first, then a visual word (portrait, aerial, close-up, interior, night). No adjectives that are not visual. Each query different.",
		"- Spread the photos over the chapters where they fit. Do not ask twice for the same subject.",
		"- Skip anything the user's own pictures already show.",
		"- It is fine to ask for fewer photos than allowed, or none.",
		"- Write subject, entity, queries and why in English, whatever the video's language: the picture libraries are searched in English.",
	].join("\n");
}

/** What photos suit the video's shape, for the photo planner. */
const PHOTO_SHAPE: Record<VideoFormat, string> = {
	landscape: "",
	vertical: " Vertical (9:16): portrait photos fit best.",
	portrait: " Portrait (4:5): portrait photos fit best.",
	square: " Square (1:1): square or nearly square photos fit best.",
};

export function needsPrompt(outline: Outline, s: PlanSettings, mine: Pick<Figure, "caption">[], count: number): string {
	return [
		`Video: ${outline.title}${outline.subtitle ? ` (${outline.subtitle})` : ""}. Audience: ${s.level}. Length: ${s.targetMinutes ? lengthLabel(s.targetMinutes) : "as needed"}.${PHOTO_SHAPE[s.format]}`,
		`At most ${count} photos.`,
		"",
		"Chapters:",
		...outline.chapters.map((c, i) => `${i + 1}. ${c.title}: ${c.goal} Key points: ${c.keyPoints.join("; ")}`),
		...(mine.length ? ["", "The user's own pictures (already in the video):", ...mine.map((m, i) => `- ${m.caption ?? `picture ${i + 1} (no description)`}`)] : []),
	].join("\n");
}

/* ---------- vision check ---------- */

const Focus = z.object({ x: z.number().min(0).max(100), y: z.number().min(0).max(100) });

export const VisionPick = z.object({
	pictures: z.array(
		z.object({
			n: z.number().int().min(1),
			/** True when the picture clearly shows the subject. */
			shows: z.boolean(),
			/** A watermark, a logo, or large text over the picture. */
			watermark: z.boolean(),
			/** Nudity, gore, or anything not fit for a school video. */
			unsafe: z.boolean(),
			quality: z.enum(["good", "ok", "poor"]),
		}),
	),
	/** The number of the best usable picture, or null when none is usable. */
	best: z.number().int().min(1).nullable(),
	/** One sentence: what the best picture shows (for the script writer and the caption). */
	description: z.string().max(240).nullable(),
	/** Where the main subject is in the best picture (centre, percent from the left and from the top). */
	focus: Focus.nullable().optional(),
});

export const VISION_SYSTEM = [
	"You check candidate photos for an educational video. The pictures are numbered 1, 2, 3 in the order they are sent.",
	"For each picture say whether it clearly shows the subject, whether it has a watermark, logo or large text over it, whether it is unsafe for a school video, and its quality.",
	"People: do not identify anyone from their face. A picture shows a named person only when its title names that exact person, or it is marked as the subject's own Wikidata photo. A title that names someone else (another person with a similar name) means shows = false.",
	"Prefer the subject's own Wikidata photo when it is good.",
	"best: the number of the one picture that shows the subject most clearly and looks best, with no watermark and nothing unsafe. null if none of them does.",
	"description: one plain sentence saying what the best picture shows (who or what, and what is happening). null if best is null.",
	"focus: the centre of the main subject in the best picture (for a person: the face), as percent of the picture's width from the left (x) and of its height from the top (y). null if best is null.",
].join("\n");

export const DESCRIBE_SYSTEM = [
	"You describe a picture for the writer of an educational video. Say in one plain sentence (at most 30 words) who or what it shows and what is happening. Do not guess names you cannot see or read.",
	"focus: the centre of the main subject (for a person: the face), as percent of the picture's width from the left (x) and of its height from the top (y).",
].join("\n");
export const Describe = z.object({ description: z.string().trim().min(1).max(240), focus: Focus.nullable().optional() });

export type FindDeps = WebDeps & {
	log?: (msg: string) => void;
	/** Turns pictures upright and makes big ones smaller (docs.py). None: pictures are saved as they are. */
	fit?: Fitter | null;
	/** The video's shape: searches ask for pictures of the same shape first. */
	format?: VideoFormat;
};

/** How well a picture's shape suits the video: 2 same shape, 1 square-ish (or any, for a square video), 0 the other way round. */
export function shapeScore(c: Pick<Candidate, "width" | "height">, format: VideoFormat): number {
	if (!c.width || !c.height) return 1;
	const r = c.width / c.height;
	const squarish = r > 0.83 && r < 1.2;
	if (format === "square") return squarish ? 2 : 1;
	if (squarish) return 1;
	return (format === "landscape") === r > 1 ? 2 : 0;
}

/** Up to 6 candidates for one need: Wikidata's photo of the named subject first, then searches. */
export async function candidatesFor(need: PictureNeed, deps: FindDeps, exclude: Set<string>): Promise<{ list: Candidate[]; entity: string | null }> {
	const out: Candidate[] = [];
	let entity: string | null = null;
	const push = (c: Candidate) => {
		if (exclude.has(c.key) || out.some((o) => o.key === c.key)) return;
		// Too small to fill a frame (unknown sizes are checked after download).
		if (c.width && Math.max(c.width, c.height) < 640) return;
		out.push(c);
	};
	if (need.entity) {
		try {
			const w = await wikidataPictures(need.entity, deps);
			if (w.entity) entity = [w.entity.label, w.entity.description].filter(Boolean).join(", ");
			w.candidates.forEach(push);
		} catch (err) {
			if (deps.signal?.aborted) throw err;
			deps.log?.(`wikidata "${need.entity}": ${(err as Error).message}`);
		}
	}
	const aspect = deps.format === "square" ? "square" : deps.format === "vertical" || deps.format === "portrait" ? "tall" : "wide";
	for (const q of need.queries) {
		if (out.length >= 6) break;
		try {
			(await openverseSearch(q, deps, { count: 12, aspect })).forEach(push);
		} catch (err) {
			if (deps.signal?.aborted) throw err;
			deps.log?.(`openverse "${q}": ${(err as Error).message}`);
		}
		if (need.kind === "space") {
			try {
				(await nasaSearch(q, deps)).forEach(push);
			} catch (err) {
				if (deps.signal?.aborted) throw err;
				deps.log?.(`nasa "${q}": ${(err as Error).message}`);
			}
		}
	}
	// Too few of the right shape: any shape will do (the video fills the frame around it).
	if (out.length < 3 && need.queries[0]) {
		try {
			(await openverseSearch(need.queries[0], deps, { count: 12 })).forEach(push);
		} catch (err) {
			if (deps.signal?.aborted) throw err;
			deps.log?.(`openverse "${need.queries[0]}" (any shape): ${(err as Error).message}`);
		}
	}
	// Wikidata's own photo first, then the right shape first (the sort keeps the search order otherwise).
	const fmt = deps.format ?? "landscape";
	out.sort((a, b) => Number(b.canonical) - Number(a.canonical) || shapeScore(b, fmt) - shapeScore(a, fmt));
	return { list: out.slice(0, 6), entity };
}

/** The picture to use for a need: checked by the vision model, or (without one) Wikidata's own photo only. */
export async function pickPicture(
	need: PictureNeed,
	found: { list: Candidate[]; entity: string | null },
	ai: PlannerAi | null,
	deps: FindDeps,
): Promise<{ candidate: Candidate; description: string; focus?: { x: number; y: number } } | null> {
	if (!ai) {
		const c = found.list.find((x) => x.canonical);
		return c ? { candidate: c, description: found.entity ? `${found.entity}.` : need.subject } : null;
	}
	const shown: { c: Candidate; image: ImageInput }[] = [];
	for (const c of found.list) {
		try {
			const img = await downloadImage(c.preview, deps);
			if (img.data.length > 3_000_000) continue;
			shown.push({ c, image: { data: new Uint8Array(img.data), mediaType: img.mediaType } });
		} catch (err) {
			if (deps.signal?.aborted) throw err;
			deps.log?.(`preview ${c.key}: ${(err as Error).message}`);
		}
	}
	if (!shown.length) return null;
	const v = await ai.structured(
		{
			schema: VisionPick,
			system: VISION_SYSTEM,
			prompt: [
				`Subject: ${need.subject}${found.entity ? ` (${found.entity})` : ""}.`,
				`Why the video needs it: ${need.why}`,
				...shown.map((s, i) => `Picture ${i + 1}: "${s.c.title}"${s.c.canonical ? " (the subject's own Wikidata photo)" : ""}`),
			].join("\n"),
			images: shown.map((s) => s.image),
		},
		{ slot: "vision", purpose: "pictures.check", maxOutputTokens: 900 },
	);
	const best = v.best ? v.pictures.find((p) => p.n === v.best) : undefined;
	const pick = v.best ? shown[v.best - 1] : undefined;
	if (!pick || !best || !best.shows || best.watermark || best.unsafe || best.quality === "poor") return null;
	return { candidate: pick.c, description: v.description ?? need.subject, ...(v.focus ? { focus: v.focus } : {}) };
}

/* ---------- saving ---------- */

const EXT: Record<string, string> = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif" };

/** The next free "<prefix>-NNN" number among the figures. */
export function nextNumber(figures: Pick<Figure, "file">[], prefix: string): number {
	const used = figures.map((f) => new RegExp(`(^|/)${prefix}-(\\d{3,4})\\.`).exec(f.file)?.[2]).filter(Boolean).map(Number);
	return (used.length ? Math.max(...used) : 0) + 1;
}

/** Downloads the full picture into source/figures as web-<n> and returns its figure. */
export async function saveWebPicture(draftDir: string, n: number, need: PictureNeed, pick: { candidate: Candidate; description: string; focus?: { x: number; y: number } }, deps: FindDeps): Promise<Figure> {
	const img = await downloadImage(pick.candidate.full, deps);
	if (Math.max(img.width, img.height) < 480) throw new Error("The picture is too small.");
	const stem = join(draftDir, "source", "figures", `web-${String(n).padStart(3, "0")}`);
	const orientation = img.mediaType === "image/jpeg" ? jpegOrientation(img.data) : 1;
	const saved = await savePicture(img.data, stem, EXT[img.mediaType]!, { width: img.width, height: img.height, orientation }, deps.fit ?? null, deps.signal);
	return {
		id: `web${n}`,
		file: `source/figures/${basename(saved.path)}`,
		caption: pick.description.slice(0, 500),
		page: null,
		input: 0,
		width: saved.width,
		height: saved.height,
		mediaType: saved.mediaType,
		origin: "web",
		credit: pick.candidate.credit,
		...(pick.focus ? { focus: pick.focus } : {}),
		search: { subject: need.subject.slice(0, 120), queries: need.queries.slice(0, 4), chapter: need.chapter },
	};
}

/* ---------- the whole step ---------- */

export type FindProgress = { done: number; total: number; detail: string };

export type FindRequest = {
	draftDir: string;
	source: Source;
	outline: Outline;
	settings: PlanSettings;
	/** Planner model (lists the photos). */
	ai: PlannerAi;
	/** True when a vision model is set up. */
	vision: boolean;
	deps: FindDeps;
	onProgress?: (p: FindProgress) => void;
};

const keyOf = (f: Figure) => (f.credit ? (f.credit.provider === "wikimedia" ? `wikimedia:${decodeURIComponent(f.credit.pageUrl.split("File:").pop() ?? "").replace(/_/g, " ")}` : f.credit.pageUrl) : f.file);

/**
 * Describes the user's pictures that have no caption (vision), lists the photos
 * the video needs, and saves one checked photo for each. Returns the new Source.
 * One failed photo never stops the others.
 */
export async function findPictures(req: FindRequest): Promise<{ source: Source; added: number; skipped: string[] }> {
	const { deps } = req;
	let figures = [...req.source.figures];
	const skipped: string[] = [];
	const tell = (done: number, total: number, detail: string) => req.onProgress?.({ done, total, detail });

	// 1. The user's own pictures get a description, so the script writer knows what they show.
	if (req.vision) {
		const blank = figures.filter((f) => f.origin === "mine" && !f.caption);
		for (const [i, f] of blank.entries()) {
			tell(0, 1, `Looking at your pictures (${i + 1} of ${blank.length})`);
			try {
				const data = await readFile(join(req.draftDir, f.file));
				// Pictures are fitted when added; one that could not be (no Python) may be too big for the vision model.
				if (data.length > 4_500_000) {
					deps.log?.(`describe ${f.file}: too big for the vision model (${Math.round(data.length / 1e6)} MB), skipped`);
					continue;
				}
				const d = await req.ai.structured(
					{ schema: Describe, system: DESCRIBE_SYSTEM, prompt: "Describe this picture.", images: [{ data: new Uint8Array(data), mediaType: f.mediaType }] },
					{ slot: "vision", purpose: "pictures.describe", maxOutputTokens: 300 },
				);
				figures = figures.map((x) => (x.id === f.id ? { ...x, caption: d.description, ...(d.focus ? { focus: d.focus } : {}) } : x));
			} catch (err) {
				if (deps.signal?.aborted) throw err;
				deps.log?.(`describe ${f.file}: ${(err as Error).message}`);
			}
		}
	}

	// 2. What deserves a photo.
	tell(0, 1, "Choosing what to show");
	const count = pictureCount(req.outline, req.settings);
	const mine = figures.filter((f) => f.origin === "mine");
	const { pictures: needs } = await req.ai.structured(
		{ schema: AiNeeds, system: needsSystem(), prompt: needsPrompt(req.outline, req.settings, mine, count) },
		{ slot: "planner", purpose: "pictures.plan", maxOutputTokens: 2500 },
	);
	const list = needs.filter((n) => n.chapter <= req.outline.chapters.length).slice(0, count);
	deps.log?.(`pictures: ${list.length} wanted: ${list.map((n) => n.subject).join("; ")}`);

	// 3. Find, check and save, two at a time.
	const used = new Set(figures.map(keyOf));
	// Numbers are handed out before the downloads, so the two workers never share one.
	let next = nextNumber(figures, "web");
	let done = 0;
	let added = 0;
	const queue = [...list];
	const worker = async () => {
		for (let need = queue.shift(); need; need = queue.shift()) {
			if (deps.signal?.aborted) throw deps.signal.reason;
			tell(done, list.length, `Finding: ${need.subject}`);
			try {
				const found = await candidatesFor(need, deps, used);
				const pick = found.list.length ? await pickPicture(need, found, req.vision ? req.ai : null, deps) : null;
				if (!pick || used.has(pick.candidate.key)) skipped.push(need.subject);
				else {
					used.add(pick.candidate.key);
					const fig = await saveWebPicture(req.draftDir, next++, need, pick, deps);
					figures = [...figures, fig];
					added++;
				}
			} catch (err) {
				if (deps.signal?.aborted) throw err;
				deps.log?.(`picture "${need.subject}": ${(err as Error).message}`);
				skipped.push(need.subject);
			}
			done++;
			tell(done, list.length, `${done} of ${list.length} checked`);
		}
	};
	await Promise.all([worker(), worker()]);
	return { source: { ...req.source, figures, pictureSearch: { at: new Date().toISOString(), found: added } }, added, skipped };
}

/** Model calls for the cost estimate. */
export function picturesCalls(outline: Outline, s: PlanSettings, source: Pick<Source, "figures">, vision: boolean): EstimateCall[] {
	const count = pictureCount(outline, s);
	const mine = source.figures.filter((f) => f.origin === "mine");
	const calls: EstimateCall[] = [{ slot: "planner", input: tokens(needsSystem().length + jsonInstructions(AiNeeds).length + needsPrompt(outline, s, mine, count).length), output: 1500 }];
	if (!vision) return calls;
	for (const _ of mine.filter((f) => !f.caption)) calls.push({ slot: "vision", input: 1200, output: 80 });
	// Up to 6 previews of about 500 px each per photo.
	for (let i = 0; i < count; i++) calls.push({ slot: "vision", input: 6 * 700 + tokens(VISION_SYSTEM.length + jsonInstructions(VisionPick).length + 400), output: 300 });
	return calls;
}
