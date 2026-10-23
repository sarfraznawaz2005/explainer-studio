import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { DocsRunner } from "../ingest/docs-runner";

/**
 * Pictures for a video are kept upright (the camera's rotation tag applied) and
 * no larger than PICTURE_MAX_SIDE on the long side, so renders stay fast and the
 * vision model accepts them. The work is done by docs.py ("fit", Pillow) in the
 * voice engine's Python. Without it the pictures are kept as they are.
 */
export const PICTURE_MAX_SIDE = 2160;

export type FitJob = { image: string; out: string; max: number };
export type FitResult = { out: string; width: number; height: number } | { error: string };
/** Fits pictures; `out` has no extension (".jpg", or ".png" for transparent pictures). Results by input path. */
export type Fitter = (jobs: FitJob[], signal?: AbortSignal) => Promise<Map<string, FitResult>>;

export function fitterFrom(runner: DocsRunner | null, tmpDir: string): Fitter | null {
	if (!runner) return null;
	return async (jobs, signal) => {
		const out = new Map<string, FitResult>();
		if (!jobs.length) return out;
		await mkdir(tmpDir, { recursive: true });
		const file = join(tmpDir, `fit-${randomUUID()}.json`);
		await writeFile(file, JSON.stringify(jobs));
		try {
			await runner(
				["fit", "--jobs", file],
				(m) => {
					if (m.type !== "fit" || typeof m.image !== "string") return;
					if (typeof m.error === "string") out.set(m.image, { error: m.error });
					else if (typeof m.out === "string" && typeof m.width === "number" && typeof m.height === "number") out.set(m.image, { out: m.out, width: m.width, height: m.height });
				},
				signal,
			);
		} finally {
			await rm(file, { force: true });
		}
		return out;
	};
}

/**
 * Saves picture bytes as `<stem>.jpg|.png`: fitted when a fitter is there and the
 * picture is too big or turned by a rotation tag, else as they are (`ext`).
 */
export async function savePicture(
	data: Buffer,
	stem: string,
	ext: string,
	size: { width: number; height: number; orientation: number },
	fit: Fitter | null,
	signal?: AbortSignal,
): Promise<{ path: string; width: number; height: number; mediaType: string }> {
	await mkdir(dirname(stem), { recursive: true });
	const needs = Math.max(size.width, size.height) > PICTURE_MAX_SIDE || size.orientation > 1;
	if (fit && needs) {
		const raw = `${stem}.raw${ext}`;
		await writeFile(raw, data);
		try {
			const r = (await fit([{ image: raw, out: stem, max: PICTURE_MAX_SIDE }], signal)).get(raw);
			if (r && "out" in r) return { path: r.out, width: r.width, height: r.height, mediaType: r.out.endsWith(".png") ? "image/png" : "image/jpeg" };
		} finally {
			await rm(raw, { force: true });
		}
	}
	const path = `${stem}${ext}`;
	await writeFile(path, data, { flag: "wx" });
	// A rotation tag of 5 to 8 means the picture shows turned a quarter: width and height swap on screen.
	const turned = size.orientation >= 5;
	return { path, width: turned ? size.height : size.width, height: turned ? size.width : size.height, mediaType: MEDIA[ext] ?? "image/jpeg" };
}

const MEDIA: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif" };
