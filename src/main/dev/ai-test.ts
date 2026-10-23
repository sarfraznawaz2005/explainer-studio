import { app, type BrowserWindow } from "electron";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { ai, aiStore } from "../ai";
import { applyTheme } from "../app/theme";
import { db } from "../db/connection";
import { repos } from "../db/repos";

/**
 * EXPLAINER_AI_TEST=<folder>: drives Settings → AI providers in the real app.
 * Adds OpenCode Zen (free) through the UI and tests it, adds a broken custom
 * provider (127.0.0.1:9, nothing listens there), makes one real structured call
 * on the cheap slot, deletes through the confirm dialog, and takes screenshots
 * in light and dark. Only rows it created are removed at the end.
 */
const BAD_KEY = "not-a-real-key-for-the-ai-test-123456";
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runAiTest(win: BrowserWindow, dir: string): Promise<void> {
	mkdirSync(dir, { recursive: true });
	const logPath = join(dir, "log.txt");
	writeFileSync(logPath, "");
	const log = (msg: string) => {
		appendFileSync(logPath, `${new Date().toISOString()} ${msg}\n`);
		console.log(`[ai-test] ${msg}`);
	};
	const js = <T = unknown>(code: string) => win.webContents.executeJavaScript(code, true) as Promise<T>;
	const shot = async (name: string) => {
		await wait(350);
		writeFileSync(join(dir, `${name}.png`), (await win.webContents.capturePage()).toPNG());
		log(`shot ${name}`);
	};
	const until = async (what: string, code: string, timeoutMs: number) => {
		const end = Date.now() + timeoutMs;
		while (Date.now() < end) {
			if (await js<boolean>(code)) return true;
			await wait(250);
		}
		log(`TIMEOUT waiting for ${what}`);
		return false;
	};
	/** Clicks the first button in `scope` whose text includes `text`. */
	const click = (text: string, scope = "document") =>
		js<boolean>(
			`(() => { const root = ${scope === "document" ? "document" : `document.querySelector(${JSON.stringify(scope)})`}; const b = root && [...root.querySelectorAll("button")].find((x) => x.textContent?.includes(${JSON.stringify(text)})); b?.click(); return !!b; })()`,
		);
	const type = async (selector: string, text: string) => {
		await js(`document.querySelector(${JSON.stringify(selector)})?.focus()`);
		await win.webContents.insertText(text);
	};
	const scrollTo = (text: string) =>
		js(`[...document.querySelectorAll("h3")].find((h) => h.textContent?.includes(${JSON.stringify(text)}))?.scrollIntoView({ block: "start" })`);
	const created: string[] = [];
	const usageIds: string[] = [];
	const errors: string[] = [];
	win.webContents.on("console-message", (e) => {
		if (e.level === "error") errors.push(e.message);
	});

	try {
		await wait(1500);
		applyTheme("light");
		await js(`document.documentElement.classList.remove("dark")`);
		const before = new Set(aiStore.list().map((p) => p.id));
		log(`providers before: ${before.size}`);

		await js(`location.hash = "#/settings?section=ai"`);
		await wait(900);
		await shot("light-ai-start");

		// 1. Add OpenCode Zen through the UI.
		log(`click Add provider: ${await click("Add provider")}`);
		await until("kind picker", `!!document.querySelector("[role=dialog]")`, 3000);
		await shot("light-ai-picker");
		log(`pick OpenCode: ${await click("OpenCode Zen", "[role=dialog]")}`);
		await until("model list", `!document.querySelector("[role=dialog]")?.textContent?.includes("Loading models")`, 45_000);
		await shot("light-ai-form-opencode");
		log(`click Test: ${await click("Test", "[role=dialog]")}`);
		await until("draft test result", `!!document.querySelector("[role=dialog] [role=status]")`, 70_000);
		log(`draft test says: ${await js<string>(`document.querySelector("[role=dialog] [role=status]")?.textContent ?? ""`)}`);
		await shot("light-ai-form-tested");
		log(`submit: ${await click("Add provider", "[role=dialog] form")}`);
		await until("dialog closed", `!document.querySelector("[role=dialog]")`, 5000);
		await until("saved test finished", `!document.body.textContent?.includes("Testing")`, 90_000);
		await wait(800);
		const zen = aiStore.list().find((p) => !before.has(p.id) && p.kind === "opencode");
		if (zen) created.push(zen.id);
		log(`opencode saved: ${JSON.stringify(zen ?? null)}`);
		log(`slots after test: ${JSON.stringify(aiStore.getSlots())}`);
		await shot("light-ai-list");

		// 2. A broken custom provider: the test must report failure.
		await click("Add provider");
		await until("kind picker", `!!document.querySelector("[role=dialog]")`, 3000);
		await click("Custom", "[role=dialog]");
		await wait(300);
		await js(`(() => { const i = document.querySelector("#pv-name"); i.select(); })()`);
		await win.webContents.insertText("Broken server");
		await type("#pv-url", "http://127.0.0.1:9/v1");
		await type("#pv-key", BAD_KEY);
		await wait(1500);
		await shot("light-ai-form-custom");
		await click("Add provider", "[role=dialog] form");
		await until("dialog closed", `!document.querySelector("[role=dialog]")`, 5000);
		await until("saved test finished", `!document.body.textContent?.includes("Testing")`, 60_000);
		await wait(600);
		const broken = aiStore.list().find((p) => !before.has(p.id) && p.kind === "custom");
		if (broken) created.push(broken.id);
		log(`custom saved: ${JSON.stringify(broken ?? null)}`);
		const raw = broken ? repos.providers.get(broken.id)?.secret : null;
		log(`custom key stored encrypted: ${!!raw && raw.length > 0 && !Buffer.from(raw).toString("latin1").includes(BAD_KEY)} (bytes ${raw?.length ?? 0})`);
		log(`renderer view has no key: ${!JSON.stringify(aiStore.list()).includes(BAD_KEY)}`);
		await shot("light-ai-list-failed");

		// 3. One real structured call on the cheap slot (OpenCode free).
		if (zen?.testOk) {
			const t0 = Date.now();
			try {
				const r = await ai().generateStructured(
					{
						schema: z.object({ title: z.string().min(3).max(80), tags: z.array(z.string()).min(2).max(5) }),
						system: "You name YouTube explainer videos for school students.",
						prompt: "Topic: how rainbows form. Audience: Grade 5. Give a short title and 2 to 5 tags.",
					},
					{ slot: "cheap", purpose: "selftest.title" },
				);
				log(`structured call OK in ${Date.now() - t0} ms after ${r.attempts} attempt(s): ${JSON.stringify(r.value)} usage=${JSON.stringify(r.usage)}`);
			} catch (err) {
				log(`structured call FAILED: ${(err as Error).message}`);
			}
			const rows = aiStore.usageRecent(10).filter((u) => u.purpose === "selftest.title");
			usageIds.push(...rows.map((u) => u.id));
			log(`usage rows: ${JSON.stringify(rows.map((u) => ({ model: u.model, ok: u.ok, in: u.inputTokens, out: u.outputTokens, cost: u.costUsd, billing: u.billing, attempt: u.attempt })))}`);
		} else log("skipped real call: OpenCode test did not pass");

		// Reload the section so slots and usage show the new state.
		await js(`location.hash = "#/"`);
		await wait(400);
		await js(`location.hash = "#/settings?section=ai"`);
		await wait(1200);
		await scrollTo("Models for each task");
		await shot("light-ai-slots");
		await scrollTo("Usage");
		await shot("light-ai-usage");
		await js(`window.scrollTo(0, 0); document.querySelector("main")?.scrollTo?.(0, 0)`);
		await scrollTo("AI providers");

		// 4. Delete through the menu and the confirm dialog.
		if (broken) {
			await js(
				`(() => { const b = document.querySelector('[aria-label="More actions for Broken server"]'); b?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" })); return !!b; })()`,
			);
			await until("menu", `!!document.querySelector("[role=menu]")`, 3000);
			await shot("light-ai-menu");
			await js(`[...document.querySelectorAll("[role=menuitem]")].find((x) => x.textContent?.includes("Delete"))?.click()`);
			await until("confirm", `!!document.querySelector("[role=alertdialog]")`, 3000);
			log(`confirm text: ${await js<string>(`document.querySelector("[role=alertdialog]")?.textContent ?? ""`)}`);
			await shot("light-ai-confirm-delete");
			// Cancel first: nothing may be deleted.
			await click("Cancel", "[role=alertdialog]");
			await wait(500);
			log(`after cancel still there: ${!!aiStore.get(broken.id)}`);
			await js(
				`document.querySelector('[aria-label="More actions for Broken server"]')?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" }))`,
			);
			await until("menu", `!!document.querySelector("[role=menu]")`, 3000);
			await js(`[...document.querySelectorAll("[role=menuitem]")].find((x) => x.textContent?.includes("Delete"))?.click()`);
			await until("confirm", `!!document.querySelector("[role=alertdialog]")`, 3000);
			await click("Delete provider", "[role=alertdialog]");
			await wait(900);
			log(`after confirm deleted: ${!aiStore.get(broken.id)}`);
			await shot("light-ai-deleted");
		}

		// 5. Dark theme.
		applyTheme("dark");
		await js(`document.documentElement.classList.add("dark")`);
		await wait(500);
		await shot("dark-ai-list");
		await click("Add provider");
		await wait(600);
		await shot("dark-ai-picker");
		await click("OpenCode Zen", "[role=dialog]");
		await until("model list", `!document.querySelector("[role=dialog]")?.textContent?.includes("Loading models")`, 30_000);
		await shot("dark-ai-form");
		await js(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
		await wait(500);
		await scrollTo("Usage");
		await shot("dark-ai-usage");
	} catch (err) {
		log(`HARNESS ERROR ${(err as Error).stack ?? err}`);
	} finally {
		for (const id of created) if (aiStore.get(id)) aiStore.remove(id);
		for (const id of usageIds) db().prepare("DELETE FROM ai_usage WHERE id = ?").run(id);
		log(`cleanup: removed ${created.length} test providers and ${usageIds.length} test usage rows; providers now ${aiStore.list().length}`);
		log(`renderer console errors: ${errors.length ? errors.join(" || ") : "none"}`);
		applyTheme("system");
		await wait(300);
		app.quit();
	}
}
