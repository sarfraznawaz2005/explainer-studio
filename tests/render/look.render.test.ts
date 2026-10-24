/**
 * AI free-form looks: a few very different look recipes, drawn through the real
 * Remotion bundle and headless Chrome. Stills go to tests/__stills__/look-*.png,
 * plus a contact sheet (look-sheet.png). Runs with `npm run test:render`.
 * Every still must have real content, and different looks must give different pictures.
 */
import { bundle } from "@remotion/bundler";
import { openBrowser, renderStill, selectComposition } from "@remotion/renderer";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_LOOK, LookRecipe, type LookRecipeInput } from "@shared/plan/look";
import { VideoPlan, type SceneType, type VideoPlanInput } from "@shared/plan/schema";
import { computeTimeline } from "@shared/plan/timing";
import { galleryPlanFor } from "../../video/src/samples/gallery";

const OUT = resolve("tests/__stills__");
const APP_CHROME = join(process.env.APPDATA ?? "", "Explainer Studio/engine/node_modules/.remotion/chrome-headless-shell/win64/chrome-headless-shell-win64/chrome-headless-shell.exe");
const browserExecutable = existsSync(APP_CHROME) ? APP_CHROME : null;

const look = (over: Partial<LookRecipeInput>): LookRecipe => LookRecipe.parse({ ...DEFAULT_LOOK, ...over });

/** Five looks an AI might design, from calm to loud. */
const LOOKS: Record<string, LookRecipe> = {
	warm: DEFAULT_LOOK,
	night: look({
		name: "Night sky",
		colors: { background: "#0b1026", surface: "#141a3a", text: "#f1f3ff", muted: "#a9b0d6", accent: "#ffd166", accent2: "#7dd3fc", accent3: "#f472b6", positive: "#86efac", background2: "#2b1d5c" },
		headingFont: "tech",
		bodyFont: "modern",
		corners: 18,
		shadow: "glow",
		glow: true,
		background: { kind: "glow", strength: 0.7, moving: true, angle: 135 },
		motion: { enter: "blur", bounce: "none", speed: "slow" },
	}),
	poster: look({
		name: "Retro poster",
		colors: { background: "#fff1d6", surface: "#fffaf0", text: "#1d1a16", muted: "#5a4f43", accent: "#e63946", accent2: "#1d3557", accent3: "#f4a261", positive: "#2a9d8f", background2: "#ffd59e" },
		headingFont: "bold",
		bodyFont: "friendly",
		headingWeight: 900,
		corners: 0,
		line: { width: 4, dashed: false },
		shadow: "hard",
		background: { kind: "rays", strength: 0.6, moving: true, angle: 0 },
		motion: { enter: "pop", bounce: "lively", speed: "fast" },
	}),
	kids: look({
		name: "Crayon garden",
		colors: { background: "#eafbe7", surface: "#ffffff", text: "#20301f", muted: "#4e5f4c", accent: "#ff7b00", accent2: "#3a86ff", accent3: "#c026d3", positive: "#16a34a", background2: "#c8f2c0" },
		headingFont: "comic",
		bodyFont: "soft",
		corners: 34,
		line: { width: 3, dashed: true },
		texture: "pencil",
		background: { kind: "shapes", strength: 0.7, moving: true, angle: 0 },
		motion: { enter: "drop", bounce: "lively", speed: "normal" },
	}),
	ledger: look({
		name: "Old ledger",
		colors: { background: "#f3ead7", surface: "#fbf6ea", text: "#2b2118", muted: "#6a5a48", accent: "#7f1d1d", accent2: "#1e3a5f", accent3: "#8a6d1f", positive: "#3f6212", background2: "#e2d3b3" },
		headingFont: "typewriter",
		bodyFont: "classic",
		corners: 2,
		line: { width: 1, dashed: false },
		shadow: "none",
		background: { kind: "ruled", strength: 0.6, moving: false, angle: 0 },
		motion: { enter: "slide", bounce: "none", speed: "normal" },
	}),
};
const TYPES: SceneType[] = ["title", "bullets", "flow", "chart", "quiz"];

let serveUrl = "";
let browser: Awaited<ReturnType<typeof openBrowser>>;
const files: Record<string, string> = {};

const withLook = (plan: VideoPlanInput, l: LookRecipe, vertical = false): VideoPlanInput => ({ ...plan, meta: { ...plan.meta, style: "free", look: l, ...(vertical ? { width: 1080, height: 1920 } : {}) } });
const settledFrame = (plan: VideoPlanInput) => computeTimeline(VideoPlan.parse(plan)).durationInFrames - 14;

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
	const file = join(OUT, `look-${name}.png`);
	await renderStill({ serveUrl, composition, inputProps, frame, output: file, overwrite: true, puppeteerInstance: browser, browserExecutable, imageFormat: "png" });
	files[name] = file;
	return file;
}

describe("AI free-form looks", () => {
	for (const [id, l] of Object.entries(LOOKS)) {
		it.each(TYPES)(`${id}: %s`, async (type) => {
			const plan = withLook(galleryPlanFor(type), l);
			const file = await still(`${id}-${type}`, plan, settledFrame(plan));
			expect(statSync(file).size, `${file} looks empty`).toBeGreaterThan(30_000);
		}, 120_000);
	}

	it("vertical frames and a frame in the middle of the entry motion", async () => {
		for (const id of ["night", "poster"]) {
			const plan = withLook(galleryPlanFor("bullets"), LOOKS[id]!, true);
			expect(statSync(await still(`${id}-vertical`, plan, settledFrame(plan))).size).toBeGreaterThan(30_000);
			// 12 frames in: the items are on their way in (pop, blur), not missing or stuck.
			expect(statSync(await still(`${id}-entering`, withLook(galleryPlanFor("title"), LOOKS[id]!), 12)).size).toBeGreaterThan(10_000);
		}
	}, 240_000);

	it("different looks give different pictures, and a contact sheet for review", async () => {
		for (const type of TYPES) {
			const hashes = Object.keys(LOOKS).map((id) => createHash("sha1").update(readFileSync(files[`${id}-${type}`]!)).digest("hex"));
			expect(new Set(hashes).size, type).toBe(Object.keys(LOOKS).length);
		}
		const names = Object.keys(LOOKS).flatMap((id) => TYPES.map((t) => `${id}-${t}`));
		const cols = TYPES.length;
		const w = 384;
		const h = 216;
		const sheet = createCanvas(cols * w, Math.ceil(names.length / cols) * h);
		const ctx = sheet.getContext("2d");
		for (const [i, n] of names.entries()) ctx.drawImage(await loadImage(files[n]!), (i % cols) * w, Math.floor(i / cols) * h, w, h);
		writeFileSync(join(OUT, "look-sheet.png"), sheet.toBuffer("image/png"));
	}, 120_000);
});
