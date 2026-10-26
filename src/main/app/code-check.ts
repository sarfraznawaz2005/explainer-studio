import { BrowserWindow } from "electron";
import { CheckResult } from "@shared/code-preview";
import type { VideoPlan } from "@shared/plan/schema";
import { writeLog } from "./logger";
import { PREVIEW_ORIGIN, PREVIEW_PAGE } from "./preview-protocol";

/**
 * The test draw for AI video code: a hidden window with the sandbox page
 * (es-preview://, no preload, no Node, sandboxed, strict policy) draws the video
 * at a few frames per scene and reports crashes and visible problems.
 * A draw that takes too long (an endless loop the guards missed, very heavy
 * drawing) closes the window: the next check opens a new one.
 */

const PAGE_URL = `${PREVIEW_ORIGIN}${PREVIEW_PAGE}?mode=check`;
export const CHECK_TIMEOUT_MS = 60_000;

let win: BrowserWindow | null = null;
let opening: Promise<BrowserWindow> | null = null;
let queue: Promise<unknown> = Promise.resolve();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function open(): Promise<BrowserWindow> {
	if (win && !win.isDestroyed()) return Promise.resolve(win);
	opening ??= (async () => {
		const w = new BrowserWindow({
			show: false,
			width: 640,
			height: 360,
			webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, backgroundThrottling: false, spellcheck: false },
		});
		w.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
		w.webContents.on("will-navigate", (e) => e.preventDefault());
		w.webContents.on("will-frame-navigate", (e) => e.preventDefault());
		w.on("closed", () => {
			if (win === w) win = null;
		});
		try {
			await w.loadURL(PAGE_URL);
			// The page script is a module: wait until it has set up the check.
			for (let i = 0; i < 200; i++) {
				if (await w.webContents.executeJavaScript("typeof window.__esCheck === 'function'")) {
					win = w;
					return w;
				}
				await sleep(100);
			}
			throw new Error("The check page did not start.");
		} catch (err) {
			w.destroy();
			throw err;
		} finally {
			opening = null;
		}
	})();
	return opening;
}

export function closeCodeChecker(): void {
	if (win && !win.isDestroyed()) win.destroy();
	win = null;
}

async function drawOnce(plan: VideoPlan, figureBase: string | undefined, timeoutMs: number): Promise<CheckResult> {
	let timer: NodeJS.Timeout | undefined;
	let stopped: ((e: unknown, d: { reason: string }) => void) | undefined;
	let w: BrowserWindow | undefined;
	try {
		w = await open();
		const page = w;
		const gone = new Promise<never>((_, reject) => {
			stopped = (_e, d) => reject(new Error(`The check page stopped (${d.reason}).`));
			page.webContents.once("render-process-gone", stopped);
		});
		const timeout = new Promise<"timeout">((r) => (timer = setTimeout(() => r("timeout"), timeoutMs)));
		const raw = await Promise.race([page.webContents.executeJavaScript(`window.__esCheck(${JSON.stringify({ plan, figureBase })})`), timeout, gone]);
		if (raw === "timeout") {
			closeCodeChecker();
			return { errors: [{ frame: -1, scene: -1, message: `Drawing the video took longer than ${Math.round(timeoutMs / 1000)} seconds. Is there an endless loop or very heavy drawing (huge lists, thousands of shapes per frame)?` }], warnings: [], frames: 0 };
		}
		const r = CheckResult.safeParse(raw);
		if (!r.success) throw new Error("The check page sent a result in the wrong shape.");
		return r.data;
	} catch (err) {
		closeCodeChecker();
		// The check page itself did not open: not the code's fault. The caller decides.
		if (!w) throw err;
		const message = (err as Error)?.message ?? String(err);
		writeLog("planner", "warn", `code test draw failed: ${message}`);
		return { errors: [{ frame: -1, scene: -1, message: `The code crashed the test page: ${message.slice(0, 300)}` }], warnings: [], frames: 0 };
	} finally {
		clearTimeout(timer);
		if (stopped && w && !w.isDestroyed()) w.webContents.off("render-process-gone", stopped);
	}
}

/** Draws a "code" plan in the sandbox. One check at a time. */
export function testDraw(plan: VideoPlan, figureBase?: string, timeoutMs = CHECK_TIMEOUT_MS): Promise<CheckResult> {
	const run = queue.then(() => drawOnce(plan, figureBase, timeoutMs));
	queue = run.catch(() => undefined);
	return run;
}

/** The check page's window (development tests read the sandbox from inside). */
export const openCheckPage = open;
