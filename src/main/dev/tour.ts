import { app, type BrowserWindow } from "electron";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { applyTheme } from "../app/theme";
import { runAiTest } from "./ai-test";
import { runSelfTest } from "./selftest";
import { runVoiceTest } from "./voice-test";
import { runIngestTest } from "./ingest-test";
import { runPlannerTest } from "./planner-test";
import { runNarrationTest } from "./narration-test";
import { runAssetsTest } from "./assets-test";
import { runCreatorTest } from "./creator-test";
import { runEditTest } from "./edit-test";
import { runVideoTest } from "./video-test";

/**
 * Development aids. Never active in a packaged build.
 *  - Renderer console output is mirrored to the terminal.
 *  - EXPLAINER_TOUR_DIR=<folder> captures every screen in light and dark, then quits.
 */
export function attachDevAids(win: BrowserWindow): void {
	if (app.isPackaged) return;
	win.webContents.on("console-message", (e) => {
		console.log(`[renderer:${e.level}] ${e.message}${e.sourceId ? ` (${e.sourceId}:${e.lineNumber})` : ""}`);
	});
	const dir = process.env.EXPLAINER_TOUR_DIR;
	if (dir) win.webContents.once("did-finish-load", () => void runTour(win, dir));
	// EXPLAINER_RENDER_TEST=<folder>: render the test video, then render again and cancel it. Screenshots along the way.
	const renderDir = process.env.EXPLAINER_RENDER_TEST;
	if (renderDir) win.webContents.once("did-finish-load", () => void runRenderTest(win, renderDir));
	const studioDir = process.env.EXPLAINER_STUDIO_TEST;
	if (studioDir) win.webContents.once("did-finish-load", () => void runStudioTest(win, studioDir));
	const aiDir = process.env.EXPLAINER_AI_TEST;
	if (aiDir) win.webContents.once("did-finish-load", () => void runAiTest(win, aiDir));
	const voiceDir = process.env.EXPLAINER_VOICE_TEST;
	if (voiceDir) win.webContents.once("did-finish-load", () => void runVoiceTest(win, voiceDir));
	const ingestDir = process.env.EXPLAINER_INGEST_TEST;
	if (ingestDir) win.webContents.once("did-finish-load", () => void runIngestTest(win, ingestDir));
	const plannerDir = process.env.EXPLAINER_PLANNER_TEST;
	if (plannerDir) win.webContents.once("did-finish-load", () => void runPlannerTest(win, plannerDir));
	const narrationDir = process.env.EXPLAINER_NARRATION_TEST;
	if (narrationDir) win.webContents.once("did-finish-load", () => void runNarrationTest(win, narrationDir));
	const assetsDir = process.env.EXPLAINER_ASSETS_TEST;
	if (assetsDir) win.webContents.once("did-finish-load", () => void runAssetsTest(win, assetsDir));
	const videoDir = process.env.EXPLAINER_VIDEO_TEST;
	if (videoDir) win.webContents.once("did-finish-load", () => void runVideoTest(win, videoDir));
	const editDir = process.env.EXPLAINER_EDIT_TEST;
	if (editDir) win.webContents.once("did-finish-load", () => void runEditTest(win, editDir));
	const creatorDir = process.env.EXPLAINER_CREATOR_TEST;
	if (creatorDir) win.webContents.once("did-finish-load", () => void runCreatorTest(win, creatorDir));
	if (process.env.EXPLAINER_SELFTEST) runSelfTest(win, process.env.EXPLAINER_SELFTEST);
	// EXPLAINER_SNAPSHOT=<file.png>: one picture of the first screen as it opens (theme untouched), then quit.
	const snap = process.env.EXPLAINER_SNAPSHOT;
	if (snap)
		win.webContents.once("did-finish-load", async () => {
			await wait(1500);
			writeFileSync(snap, (await win.webContents.capturePage()).toPNG());
			console.log(`[snapshot] ${snap}`);
			app.quit();
		});
}

/** Clicks the first button whose text contains `text`. */
function clickButton(text: string): string {
	return `(() => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent?.includes(${JSON.stringify(text)})); b?.click(); return !!b; })()`;
}

const ROUTES = ["/", "/new", "/studio", "/studio?draft=sample", "/library", "/drafts", "/queue", "/assets", "/brand", "/settings", "/settings?section=ai", "/settings?section=voice"];
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function shot(win: BrowserWindow, dir: string, name: string): Promise<void> {
	const img = await win.webContents.capturePage();
	writeFileSync(join(dir, `${name}.png`), img.toPNG());
}

async function runTour(win: BrowserWindow, dir: string): Promise<void> {
	mkdirSync(dir, { recursive: true });
	await wait(1500);
	const js = (code: string) => win.webContents.executeJavaScript(code, true);
	for (const theme of ["light", "dark"] as const) {
		applyTheme(theme);
		await js(`document.documentElement.classList.toggle("dark", ${theme === "dark"})`);
		for (const route of ROUTES) {
			await js(`location.hash = "#${route}"`);
			await wait(700);
			await shot(win, dir, `${theme}${route === "/" ? "-home" : route.replace("/", "-").replace(/[?=]/g, "-")}`);
		}
		// Command palette.
		await js(`window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }))`);
		await wait(500);
		await shot(win, dir, `${theme}-palette`);
		await js(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
		await wait(400);
		// Confirm dialog with type-to-confirm, then the toast after confirming.
		await js(`location.hash = "#/settings"`);
		await wait(600);
		await js(clickButton("Reset all"));
		await wait(500);
		await shot(win, dir, `${theme}-confirm`);
		await win.webContents.insertText("RESET");
		await wait(200);
		await js(clickButton("Reset everything"));
		await wait(700);
		await shot(win, dir, `${theme}-toast`);
		await wait(300);
	}
	applyTheme("system");
	console.log(`[tour] screenshots written to ${dir}`);
	app.quit();
}

/** Text of the render status box, or "" when absent. */
const STATUS = `document.querySelector("[aria-live=polite]")?.textContent ?? ""`;

async function runRenderTest(win: BrowserWindow, dir: string): Promise<void> {
	mkdirSync(dir, { recursive: true });
	const say = (line: string) => {
		console.log(line);
		appendFileSync(join(dir, "log.txt"), `${line}
`);
	};
	const js = (code: string) => win.webContents.executeJavaScript(code, true) as Promise<unknown>;
	const status = () => js(STATUS) as Promise<string>;
	const waitFor = async (re: RegExp, timeoutMs: number) => {
		const end = Date.now() + timeoutMs;
		while (Date.now() < end) {
			const s = await status();
			if (re.test(s)) return s;
			await wait(50);
		}
		throw new Error(`timed out waiting for ${re} (last status: ${await status()})`);
	};
	try {
		await wait(1500);
		await js(`location.hash = "#/settings"`);
		await wait(600);
		await js(clickButton("Rendering"));
		await wait(1500);
		await shot(win, dir, "1-player");

		// Full render.
		const t0 = Date.now();
		await js(clickButton("Render test video"));
		const seen = new Set<string>();
		let midShot = false;
		for (;;) {
			const s = await status();
			const stage = s.match(/^(Starting|Render browser|Preparing|Rendering|Finishing|Done|Cancelled|Failed)/)?.[1];
			if (stage && !seen.has(stage)) {
				seen.add(stage);
				say(`[render-test] ${((Date.now() - t0) / 1000).toFixed(1)}s ${s}`);
			}
			if (stage === "Rendering" && !midShot && /Frame \d{2,}/.test(s)) {
				midShot = true;
				await shot(win, dir, "2-progress");
			}
			if (stage === "Done" || stage === "Failed") break;
			if (Date.now() - t0 > 15 * 60_000) throw new Error("render took over 15 minutes");
			await wait(50);
		}
		say(`[render-test] first render finished in ${((Date.now() - t0) / 1000).toFixed(1)}s: ${await status()}`);
		await wait(500);
		await shot(win, dir, "3-done");

		// Second render, cancelled mid-way.
		const t1 = Date.now();
		await js(clickButton("Render test video"));
		await waitFor(/Rendering.*Frame \d{2,}/, 2 * 60_000);
		say(`[render-test] second render reached frames after ${((Date.now() - t1) / 1000).toFixed(1)}s; cancelling: ${await status()}`);
		await js(clickButton("Cancel render"));
		const tc = Date.now();
		const final = await waitFor(/^(Cancelled|Done|Failed)/, 60_000);
		say(`[render-test] after cancel (${Date.now() - tc}ms): ${final}`);
		await wait(1500);
		win.focus();
		await wait(300);
		say(`[render-test] status at final screenshot: ${await status()}`);
		await shot(win, dir, "4-cancelled");
	} catch (err) {
		say(`[render-test] FAILED: ${(err as Error).message}`);
		await shot(win, dir, "error").catch(() => undefined);
	}
	app.quit();
}

/** EXPLAINER_STUDIO_TEST=<folder>: opens the sample in the Studio, plays, jumps scenes, switches style. */
async function runStudioTest(win: BrowserWindow, dir: string): Promise<void> {
	mkdirSync(dir, { recursive: true });
	const say = (line: string) => {
		console.log(line);
		appendFileSync(join(dir, "log.txt"), `${line}
`);
	};
	const js = (code: string) => win.webContents.executeJavaScript(code, true) as Promise<unknown>;
	const key = (k: string) => js(`window.dispatchEvent(new KeyboardEvent("keydown", { key: ${JSON.stringify(k)}, bubbles: true }))`);
	const state = () =>
		js(`({ scene: document.querySelector("[aria-current=true]")?.textContent ?? null, slider: document.querySelector("[aria-label=Timeline]")?.getAttribute("aria-valuetext"), frame: Number(document.querySelector("[aria-label=Timeline]")?.getAttribute("aria-valuenow")), counter: [...document.querySelectorAll("span")].find((x) => /^Scene \d+ of/.test(x.textContent ?? ""))?.textContent })`) as Promise<Record<string, unknown>>;
	try {
		await wait(1500);
		await js(`location.hash = "#/studio?draft=sample"`);
		await wait(1500);
		await shot(win, dir, "1-open");
		say(`[studio] open: ${JSON.stringify(await state())}`);
		await js(clickButton("Play"));
		await wait(3000);
		say(`[studio] after 3s play: ${JSON.stringify(await state())}`);
		await shot(win, dir, "2-playing");
		await key(" ");
		await wait(300);
		for (let i = 0; i < 4; i++) {
			await key("]");
			await wait(250);
		}
		await wait(1200);
		say(`[studio] after 4x ]: ${JSON.stringify(await state())}`);
		await shot(win, dir, "3-scene5");
		await js(`[...document.querySelectorAll("[role=radio]")].find((b) => b.textContent === "Chalkboard")?.click()`);
		await wait(1500);
		say(`[studio] chalkboard: ${JSON.stringify(await state())}`);
		await shot(win, dir, "4-chalkboard");
		await js(`[...document.querySelectorAll("nav[aria-label=Scenes] button")].find((b) => b.textContent?.includes("Asking for a page"))?.click()`);
		await wait(2500);
		say(`[studio] picked code scene: ${JSON.stringify(await state())}`);
		await shot(win, dir, "5-code");
	} catch (err) {
		say(`[studio] FAILED: ${(err as Error).message}`);
	}
	app.quit();
}
