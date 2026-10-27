/**
 * Burned-in captions through the real Remotion bundle and headless Chrome:
 * each caption look in a wide and a vertical frame, mid-sentence. Stills go to
 * tests/__stills__/captions-*.png for review. Runs with `npm run test:render`.
 */
import { bundle } from "@remotion/bundler";
import { openBrowser, renderStill, selectComposition } from "@remotion/renderer";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { captionBand, captionGroups, type CaptionStyle } from "@shared/plan/captions";
import { VideoPlan, type VideoPlanInput } from "@shared/plan/schema";
import { computeTimeline } from "@shared/plan/timing";
import { SAMPLE_PLAN } from "../../video/src/samples/web-page-journey";

const OUT = resolve("tests/__stills__");
const APP_CHROME = join(process.env.APPDATA ?? "", "Explainer Studio/engine/node_modules/.remotion/chrome-headless-shell/win64/chrome-headless-shell-win64/chrome-headless-shell.exe");
const browserExecutable = existsSync(APP_CHROME) ? APP_CHROME : null;

let serveUrl = "";
let browser: Awaited<ReturnType<typeof openBrowser>>;

beforeAll(async () => {
	mkdirSync(OUT, { recursive: true });
	serveUrl = await bundle({ entryPoint: resolve("video/src/index.ts") });
	browser = await openBrowser("chrome", { browserExecutable, chromeMode: "headless-shell" });
}, 240_000);

afterAll(async () => {
	await browser?.close({ silent: true });
});

const sized = (captions: CaptionStyle, width: number, height: number): VideoPlanInput => ({ ...SAMPLE_PLAN, meta: { ...SAMPLE_PLAN.meta, captions, width, height } });

async function still(name: string, plan: VideoPlanInput, frame: number) {
	const inputProps = { plan };
	const composition = await selectComposition({ serveUrl, id: "Explainer", inputProps, puppeteerInstance: browser, browserExecutable });
	const file = join(OUT, `captions-${name}.png`);
	await renderStill({ serveUrl, composition, inputProps, frame, output: file, overwrite: true, puppeteerInstance: browser, browserExecutable, imageFormat: "png" });
	return file;
}

/** How much the caption band differs between two stills (0 to 1). */
async function bandChange(a: string, b: string, band: { bottom: number; height: number }) {
	const [ia, ib] = await Promise.all([loadImage(a), loadImage(b)]);
	const read = (img: typeof ia) => {
		const c = createCanvas(img.width, img.height);
		const g = c.getContext("2d");
		g.drawImage(img, 0, 0);
		return g.getImageData(0, img.height - band.bottom - band.height, img.width, band.height).data;
	};
	const [da, db] = [read(ia), read(ib)];
	let diff = 0;
	for (let i = 0; i < da.length; i += 4) if (Math.abs(da[i]! - db[i]!) + Math.abs(da[i + 1]! - db[i + 1]!) + Math.abs(da[i + 2]! - db[i + 2]!) > 60) diff++;
	return diff / (da.length / 4);
}

describe("captions", () => {
	for (const [shape, width, height] of [["wide", 1920, 1080], ["vertical", 1080, 1920]] as const) {
		it(`draws each caption look in the band (${shape})`, async () => {
			const plan = VideoPlan.parse(sized("pill", width, height));
			const groups = captionGroups(computeTimeline(plan), width, height);
			// Mid-way through a group in the second scene: its words are on screen.
			const g = groups[Math.floor(groups.length / 3)]!;
			const frame = Math.round((g.from + g.to) / 2);
			const off = await still(`${shape}-off`, sized("off", width, height), frame);
			for (const kind of ["pill", "karaoke", "pop"] as const) {
				const file = await still(`${shape}-${kind}`, sized(kind, width, height), frame);
				const change = await bandChange(off, file, captionBand(kind, width, height));
				expect(change, `${kind} draws in its band`).toBeGreaterThan(0.01);
			}
		}, 240_000);
	}
});
