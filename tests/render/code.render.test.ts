/**
 * "AI free-form" code videos through the real Remotion bundle and headless Chrome.
 * Stills go to tests/__stills__/code-*.png. Runs with `npm run test:render`.
 *  - hand-written AI-style code draws the frames;
 *  - a crash in one scene draws the built-in scene there, and only there.
 */
import { bundle } from "@remotion/bundler";
import { openBrowser, renderStill, selectComposition } from "@remotion/renderer";
import { loadImage, createCanvas } from "@napi-rs/canvas";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { VideoPlan, type VideoPlanInput } from "@shared/plan/schema";
import { computeTimeline } from "@shared/plan/timing";
import { SAMPLE_PLAN } from "../../video/src/samples/web-page-journey";
import { CRASH_IN_SCENE_2, SAMPLE_CODE } from "../../video/src/samples/code-samples";

const OUT = resolve("tests/__stills__");
const APP_CHROME = join(process.env.APPDATA ?? "", "Explainer Studio/engine/node_modules/.remotion/chrome-headless-shell/win64/chrome-headless-shell-win64/chrome-headless-shell.exe");
const browserExecutable = existsSync(APP_CHROME) ? APP_CHROME : null;

let serveUrl = "";
let browser: Awaited<ReturnType<typeof openBrowser>>;

const withCode = (source: string, vertical = false): VideoPlanInput => ({
	...SAMPLE_PLAN,
	meta: { ...SAMPLE_PLAN.meta, style: "code", code: { name: "Test", idea: "", source }, ...(vertical ? { width: 1080, height: 1920 } : {}) },
});
const timeline = (plan: VideoPlanInput) => computeTimeline(VideoPlan.parse(plan));

beforeAll(async () => {
	mkdirSync(OUT, { recursive: true });
	serveUrl = await bundle({ entryPoint: resolve("video/src/index.ts") });
	browser = await openBrowser("chrome", { browserExecutable, chromeMode: "headless-shell" });
}, 240_000);

afterAll(async () => {
	await browser?.close({ silent: true });
});

async function still(name: string, plan: VideoPlanInput, frame: number) {
	const inputProps = { plan };
	const composition = await selectComposition({ serveUrl, id: "Explainer", inputProps, puppeteerInstance: browser, browserExecutable });
	const file = join(OUT, `code-${name}.png`);
	await renderStill({ serveUrl, composition, inputProps, frame, output: file, overwrite: true, puppeteerInstance: browser, browserExecutable, imageFormat: "png" });
	return file;
}

/** The colour of one pixel, as #rrggbb. */
async function pixel(file: string, x: number, y: number): Promise<string> {
	const img = await loadImage(file);
	const c = createCanvas(img.width, img.height);
	const ctx = c.getContext("2d");
	ctx.drawImage(img, 0, 0);
	const [r, g, b] = ctx.getImageData(x, y, 1, 1).data;
	return `#${[r!, g!, b!].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

describe("AI code videos", () => {
	it("draws every scene with the AI's code", async () => {
		const plan = withCode(SAMPLE_CODE);
		const t = timeline(plan);
		for (const [i, s] of t.scenes.slice(0, 4).entries()) {
			const file = await still(`sample-${i + 1}`, plan, s.from + Math.min(s.durationInFrames - 1, 45));
			expect(statSync(file).size, file).toBeGreaterThan(20_000);
			// The code's own dark gradient, not a built-in look.
			const [r, g, b] = (await pixel(file, 6, 6)).match(/\w\w/g)!.map((h) => parseInt(h, 16));
			expect(Math.max(r!, g!, b!), "dark AI background").toBeLessThan(80);
		}
		const tall = withCode(SAMPLE_CODE, true);
		expect(statSync(await still("sample-vertical", tall, timeline(tall).scenes[1]!.from + 45)).size).toBeGreaterThan(20_000);
	}, 240_000);

	it("draws the built-in scene where the code crashes, and the code again after", async () => {
		const plan = withCode(CRASH_IN_SCENE_2);
		const t = timeline(plan);
		const at = (i: number) => t.scenes[i]!.from + 30;
		expect(await pixel(await still("crash-scene-1", plan, at(0)), 6, 6)).toBe("#102030");
		expect(await pixel(await still("crash-scene-2", plan, at(1)), 6, 6)).not.toBe("#102030");
		expect(await pixel(await still("crash-scene-3", plan, at(2)), 6, 6)).toBe("#102030");
	}, 240_000);

	it("draws the built-in scenes when the code does not compile", async () => {
		const plan = withCode("export default function Video( {");
		const file = await still("broken", plan, timeline(plan).scenes[0]!.from + 30);
		expect(await pixel(file, 6, 6)).not.toBe("#102030");
		expect(statSync(file).size).toBeGreaterThan(20_000);
	}, 120_000);
});
