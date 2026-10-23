/**
 * Snapshot test for the scene library: renders one still per scene type in
 * every visual style through the real Remotion bundle and headless Chrome.
 * Slow (a few minutes), so it runs with `npm run test:render`, not with the unit tests.
 *
 * - Full-size stills go to tests/__stills__ for review.
 * - Each still is compared with its baseline in tests/__snapshots__/scenes
 *   (a 320×180 PNG) by SSIM on the brightness, computed here (the ffmpeg that
 *   ships with Remotion has no ssim filter). A missing baseline is written on the
 *   first run; UPDATE_SNAPSHOTS=1 rewrites them after an intended change.
 * - Every still must have real content, and switching style must change the pixels.
 *
 * The figure scene reads a real figure through the same locked-down media server
 * the render worker uses.
 */
import { bundle } from "@remotion/bundler";
import { openBrowser, renderStill, selectComposition } from "@remotion/renderer";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SCENE_TYPES, STYLE_IDS, VideoPlan, type VideoPlanInput } from "@shared/plan/schema";
import { computeTimeline } from "@shared/plan/timing";
import { startMediaServer, type MediaServer } from "../../src/main/render/media-server";
import { galleryPlanFor } from "../../video/src/samples/gallery";

const run = promisify(execFile);
const OUT = resolve("tests/__stills__");
const SNAP = resolve("tests/__snapshots__/scenes");
const FFMPEG = resolve("node_modules/@remotion/compositor-win32-x64-msvc/ffmpeg.exe");
const UPDATE = process.env.UPDATE_SNAPSHOTS === "1";
/** SSIM against the baseline; 1 = identical. Small anti-aliasing changes stay well above this. */
const MIN_SSIM = 0.97;
// Reuse the browser the app already downloaded, if present.
const APP_CHROME = join(process.env.APPDATA ?? "", "Explainer Studio/engine/node_modules/.remotion/chrome-headless-shell/win64/chrome-headless-shell-win64/chrome-headless-shell.exe");
const browserExecutable = existsSync(APP_CHROME) ? APP_CHROME : null;

let serveUrl = "";
let browser: Awaited<ReturnType<typeof openBrowser>>;
let media: MediaServer;
let figureBase = "";
const tmp = mkdtempSync(join(tmpdir(), "es-stills-"));

/** A frame near the end where every reveal has happened but the exit fade has not started. */
function settledFrame(plan: VideoPlanInput): number {
	return computeTimeline(VideoPlan.parse(plan)).durationInFrames - 14;
}

const SW = 320;
const SH = 180;

/** An image as 320×180 brightness values (ffmpeg scales and decodes it). */
async function luma(file: string): Promise<Float64Array> {
	const { stdout } = await run(FFMPEG, ["-hide_banner", "-loglevel", "error", "-i", file, "-vf", `scale=${SW}:${SH}`, "-f", "image2pipe", "-c:v", "rawvideo", "-pix_fmt", "gray", "-"], { windowsHide: true, encoding: "buffer", maxBuffer: 1 << 24 });
	const buf = stdout as unknown as Buffer;
	if (buf.length !== SW * SH) throw new Error(`unexpected frame size ${buf.length} for ${file}`);
	return Float64Array.from(buf);
}

/** Mean SSIM over 8×8 windows (Wang et al. constants for 8-bit images). */
export function ssimOf(a: Float64Array, b: Float64Array): number {
	const C1 = (0.01 * 255) ** 2;
	const C2 = (0.03 * 255) ** 2;
	let total = 0;
	let n = 0;
	for (let y = 0; y + 8 <= SH; y += 4)
		for (let x = 0; x + 8 <= SW; x += 4) {
			let ma = 0;
			let mb = 0;
			for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) {
				ma += a[(y + j) * SW + x + i]!;
				mb += b[(y + j) * SW + x + i]!;
			}
			ma /= 64;
			mb /= 64;
			let va = 0;
			let vb = 0;
			let cov = 0;
			for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) {
				const da = a[(y + j) * SW + x + i]! - ma;
				const db = b[(y + j) * SW + x + i]! - mb;
				va += da * da;
				vb += db * db;
				cov += da * db;
			}
			va /= 63;
			vb /= 63;
			cov /= 63;
			total += ((2 * ma * mb + C1) * (2 * cov + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2));
			n++;
		}
	return total / n;
}

const ssim = async (a: string, b: string) => ssimOf(await luma(a), await luma(b));

async function toBaseline(png: string, out: string) {
	await run(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", "-i", png, "-vf", `scale=${SW}:${SH}`, out], { windowsHide: true });
}

beforeAll(async () => {
	mkdirSync(OUT, { recursive: true });
	mkdirSync(SNAP, { recursive: true });
	// A real figure file in a draft folder, served like the render worker serves it.
	const draftId = randomUUID();
	const figDir = join(tmp, draftId, "source", "figures");
	mkdirSync(figDir, { recursive: true });
	media = await startMediaServer({ drafts: tmp, assets: tmp });
	figureBase = `${media.base}figure/${draftId}/`;
	serveUrl = await bundle({ entryPoint: resolve("video/src/index.ts") });
	browser = await openBrowser("chrome", { browserExecutable, chromeMode: "headless-shell" });
	// The figure: a frame of the sample video (a real, detailed picture).
	const sample = await selectComposition({ serveUrl, id: "Explainer", inputProps: {}, puppeteerInstance: browser, browserExecutable });
	await renderStill({ serveUrl, composition: { ...sample, width: 1200, height: 800 }, inputProps: {}, frame: 200, output: join(figDir, "in1-001.png"), overwrite: true, puppeteerInstance: browser, browserExecutable, imageFormat: "png" });
}, 240_000);

afterAll(async () => {
	await browser?.close({ silent: true });
	await media?.close();
	rmSync(tmp, { recursive: true, force: true });
});

const hashes: Record<string, number> = {};

describe.each(STYLE_IDS)("style %s", (style) => {
	it.each(SCENE_TYPES)("snapshot of %s", async (type) => {
		const plan = galleryPlanFor(type);
		const inputProps = { plan, style, figureBase };
		const composition = await selectComposition({ serveUrl, id: "Explainer", inputProps, puppeteerInstance: browser, browserExecutable });
		const file = join(OUT, `${style}-${type}.png`);
		await renderStill({ serveUrl, composition, inputProps, frame: settledFrame(plan), output: file, overwrite: true, puppeteerInstance: browser, browserExecutable, imageFormat: "png" });
		const bytes = statSync(file).size;
		// A blank or near-blank 1920x1080 PNG compresses to a few KB.
		expect(bytes, `${file} looks empty`).toBeGreaterThan(40_000);
		hashes[`${style}:${type}`] = bytes;

		const base = join(SNAP, `${style}-${type}.png`);
		if (UPDATE || !existsSync(base)) {
			await toBaseline(file, base);
			return;
		}
		const score = await ssim(file, base);
		if (score < MIN_SSIM) {
			copyFileSync(file, join(OUT, `${style}-${type}.FAILED.png`));
			expect.fail(`${style}/${type} differs from its snapshot (SSIM ${score.toFixed(4)} < ${MIN_SSIM}). See tests/__stills__; run with UPDATE_SNAPSHOTS=1 if the change is intended.`);
		}
	}, 120_000);
});

describe("styles", () => {
	it("change the look of every scene type", () => {
		for (const type of SCENE_TYPES) {
			const sizes = STYLE_IDS.map((st) => hashes[`${st}:${type}`]);
			expect(new Set(sizes).size, `${type}: ${sizes.join(", ")}`).toBeGreaterThan(STYLE_IDS.length - 2);
		}
	});

	it("figure stills show the real figure, not the placeholder", async () => {
		const plan = galleryPlanFor("figure");
		const inputProps = { plan, style: "clean" };
		const composition = await selectComposition({ serveUrl, id: "Explainer", inputProps, puppeteerInstance: browser, browserExecutable });
		const file = join(tmp, "placeholder.png");
		await renderStill({ serveUrl, composition, inputProps, frame: settledFrame(plan), output: file, overwrite: true, puppeteerInstance: browser, browserExecutable, imageFormat: "png" });
		expect(await ssim(file, join(OUT, "clean-figure.png"))).toBeLessThan(0.9);
	}, 120_000);
});
