import { randomUUID } from "node:crypto";
import { readFile, rename, rm, stat } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { PICTURES_MAX, type PicturesState, type PictureView } from "@shared/ipc/pictures";
import { VideoPlan } from "@shared/plan/schema";
import { formatOf, type VideoFormat } from "@shared/planner";
import { figureMetaOf, Source, type Figure, type FigureMeta } from "@shared/source";
import type { Draft } from "@shared/models";
import { appFolders } from "../app/folders";
import { figureBaseFor } from "../app/media-url";
import { repos } from "../db/repos";
import { imageSize, jpegOrientation } from "../ingest/images";
import { fitterFrom, savePicture, type Fitter } from "./fit";
import { voiceEngine } from "../voice";
import { downloadImage } from "./web";
import { candidatesFor, nextNumber, pickPicture, type FindDeps, type PictureNeed } from "./find";
import type { PlannerAi } from "../planner/ai";

/**
 * A draft's pictures: the figures of its Source. The user's own pictures
 * ("my-NNN"), web photos ("web-NNN") and figures from the material all live in
 * <draft>/source/figures, so figure scenes can show any of them.
 */

const MAX_BYTES = 25 * 1024 * 1024;
const TYPES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" };
export const PICTURE_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "gif"];

export class PictureError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "PictureError";
	}
}

export const draftDir = (draftId: string) => join(appFolders().drafts, draftId);

/** The picture fitter (docs.py in the voice engine's Python), or null when that is not installed. */
export const pictureFitter = (): Fitter | null => fitterFrom(voiceEngine().docsRunner(), join(appFolders().cache, "pictures"));
const fileName = (f: Pick<Figure, "file">) => f.file.split("/").pop()!;

function mustDraft(id: string): Draft {
	const d = repos.drafts.get(id);
	if (!d) throw new PictureError("This draft was not found. It may have been deleted.");
	return d;
}

const sourceOf = (d: Draft): Source => Source.parse(d.source);

/** The draft's video shape: from its plan, else its settings. */
export function formatOfDraft(draftId: string): VideoFormat {
	const d = mustDraft(draftId);
	const p = VideoPlan.safeParse(d.plan);
	if (p.success) return formatOf(p.data.meta);
	return (d.settings as { format?: VideoFormat } | null)?.format === "vertical" ? "vertical" : "landscape";
}

/** How many scenes show each figure file. */
export function usage(plan: unknown): Map<string, number> {
	const out = new Map<string, number>();
	const p = VideoPlan.safeParse(plan);
	if (!p.success) return out;
	for (const c of p.data.chapters)
		for (const s of c.scenes) {
			const f = (s.props as { figure?: unknown }).figure;
			if (typeof f === "string") out.set(f, (out.get(f) ?? 0) + 1);
		}
	return out;
}

export function picturesState(draftId: string, vision: boolean): PicturesState {
	const d = mustDraft(draftId);
	const source = sourceOf(d);
	const used = usage(d.plan);
	const base = figureBaseFor(draftId);
	const pictures: PictureView[] = source.figures.map((f) => ({
		id: f.id,
		file: fileName(f),
		url: `${base}${encodeURIComponent(fileName(f))}`,
		caption: f.caption,
		origin: f.origin ?? "source",
		mustUse: !!f.mustUse,
		credit: f.credit ?? null,
		width: f.width,
		height: f.height,
		focus: f.focus ?? null,
		usedIn: used.get(fileName(f)) ?? 0,
		subject: f.search?.subject ?? null,
	}));
	return { pictures, vision, searched: source.pictureSearch ?? null };
}

function save(d: Draft, source: Source) {
	repos.drafts.update(d.id, { source });
}

/**
 * Copies pictures the user picked into the draft as their own: upright and at
 * most PICTURE_MAX_SIDE pixels when the fitter is there. Their own files are never changed.
 */
export async function addMine(draftId: string, paths: string[], fit: Fitter | null): Promise<{ added: number; skipped: string[] }> {
	const d = mustDraft(draftId);
	const source = sourceOf(d);
	const figures = [...source.figures];
	const skipped: string[] = [];
	let n = nextNumber(figures, "my");
	for (const path of paths) {
		const name = path.split(/[\\/]/).pop() ?? path;
		if (figures.length >= PICTURES_MAX) {
			skipped.push(`${name}: this video already has ${PICTURES_MAX} pictures`);
			continue;
		}
		const type = TYPES[extname(path).toLowerCase()];
		try {
			if (!type) throw new PictureError("not a PNG, JPEG, WebP or GIF picture");
			if ((await stat(path)).size > MAX_BYTES) throw new PictureError("larger than 25 MB");
			const data = await readFile(path);
			const { width, height } = imageSize(data);
			if (!width || !height) throw new PictureError("the picture could not be read");
			const orientation = type === "image/jpeg" ? jpegOrientation(data) : 1;
			const stem = join(draftDir(draftId), "source", "figures", `my-${String(n).padStart(3, "0")}`);
			const saved = await savePicture(data, stem, type === "image/jpeg" ? ".jpg" : extname(path).toLowerCase(), { width, height, orientation }, fit);
			// Not described yet: the user can write a caption, or the picture step asks the vision model.
			figures.push({ id: `my${n}`, file: `source/figures/${basename(saved.path)}`, caption: null, page: null, input: 0, width: saved.width, height: saved.height, mediaType: saved.mediaType, origin: "mine", mustUse: true });
			n++;
		} catch (err) {
			skipped.push(`${name}: ${err instanceof PictureError ? err.message : (err as Error).message}`);
		}
	}
	save(d, { ...source, figures });
	return { added: figures.length - source.figures.length, skipped };
}

export function updatePicture(draftId: string, id: string, patch: { caption?: string | null; mustUse?: boolean }): void {
	const d = mustDraft(draftId);
	const source = sourceOf(d);
	if (!source.figures.some((f) => f.id === id)) throw new PictureError("This picture was not found.");
	const figures = source.figures.map((f) =>
		f.id !== id ? f : { ...f, ...(patch.caption !== undefined ? { caption: patch.caption?.trim() || null } : {}), ...(patch.mustUse !== undefined ? { mustUse: patch.mustUse } : {}) },
	);
	save(d, { ...source, figures });
}

/** Removes a picture no scene shows, and its file. */
export async function removePicture(draftId: string, id: string): Promise<void> {
	const d = mustDraft(draftId);
	const source = sourceOf(d);
	const f = source.figures.find((x) => x.id === id);
	if (!f) throw new PictureError("This picture was not found.");
	const n = usage(d.plan).get(fileName(f)) ?? 0;
	if (n) throw new PictureError(`${n === 1 ? "A scene shows" : `${n} scenes show`} this picture. Change ${n === 1 ? "that scene" : "those scenes"} first.`);
	save(d, { ...source, figures: source.figures.filter((x) => x.id !== id) });
	// Text in the material may still point at a figure from it; only the user's own and web pictures lose their file.
	if (f.origin === "mine" || f.origin === "web") await rm(join(draftDir(draftId), "source", "figures", fileName(f)), { force: true });
}

/**
 * Swaps a web picture for another result of the same search. The file keeps its
 * name, so the scenes that show it change too; a result of another file type is skipped.
 */
export async function anotherPicture(draftId: string, id: string, ai: PlannerAi | null, deps: FindDeps): Promise<boolean> {
	const d = mustDraft(draftId);
	const source = sourceOf(d);
	const f = source.figures.find((x) => x.id === id);
	if (!f || f.origin !== "web" || !f.search) throw new PictureError("Only pictures found on the web can be swapped for another.");
	const need: PictureNeed = { chapter: f.search.chapter ?? 1, subject: f.search.subject, queries: f.search.queries.length ? f.search.queries : [f.search.subject], kind: "other", why: f.caption ?? f.search.subject };
	const exclude = new Set(source.figures.map((x) => x.credit?.pageUrl).filter((u): u is string => !!u));
	const found = await candidatesFor(need, deps, exclude);
	// candidatesFor keys by provider; also drop results whose page is one already in the draft.
	found.list = found.list.filter((c) => !exclude.has(c.credit.pageUrl));
	while (found.list.length) {
		const pick = await pickPicture(need, found, ai, deps);
		if (!pick) return false;
		found.list = found.list.filter((c) => c.key !== pick.candidate.key);
		const img = await downloadImage(pick.candidate.full, deps).catch(() => null);
		if (!img || Math.max(img.width, img.height) < 480) continue;
		// Saved beside the old file first (fitted like any picture), then moved over it when the type matches.
		const stem = join(draftDir(draftId), "source", "figures", `swap-${randomUUID().slice(0, 8)}`);
		const ext = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif" }[img.mediaType] ?? ".jpg";
		const saved = await savePicture(img.data, stem, ext, { width: img.width, height: img.height, orientation: img.mediaType === "image/jpeg" ? jpegOrientation(img.data) : 1 }, deps.fit ?? null, deps.signal);
		if (saved.mediaType !== f.mediaType) {
			await rm(saved.path, { force: true });
			continue;
		}
		await rename(saved.path, join(draftDir(draftId), f.file));
		const fresh = sourceOf(mustDraft(draftId));
		save(d, {
			...fresh,
			figures: fresh.figures.map((x) => {
				if (x.id !== id) return x;
				const { focus: _old, ...rest } = x;
				return { ...rest, caption: pick.description, credit: pick.candidate.credit, width: saved.width, height: saved.height, ...(pick.focus ? { focus: pick.focus } : {}) };
			}),
		});
		return true;
	}
	return false;
}

/** Credit lines of the pictures a plan shows (for the YouTube description), and picture details for the video. */
export function pictureCredits(d: Pick<Draft, "source" | "plan">): { lines: { title: string; author: string | null; license: string; sourceUrl: string; line: string | null }[]; meta: Record<string, FigureMeta> } {
	const s = Source.safeParse(d.source);
	if (!s.success) return { lines: [], meta: {} };
	const used = usage(d.plan);
	const lines = [];
	for (const f of s.data.figures) {
		if (f.credit && used.has(fileName(f))) lines.push({ title: f.credit.title, author: f.credit.creator, license: f.credit.license, sourceUrl: f.credit.pageUrl, line: f.credit.line });
	}
	return { lines, meta: figureMetaOf(s.data.figures) };
}
