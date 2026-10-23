/**
 * Photo scenes: a photo of each shape in a wide and in a vertical video, drawn
 * through the real Remotion bundle and headless Chrome. The photos are made here
 * (a scene with a red "subject" disc at a known spot), served from a local http
 * server like the app's media protocol. Stills go to tests/__stills__/photo-*.png
 * for review. Runs with `npm run test:render`.
 */
import { bundle } from "@remotion/bundler";
import { openBrowser, renderStill, selectComposition } from "@remotion/renderer";
import { createCanvas } from "@napi-rs/canvas";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { VideoPlan, type VideoPlanInput } from "@shared/plan/schema";
import { computeTimeline } from "@shared/plan/timing";
import type { FigureMeta } from "@shared/source";

const OUT = resolve("tests/__stills__");
const APP_CHROME = join(process.env.APPDATA ?? "", "Explainer Studio/engine/node_modules/.remotion/chrome-headless-shell/win64/chrome-headless-shell-win64/chrome-headless-shell.exe");
const browserExecutable = existsSync(APP_CHROME) ? APP_CHROME : null;

/** A fake photo: sky-to-ground gradient, a horizon, and a red disc (the subject) at (fx, fy) percent. */
function photo(w: number, h: number, fx: number, fy: number): Buffer {
	const c = createCanvas(w, h);
	const g = c.getContext("2d");
	const grad = g.createLinearGradient(0, 0, 0, h);
	grad.addColorStop(0, "#7fb8e6");
	grad.addColorStop(0.6, "#d9e8f2");
	grad.addColorStop(0.61, "#5d8a3c");
	grad.addColorStop(1, "#2f4f1e");
	g.fillStyle = grad;
	g.fillRect(0, 0, w, h);
	for (let i = 0; i < 12; i++) {
		g.fillStyle = `rgba(255,255,255,${0.15 + (i % 3) * 0.1})`;
		g.fillRect((i * w) / 12, h * 0.6 - 40 - (i % 4) * 30, w / 16, 40 + (i % 4) * 30);
	}
	g.fillStyle = "#d62828";
	g.beginPath();
	g.arc((fx / 100) * w, (fy / 100) * h, Math.min(w, h) * 0.12, 0, Math.PI * 2);
	g.fill();
	g.fillStyle = "#ffffff";
	g.font = `bold ${Math.round(Math.min(w, h) * 0.05)}px sans-serif`;
	g.textAlign = "center";
	g.fillText("SUBJECT", (fx / 100) * w, (fy / 100) * h + Math.min(w, h) * 0.02);
	return c.toBuffer("image/jpeg");
}

const PHOTOS: Record<string, { w: number; h: number; focus: { x: number; y: number } }> = {
	"web-001.jpg": { w: 1600, h: 1000, focus: { x: 78, y: 40 } }, // wide, subject on the right
	"web-002.jpg": { w: 800, h: 1200, focus: { x: 50, y: 30 } }, // tall portrait
	"my-001.jpg": { w: 1000, h: 1000, focus: { x: 30, y: 70 } }, // square, subject bottom left
};

let serveUrl = "";
let browser: Awaited<ReturnType<typeof openBrowser>>;
let server: Server;
let base = "";

beforeAll(async () => {
	mkdirSync(OUT, { recursive: true });
	const files = new Map(Object.entries(PHOTOS).map(([name, p]) => [name, photo(p.w, p.h, p.focus.x, p.focus.y)]));
	server = createServer((req, res) => {
		const data = files.get(decodeURIComponent((req.url ?? "").split("/").pop() ?? ""));
		if (!data) return void res.writeHead(404).end();
		res.writeHead(200, { "content-type": "image/jpeg", "access-control-allow-origin": "*" }).end(data);
	});
	await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
	const addr = server.address();
	base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}/`;
	serveUrl = await bundle({ entryPoint: resolve("video/src/index.ts") });
	browser = await openBrowser("chrome", { browserExecutable, chromeMode: "headless-shell" });
}, 240_000);

afterAll(async () => {
	await browser?.close({ silent: true });
	server?.close();
});

const meta = (credit: boolean): Record<string, FigureMeta> =>
	Object.fromEntries(Object.entries(PHOTOS).map(([name, p]) => [name, { width: p.w, height: p.h, photo: true, focus: p.focus, ...(credit ? { credit: "Photo: Jane Doe, CC BY 4.0, Wikimedia Commons" } : {}) }]));

function planFor(figure: string, size: { width: number; height: number }): VideoPlanInput {
	return {
		version: 1,
		meta: { title: "Photo test", level: "High school", style: "clean", fps: 30, ...size },
		chapters: [
			{
				id: "c1",
				title: "Photos",
				scenes: [
					{
						id: "s1",
						type: "figure",
						props: { figure, caption: "The subject, kept in view", callouts: [{ x: PHOTOS[figure]!.focus.x, y: PHOTOS[figure]!.focus.y, text: "Here" }] },
						narration: [{ id: "n1", text: "This photo shows the subject." }, { id: "n2", text: "It stays in view." }],
					},
				],
			},
		],
	} as VideoPlanInput;
}

describe("photo scenes", () => {
	const cases = [
		["wide", { width: 1920, height: 1080 }],
		["vertical", { width: 1080, height: 1920 }],
	] as const;
	for (const [shape, size] of cases)
		for (const figure of Object.keys(PHOTOS))
			it(`${shape}: ${figure}`, async () => {
				const plan = planFor(figure, size);
				const inputProps = { plan, style: "clean", figureBase: base, figureMeta: meta(true) };
				const composition = await selectComposition({ serveUrl, id: "Explainer", inputProps, puppeteerInstance: browser, browserExecutable });
				const tl = computeTimeline(VideoPlan.parse(plan));
				const file = join(OUT, `photo-${shape}-${figure.replace(".jpg", "")}.png`);
				await renderStill({ serveUrl, composition, inputProps, frame: tl.durationInFrames - 20, output: file, overwrite: true, puppeteerInstance: browser, browserExecutable, imageFormat: "png" });
				expect(statSync(file).size, file).toBeGreaterThan(30_000);
			}, 120_000);
});

