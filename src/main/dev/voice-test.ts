import { app, type BrowserWindow } from "electron";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { applyTheme } from "../app/theme";
import { voiceEngine } from "../voice";

/**
 * EXPLAINER_VOICE_TEST=<folder>: drives Settings → Voice in the real app.
 *  - EXPLAINER_VOICE_TEST_MODE=no-python (with EXPLAINER_PYTHON_CANDIDATES pointing nowhere):
 *    checks the friendly message, then quits.
 *  - EXPLAINER_VOICE_TEST_MODE=install: Install (confirm) → progress → voices → play 3 voices →
 *    speed and default → Repair (Cancel first, then confirm) → dark theme.
 */
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runVoiceTest(win: BrowserWindow, dir: string): Promise<void> {
	mkdirSync(dir, { recursive: true });
	const mode = process.env.EXPLAINER_VOICE_TEST_MODE ?? "install";
	const logPath = join(dir, `log-${mode}.txt`);
	writeFileSync(logPath, "");
	const log = (msg: string) => {
		appendFileSync(logPath, `${new Date().toISOString()} ${msg}\n`);
		console.log(`[voice-test] ${msg}`);
	};
	const js = <T = unknown>(code: string) => win.webContents.executeJavaScript(code, true) as Promise<T>;
	const shot = async (name: string) => {
		await wait(350);
		writeFileSync(join(dir, `${name}.png`), (await win.webContents.capturePage()).toPNG());
		log(`shot ${name}`);
	};
	const until = async (what: string, code: string, timeoutMs: number, everyMs = 250, onTick?: () => Promise<void>) => {
		const end = Date.now() + timeoutMs;
		while (Date.now() < end) {
			if (await js<boolean>(code)) return true;
			await onTick?.();
			await wait(everyMs);
		}
		log(`TIMEOUT waiting for ${what}`);
		return false;
	};
	const click = (text: string, scope = "document") =>
		js<boolean>(
			`(() => { const root = ${scope === "document" ? "document" : `document.querySelector(${JSON.stringify(scope)})`}; const b = root && [...root.querySelectorAll("button, a")].find((x) => x.textContent?.trim().includes(${JSON.stringify(text)})); b?.click(); return !!b; })()`,
		);
	const text = (sel: string) => js<string>(`document.querySelector(${JSON.stringify(sel)})?.textContent ?? ""`);
	const errors: string[] = [];
	win.webContents.on("console-message", (e) => {
		if (e.level === "error") errors.push(e.message);
	});

	try {
		await wait(1500);
		applyTheme("light");
		await js(`document.documentElement.classList.remove("dark")`);
		await js(`location.hash = "#/settings?section=voice"`);
		await until("status", `!document.body.textContent?.includes("Checking the voice engine")`, 30_000);
		await wait(500);
		const state = await js<string>(`[...document.querySelectorAll("main span")].map((s) => s.textContent).filter((t) => ["Ready","Not installed","Installing","Update needed","Needs repair","Python needed"].includes(t)).join(",")`);
		log(`state badge: ${state}`);

		if (mode === "no-python") {
			log(`alert: ${await text("[role=alert]")}`);
			log(`has Get Python: ${await js<boolean>(`!![...document.querySelectorAll("a")].find((a) => a.textContent?.includes("Get Python") && a.href.startsWith("https://www.python.org/"))`)}`);
			log(`has stack trace: ${await js<boolean>(`/at \\w+ \\(|Error:|Traceback/.test(document.body.innerText)`)}`);
			await wait(1200);
			await shot("light-voice-no-python");
			await click("Check again");
			await wait(1500);
			log(`after Check again: ${await text("[role=alert]")}`);
			applyTheme("dark");
			await js(`document.documentElement.classList.add("dark")`);
			await wait(1200);
			await shot("dark-voice-no-python");
			return;
		}

		if (mode === "dark") {
			applyTheme("dark");
			await js(`document.documentElement.classList.add("dark")`);
			await until("voices", `document.querySelectorAll("[aria-label^='Play ']").length > 3`, 120_000);
			await wait(1500);
			log(`html has dark class: ${await js<boolean>(`document.documentElement.classList.contains("dark")`)}`);
			await shot("dark-voice-ready");
			await js(`[...document.querySelectorAll("h4")].find((h) => h.textContent?.includes("British"))?.scrollIntoView({ block: "center" })`);
			await wait(500);
			await shot("dark-voice-british");
			await js(`window.scrollTo(0, 0); document.querySelector("main")?.scrollTo?.(0, 0)`);
			await click("Repair");
			await until("repair confirm", `!!document.querySelector("[role=alertdialog]")`, 3000);
			log(`repair confirm text: ${await text("[role=alertdialog]")}`);
			await shot("dark-voice-confirm-repair");
			await click("Cancel", "[role=alertdialog]");
			return;
		}
		await shot("light-voice-start");
		// 1. Install through the confirm dialog.
		if (state.includes("Not installed")) {
			log(`click Install: ${await click("Install voice engine")}`);
			await until("confirm", `!!document.querySelector("[role=alertdialog]")`, 3000);
			log(`confirm text: ${await text("[role=alertdialog]")}`);
			await shot("light-voice-confirm-install");
			await click("Install", "[role=alertdialog]");
			const t0 = Date.now();
			const seenSteps = new Set<string>();
			let lastShot = "";
			await until(
				"install finished",
				`document.body.textContent.includes("Show folder") || document.body.textContent.includes("did not finish")`,
				40 * 60_000,
				1000,
				async () => {
					const bar = await js<string>(`(() => { const p = document.querySelector("[aria-label='Install progress']"); return p ? p.getAttribute("aria-valuenow") + "% " + p.parentElement.textContent : ""; })()`);
					const step = bar.replace(/^\d+%\s*/, "").split(/\d+%/)[0]?.slice(0, 22) ?? "";
					const key = step.split(/\s/).slice(0, 2).join(" ");
					if (bar && !seenSteps.has(key)) {
						seenSteps.add(key);
						log(`progress: ${bar}`);
						if (key !== lastShot) {
							lastShot = key;
							await shot(`light-voice-installing-${seenSteps.size}`);
						}
					}
				},
			);
			log(`install took ${Math.round((Date.now() - t0) / 1000)} s; steps seen: ${[...seenSteps].join(" | ")}`);
			const s = await voiceEngine().status();
			log(`status after install: ${s.state} size=${s.sizeBytes} python=${s.python?.version} last=${JSON.stringify(s.install)}`);
		}

		// 2. Voices: play three.
		await until("voices", `document.querySelectorAll("[aria-label^='Play ']").length > 3`, 120_000);
		await js(`window.__plays = []; const orig = HTMLMediaElement.prototype.play; HTMLMediaElement.prototype.play = function () { const a = this; const p = orig.call(a); p.then(() => window.__plays.push({ ok: true, len: a.src.length, dur: a.duration })).catch((e) => window.__plays.push({ ok: false, err: String(e) })); return p; }; true;`);
		await shot("light-voice-ready");
		for (const name of ["Heart", "Michael", "Emma"]) {
			const t = Date.now();
			const n = await js<number>(`window.__plays.length`);
			await js(`document.querySelector("[aria-label='Play ${name}']")?.click()`);
			await until(`play ${name}`, `window.__plays.length > ${n}`, 120_000);
			const p = await js<{ ok: boolean; len?: number; dur?: number; err?: string }>(`window.__plays.at(-1)`);
			log(`play ${name}: ${JSON.stringify(p)} after ${Date.now() - t} ms`);
			if (name === "Michael") await shot("light-voice-playing");
			await wait(800);
		}
		// Stop the last one, then replay Heart from the cache.
		await js(`document.querySelector("[aria-label^='Stop ']")?.click()`);
		const t1 = Date.now();
		await js(`document.querySelector("[aria-label='Play Heart']")?.click()`);
		await until("replay", `window.__plays.length >= 4`, 30_000);
		log(`replay Heart (cached) after ${Date.now() - t1} ms: ${JSON.stringify(await js(`window.__plays.at(-1)`))}`);
		await js(`document.querySelector("[aria-label^='Stop ']")?.click()`);

		// 3. Default voice and speed are saved.
		await js(`[...document.querySelectorAll("[role=radio]")].find((b) => b.textContent?.includes("George"))?.click()`);
		await js(`document.querySelector("[aria-label='Speaking speed']")?.focus()`);
		for (let i = 0; i < 4; i++) win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Right" });
		await wait(200);
		for (let i = 0; i < 4; i++) win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Right" });
		await wait(800);
		log(`saved settings: ${JSON.stringify(await js(`window.studio.invoke("voice:settings:get")`))}`);
		await shot("light-voice-default-george");

		// 4. Repair: Cancel first (nothing happens), then confirm.
		await js(`window.scrollTo(0, 0); document.querySelector("main")?.scrollTo?.(0, 0)`);
		await click("Repair");
		await until("repair confirm", `!!document.querySelector("[role=alertdialog]")`, 3000);
		log(`repair confirm text: ${await text("[role=alertdialog]")}`);
		await shot("light-voice-confirm-repair");
		await click("Cancel", "[role=alertdialog]");
		await wait(800);
		log(`after Cancel still ready: ${(await voiceEngine().status()).state}`);
		const before = (await voiceEngine().status()).installedAt;
		await click("Repair");
		await until("repair confirm", `!!document.querySelector("[role=alertdialog]")`, 3000);
		await click("Repair", "[role=alertdialog]");
		await wait(1500);
		await shot("light-voice-repairing");
		const t2 = Date.now();
		await until("repair finished", `document.body.textContent.includes("Show folder") || document.body.textContent.includes("did not finish")`, 30 * 60_000, 1000);
		const after = await voiceEngine().status();
		log(`repair took ${Math.round((Date.now() - t2) / 1000)} s; state=${after.state}; installedAt ${before} -> ${after.installedAt}`);
		await until("voices again", `document.querySelectorAll("[aria-label^='Play ']").length > 3`, 120_000);
		await shot("light-voice-after-repair");

		// 5. Dark theme.
		applyTheme("dark");
		await js(`document.documentElement.classList.add("dark")`);
		await wait(500);
		await shot("dark-voice-ready");
		await js(`[...document.querySelectorAll("h4")].find((h) => h.textContent?.includes("British"))?.scrollIntoView({ block: "center" })`);
		await shot("dark-voice-british");
	} catch (err) {
		log(`HARNESS ERROR ${(err as Error).stack ?? err}`);
	} finally {
		log(`renderer console errors: ${errors.length ? errors.join(" || ") : "none"}`);
		applyTheme("system");
		await wait(300);
		app.quit();
	}
}
