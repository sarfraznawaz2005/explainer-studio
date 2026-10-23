/**
 * The brand kit in real renders: intro, watermark and outro, drawn by the real
 * Remotion bundle in headless Chrome, with the logo read through the same
 * locked-down media server the render worker uses (es-media URLs rewritten the same way).
 * Runs with `npm run test:render`.
 *
 * Each still is compared with the same moment of the video without a brand kit
 * (it must differ where the brand is, and only there for the watermark), and with
 * its baseline in tests/__snapshots__/brand (SSIM, as in the scene snapshots).
 */
import { bundle } from "@remotion/bundler";
import { openBrowser, renderStill, selectComposition } from "@remotion/renderer";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { brandStamp, defaultBrandKit } from "@shared/brand";
import { VideoPlan, type VideoPlanInput } from "@shared/plan/schema";
import { computeTimeline } from "@shared/plan/timing";
import { rewriteMedia, startMediaServer, type MediaServer } from "../../src/main/render/media-server";
import { SAMPLE_PLAN } from "../../video/src/samples/web-page-journey";

const run = promisify(execFile);
const OUT = resolve("tests/__stills__");
const SNAP = resolve("tests/__snapshots__/brand");
const FFMPEG = resolve("node_modules/@remotion/compositor-win32-x64-msvc/ffmpeg.exe");
const UPDATE = process.env.UPDATE_SNAPSHOTS === "1";
const MIN_SSIM = 0.97;
const APP_CHROME = join(process.env.APPDATA ?? "", "Explainer Studio/engine/node_modules/.remotion/chrome-headless-shell/win64/chrome-headless-shell-win64/chrome-headless-shell.exe");
const browserExecutable = existsSync(APP_CHROME) ? APP_CHROME : null;
const SW = 320;
const SH = 180;

let serveUrl = "";
let browser: Awaited<ReturnType<typeof openBrowser>>;
let media: MediaServer;
const tmp = mkdtempSync(join(tmpdir(), "es-brand-"));
const kitId = randomUUID();
const LOGO = "logo-0123abcd.png";

async function luma(file: string): Promise<Float64Array> {
	const { stdout } = await run(FFMPEG, ["-hide_banner", "-loglevel", "error", "-i", file, "-vf", `scale=${SW}:${SH}`, "-f", "image2pipe", "-c:v", "rawvideo", "-pix_fmt", "gray", "-"], { windowsHide: true, encoding: "buffer", maxBuffer: 1 << 24 });
	return Float64Array.from(stdout as unknown as Buffer);
}

/** Mean SSIM over 8×8 windows inside a box (default: the whole frame). */
function ssimOf(a: Float64Array, b: Float64Array, box = { x0: 0, y0: 0, x1: SW, y1: SH }): number {
	const C1 = (0.01 * 255) ** 2;
	const C2 = (0.03 * 255) ** 2;
	let total = 0;
	let n = 0;
	for (let y = box.y0; y + 8 <= box.y1; y += 4)
		for (let x = box.x0; x + 8 <= box.x1; x += 4) {
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

/** Mean brightness change inside a box. */
function meanDiff(a: Float64Array, b: Float64Array, box: { x0: number; y0: number; x1: number; y1: number }): number {
	let d = 0;
	let n = 0;
	for (let y = box.y0; y < box.y1; y++)
		for (let x = box.x0; x < box.x1; x++) {
			d += Math.abs(a[y * SW + x]! - b[y * SW + x]!);
			n++;
		}
	return d / n;
}

const FULL = { x0: 0, y0: 0, x1: SW, y1: SH };
const ch = SAMPLE_PLAN.chapters;
const stamp = () => brandStamp({ ...defaultBrandKit("Science with Sam"), tagline: "Big ideas, made simple" }, `es-media://brand/${kitId}/${LOGO}`, { title: "How the web works", episode: 2 });
const branded: VideoPlanInput = { ...SAMPLE_PLAN, chapters: ch, meta: { ...SAMPLE_PLAN.meta, brand: stamp() } };
const plain: VideoPlanInput = SAMPLE_PLAN;

async function still(plan: VideoPlanInput, frame: number, name: string): Promise<string> {
	const inputProps = rewriteMedia({ plan }, media.base) as Record<string, unknown>;
	const composition = await selectComposition({ serveUrl, id: "Explainer", inputProps, puppeteerInstance: browser, browserExecutable });
	const file = join(OUT, `${name}.png`);
	await renderStill({ serveUrl, composition, inputProps, frame, output: file, overwrite: true, puppeteerInstance: browser, browserExecutable, imageFormat: "png" });
	return file;
}

async function matchesBaseline(file: string, name: string) {
	const base = join(SNAP, `${name}.png`);
	if (UPDATE || !existsSync(base)) {
		await run(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", "-i", file, "-vf", `scale=${SW}:${SH}`, base], { windowsHide: true });
		return;
	}
	const score = ssimOf(await luma(file), await luma(base));
	if (score < MIN_SSIM) {
		copyFileSync(file, join(OUT, `${name}.FAILED.png`));
		expect.fail(`${name} differs from its snapshot (SSIM ${score.toFixed(4)}). Run with UPDATE_SNAPSHOTS=1 if the change is intended.`);
	}
}

beforeAll(async () => {
	mkdirSync(OUT, { recursive: true });
	mkdirSync(SNAP, { recursive: true });
	mkdirSync(join(tmp, "brand", kitId), { recursive: true });
	media = await startMediaServer({ drafts: tmp, assets: tmp });
	serveUrl = await bundle({ entryPoint: resolve("video/src/index.ts") });
	browser = await openBrowser("chrome", { browserExecutable, chromeMode: "headless-shell" });
	// The logo: a square picture rendered from the sample (a real image file).
	const sample = await selectComposition({ serveUrl, id: "Explainer", inputProps: {}, puppeteerInstance: browser, browserExecutable });
	await renderStill({ serveUrl, composition: { ...sample, width: 360, height: 360 }, inputProps: {}, frame: 120, output: join(tmp, "brand", kitId, LOGO), overwrite: true, puppeteerInstance: browser, browserExecutable, imageFormat: "png" });
}, 240_000);

afterAll(async () => {
	await browser?.close({ silent: true });
	await media?.close();
	rmSync(tmp, { recursive: true, force: true });
});

describe("brand kit in the rendered video", () => {
	const tb = computeTimeline(VideoPlan.parse(branded));
	const tp = computeTimeline(VideoPlan.parse(plain));

	it("adds an intro with logo, channel name and episode before the first scene", async () => {
		const frame = Math.round(tb.intro * 0.75);
		const withBrand = await still(branded, frame, "brand-intro");
		const without = await still(plain, frame, "brand-intro-plain");
		// Measured: about 22 levels of brightness change on average (0 = the same picture).
		expect(meanDiff(await luma(withBrand), await luma(without), FULL), "the intro must replace the first scene").toBeGreaterThan(8);
		await matchesBaseline(withBrand, "intro");
	}, 120_000);

	it("shows the watermark in the bottom-right corner, and changes nothing else", async () => {
		const f = 8 * tp.fps;
		const withBrand = await still(branded, tb.intro + f, "brand-watermark");
		const without = await still(plain, f, "brand-watermark-plain");
		const a = await luma(withBrand);
		const b = await luma(without);
		// Bottom-right corner: the watermark sits 60 px from the right and 84 px from the bottom (1920×1080).
		// Measured: about 12 in the corner, under 0.1 everywhere else.
		const corner = { x0: Math.round(SW * 0.91), y0: Math.round(SH * 0.83), x1: Math.round(SW * 0.98), y1: Math.round(SH * 0.93) };
		expect(meanDiff(a, b, corner), "watermark pixels").toBeGreaterThan(5);
		expect(meanDiff(a, b, { x0: 0, y0: 0, x1: Math.round(SW * 0.75), y1: SH }), "the rest of the frame is the same scene").toBeLessThan(1);
		await matchesBaseline(withBrand, "watermark");
	}, 120_000);

	it("adds an outro with a call to action and end screen space after the last scene", async () => {
		const withBrand = await still(branded, tb.durationInFrames - tb.outro + 2 * tb.fps, "brand-outro");
		const without = await still(plain, tp.durationInFrames - 1, "brand-outro-plain");
		// Measured: about 18.
		expect(meanDiff(await luma(withBrand), await luma(without), FULL), "the outro is its own card").toBeGreaterThan(8);
		await matchesBaseline(withBrand, "outro");
	}, 120_000);
});
