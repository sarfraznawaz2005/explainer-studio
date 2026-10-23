/**
 * Vertical (9:16) videos for Shorts, TikTok and Reels: one still per scene type,
 * drawn at 1080×1920 through the real Remotion bundle and headless Chrome.
 * Stills go to tests/__stills__/vertical-*.png for review, plus a contact sheet
 * of all of them (vertical-sheet.png). Runs with `npm run test:render`.
 * Every still must have real content.
 */
import { bundle } from "@remotion/bundler";
import { openBrowser, renderStill, selectComposition } from "@remotion/renderer";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { brandStamp, defaultBrandKit } from "@shared/brand";
import { SCENE_TYPES, VideoPlan, type VideoPlanInput } from "@shared/plan/schema";
import { computeTimeline } from "@shared/plan/timing";
import { galleryPlanFor } from "../../video/src/samples/gallery";
import { SAMPLE_PLAN } from "../../video/src/samples/web-page-journey";

const OUT = resolve("tests/__stills__");
const APP_CHROME = join(process.env.APPDATA ?? "", "Explainer Studio/engine/node_modules/.remotion/chrome-headless-shell/win64/chrome-headless-shell-win64/chrome-headless-shell.exe");
const browserExecutable = existsSync(APP_CHROME) ? APP_CHROME : null;
const STYLE = process.env.VERTICAL_STYLE ?? "clean";

let serveUrl = "";
let browser: Awaited<ReturnType<typeof openBrowser>>;

const vertical = (plan: VideoPlanInput): VideoPlanInput => ({ ...plan, meta: { ...plan.meta, width: 1080, height: 1920 } });
const settledFrame = (plan: VideoPlanInput) => computeTimeline(VideoPlan.parse(plan)).durationInFrames - 14;

beforeAll(async () => {
	mkdirSync(OUT, { recursive: true });
	serveUrl = await bundle({ entryPoint: resolve("video/src/index.ts") });
	browser = await openBrowser("chrome", { browserExecutable, chromeMode: "headless-shell" });
}, 240_000);

afterAll(async () => {
	await browser?.close({ silent: true });
});

describe(`vertical scenes (${STYLE})`, () => {
	it.each(SCENE_TYPES)("%s", async (type) => {
		const plan = vertical(galleryPlanFor(type));
		const inputProps = { plan, style: STYLE };
		const composition = await selectComposition({ serveUrl, id: "Explainer", inputProps, puppeteerInstance: browser, browserExecutable });
		expect([composition.width, composition.height]).toEqual([1080, 1920]);
		const file = join(OUT, `vertical-${STYLE}-${type}.png`);
		await renderStill({ serveUrl, composition, inputProps, frame: settledFrame(plan), output: file, overwrite: true, puppeteerInstance: browser, browserExecutable, imageFormat: "png" });
		expect(statSync(file).size, `${file} looks empty`).toBeGreaterThan(30_000);
	}, 120_000);

	it("brand intro, watermark with progress bar, and outro (no YouTube end screen on Shorts)", async () => {
		// The default kit has an outro with a YouTube end screen; a vertical video must leave it out.
		const stamp = brandStamp({ ...defaultBrandKit("Science with Sam"), tagline: "Big ideas, made simple" }, null, { title: "How the web works", episode: 2 });
		expect(stamp.endScreen).toBe(true);
		const plan = vertical({ ...SAMPLE_PLAN, chapters: SAMPLE_PLAN.chapters.slice(0, 2).map((c) => ({ ...c, scenes: c.scenes.slice(0, 1) })), meta: { ...SAMPLE_PLAN.meta, brand: stamp } });
		const tl = computeTimeline(VideoPlan.parse(plan));
		const inputProps = { plan, style: STYLE };
		const composition = await selectComposition({ serveUrl, id: "Explainer", inputProps, puppeteerInstance: browser, browserExecutable });
		const shots = { intro: Math.round(tl.intro * 0.7), scene: tl.intro + 60, outro: tl.durationInFrames - Math.round(tl.outro * 0.4) };
		for (const [name, frame] of Object.entries(shots)) {
			const file = join(OUT, `vertical-${STYLE}-brand-${name}.png`);
			await renderStill({ serveUrl, composition, inputProps, frame, output: file, overwrite: true, puppeteerInstance: browser, browserExecutable, imageFormat: "png" });
			expect(statSync(file).size, file).toBeGreaterThan(20_000);
		}
	}, 120_000);

	it("contact sheet", async () => {
		const cols = 8;
		const [w, h] = [270, 480];
		const sheet = createCanvas(cols * w, Math.ceil(SCENE_TYPES.length / cols) * h);
		const g = sheet.getContext("2d");
		for (const [i, t] of SCENE_TYPES.entries()) {
			g.drawImage(await loadImage(join(OUT, `vertical-${STYLE}-${t}.png`)), (i % cols) * w, Math.floor(i / cols) * h, w, h);
			g.fillStyle = "#e11d48";
			g.font = "bold 18px sans-serif";
			g.fillText(t, (i % cols) * w + 6, Math.floor(i / cols) * h + 22);
		}
		writeFileSync(join(OUT, `vertical-${STYLE}-sheet.png`), sheet.toBuffer("image/png"));
	}, 120_000);
});
