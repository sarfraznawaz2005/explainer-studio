import { app, type BrowserWindow } from "electron";
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { aiStore } from "../ai";
import { appFolders } from "../app/folders";
import { applyTheme } from "../app/theme";
import { repos } from "../db/repos";
import { voiceEngine } from "../voice";

/**
 * EXPLAINER_INGEST_TEST=<folder>: drives New Video in the real app.
 *  1. Settings → Voice: Repair when the local engine is out of date (new packages).
 *  2. Adds the Claude subscription provider (local Claude Code CLI) on the Vision slot (removed at the end).
 *  3. Reads Computer Science XI.pdf pages 81-85 (scanned) with "AI vision, then this PC".
 *  4. Reads again on "This PC only" and stops it with the confirm dialog.
 *  5. A .doc without LibreOffice: warning on the row and a clear error.
 * Only drafts and providers it created are removed.
 */
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const PDF = resolve(app.getAppPath(), "..", "Computer Science XI.pdf");

export async function runIngestTest(win: BrowserWindow, dir: string): Promise<void> {
	mkdirSync(dir, { recursive: true });
	const logPath = join(dir, "log.txt");
	writeFileSync(logPath, "");
	const log = (msg: string) => {
		appendFileSync(logPath, `${new Date().toISOString()} ${msg}\n`);
		console.log(`[ingest-test] ${msg}`);
	};
	const js = <T = unknown>(code: string) => win.webContents.executeJavaScript(code, true) as Promise<T>;
	const shot = async (name: string) => {
		await wait(400);
		writeFileSync(join(dir, `${name}.png`), (await win.webContents.capturePage()).toPNG());
		log(`shot ${name}`);
	};
	const until = async (what: string, code: string, timeoutMs: number, everyMs = 300, onTick?: () => Promise<void>) => {
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
			`(() => { const root = ${scope === "document" ? "document" : `document.querySelector(${JSON.stringify(scope)})`}; const b = root && [...root.querySelectorAll("button, a, [role=option]")].find((x) => x.textContent?.trim().includes(${JSON.stringify(text)}) && !x.disabled); b?.click(); return !!b; })()`,
		);
	const text = (sel: string) => js<string>(`document.querySelector(${JSON.stringify(sel)})?.textContent ?? ""`);
	const errors: string[] = [];
	win.webContents.on("console-message", (e) => {
		if (e.level === "error") errors.push(e.message);
	});
	const draftsBefore = new Set(repos.drafts.list().map((d) => d.id));
	const providersBefore = new Set(aiStore.list().map((p) => p.id));
	const slotsBefore = aiStore.getSlots();
	const createdProviders: string[] = [];

	try {
		await wait(1500);
		applyTheme("light");
		await js(`document.documentElement.classList.remove("dark")`);

		// 1. Local engine up to date?
		const st = await voiceEngine().status();
		log(`engine state: ${st.state} (${st.problem ?? ""})`);
		if (st.state === "outdated" || st.state === "broken") {
			await js(`location.hash = "#/settings?section=voice"`);
			await until("voice page", `document.body.textContent.includes("Packages need an update") || document.body.textContent.includes("needs a repair")`, 20_000);
			await wait(800);
			await shot("light-voice-outdated");
			await click("Repair");
			await until("repair confirm", `!!document.querySelector("[role=alertdialog]")`, 3000);
			log(`repair confirm: ${await text("[role=alertdialog]")}`);
			await click("Repair", "[role=alertdialog]");
			const t0 = Date.now();
			await until("repair done", `document.body.textContent.includes("Show folder") || document.body.textContent.includes("did not finish")`, 30 * 60_000, 1500);
			const after = await voiceEngine().status();
			log(`repair took ${Math.round((Date.now() - t0) / 1000)} s -> ${after.state}, size ${after.sizeBytes}, ready for documents: ${voiceEngine().isReady()}`);
		}

		// 2. Claude through the local Claude Code CLI login on the Vision slot.
		const visionModel = process.env.EXPLAINER_VISION_MODEL ?? "claude-sonnet-5-5";
		const claude = await aiStore.save({ kind: "claude-subscription", name: "Claude (test)", baseUrl: null, defaultModel: visionModel });
		createdProviders.push(claude.id);
		aiStore.setSlot("vision", { providerId: claude.id, modelId: visionModel });
		log(`vision slot: Claude subscription / ${visionModel}`);

		// 3. New Video: add the PDF and a .doc.
		const docFile = join(dir, "old-lesson.doc");
		writeFileSync(docFile, Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
		await js(`location.hash = "#/new"`);
		await wait(1200);
		await shot("light-new-empty");
		// A synthetic drop cannot carry real file paths, so the files go through the same inspect call the drop handler uses.
		await js(`(async () => { const files = await window.studio.invoke("ingest:inspect", { paths: [${JSON.stringify(PDF)}, ${JSON.stringify(docFile)}] }); window.__addFiles(files); })()`);
		await wait(800);
		log(`doc warning shown: ${await js<boolean>(`[...document.querySelectorAll("[role=alert]")].some((a) => a.textContent.includes("need LibreOffice"))`)}`);
		await js(`document.querySelector("[aria-label='Pages to read from Computer Science XI.pdf']")?.focus()`);
		await win.webContents.insertText("81-85");
		await wait(500);
		await shot("light-new-files");

		// 3b. The .doc alone first: a clear error, nothing saved.
		await js(`document.querySelector("[aria-label='Remove Computer Science XI.pdf']")?.click()`);
		await wait(300);
		await click("Read material");
		await until("doc error", `document.body.textContent.includes("Old Word files (.doc) need LibreOffice")`, 30_000);
		log(`doc error toast: ${await js<string>(`[...document.querySelectorAll("[data-sonner-toast]")].map((t) => t.textContent).join(" | ")`)}`);
		await shot("light-new-doc-error");
		await js(`document.querySelector("[aria-label='Remove old-lesson.doc']")?.click()`);
		await js(`(async () => { window.__addFiles(await window.studio.invoke("ingest:inspect", { paths: [${JSON.stringify(PDF)}] })); })()`);
		await wait(600);
		await js(`document.querySelector("[aria-label='Pages to read from Computer Science XI.pdf']")?.focus()`);
		await win.webContents.insertText("81-85");
		await wait(400);

		// 4. Read with AI vision, then this PC.
		await click("Read material");
		const t1 = Date.now();
		let shots = 0;
		const seen = new Set<string>();
		await until(
			"reading done",
			`!document.querySelector("[aria-label='Reading progress']") && (document.body.textContent.includes("Saved as draft") || document.body.textContent.includes("Read material"))`,
			20 * 60_000,
			700,
			async () => {
				const line = await js<string>(`(() => { const p = document.querySelector("[aria-label='Reading progress']"); return p ? p.parentElement.textContent : ""; })()`);
				const k = line.replace(/\d+%$/, "").slice(0, 60);
				if (line && !seen.has(k)) {
					seen.add(k);
					log(`progress: ${line}`);
					if (shots < 6 && (seen.size === 2 || seen.size % 3 === 0)) await shot(`light-reading-${++shots}`);
				}
			},
		);
		log(`reading took ${Math.round((Date.now() - t1) / 1000)} s`);
		await wait(1500);
		const newDrafts = repos.drafts.list().filter((d) => !draftsBefore.has(d.id));
		for (const d of newDrafts) {
			const s = d.source as { sections: unknown[]; figures: { file: string; caption: string | null; page: number | null }[]; inputs: { ocr: unknown[] }[]; stats: unknown; warnings: string[] };
			log(`draft ${d.id} "${d.title}": ${s.sections.length} sections, ${s.figures.length} figures ${JSON.stringify(s.figures.map((f) => [f.page, f.caption]))}, ocr ${JSON.stringify(s.inputs[0]?.ocr)}, stats ${JSON.stringify(s.stats)}, warnings ${JSON.stringify(s.warnings)}`);
			for (const f of s.figures) if (!existsSync(join(appFolders().drafts, d.id, f.file))) log(`MISSING figure file ${f.file}`);
		}
		await shot("light-preview-top");
		await js(`[...document.querySelectorAll("h3")].find((h) => h.textContent?.includes("Figures"))?.scrollIntoView({ block: "start" })`);
		await wait(1500);
		await shot("light-preview-figures");
		await js(`[...document.querySelectorAll("h3")].find((h) => h.textContent?.includes("What was found"))?.scrollIntoView({ block: "start" })`);
		await shot("light-preview-outline");
		applyTheme("dark");
		await js(`document.documentElement.classList.add("dark")`);
		await wait(1200);
		await js(`window.scrollTo(0, 0); document.querySelector("main")?.scrollTo?.(0, 0)`);
		await shot("dark-preview-top");
		applyTheme("light");
		await js(`document.documentElement.classList.remove("dark")`);
		await wait(800);

		// 5. Read again on "This PC only", then stop it.
		await click("Read something else");
		await wait(500);
		await js(`(async () => { window.__addFiles(await window.studio.invoke("ingest:inspect", { paths: [${JSON.stringify(PDF)}] })); })()`);
		await wait(500);
		await js(`document.querySelector("[aria-label='Pages to read from Computer Science XI.pdf']")?.focus()`);
		await win.webContents.insertText("81-85");
		await js(`document.querySelector("[aria-label='How to read scanned pages']")?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" }))`);
		await until("select open", `!!document.querySelector("[role=option]")`, 3000);
		await click("This PC only");
		await wait(400);
		const beforeCancel = repos.drafts.list().length;
		await click("Read material");
		await until("ocr stage", `(document.querySelector("[aria-label='Reading progress']")?.parentElement.textContent ?? "").includes("Reading scanned pages")`, 120_000, 300);
		await shot("light-reading-local");
		await click("Stop reading");
		await until("stop confirm", `!!document.querySelector("[role=alertdialog]")`, 3000);
		log(`stop confirm: ${await text("[role=alertdialog]")}`);
		await shot("light-reading-stop-confirm");
		await click("Keep reading", "[role=alertdialog]");
		await wait(700);
		log(`after Keep reading still running: ${await js<boolean>(`!!document.querySelector("[aria-label='Reading progress']")`)}`);
		await click("Stop reading");
		await until("stop confirm", `!!document.querySelector("[role=alertdialog]")`, 3000);
		await click("Stop reading", "[role=alertdialog]");
		await until("stopped", `!document.querySelector("[aria-label='Reading progress']")`, 30_000);
		await wait(800);
		log(`after stop: drafts ${beforeCancel} -> ${repos.drafts.list().length}; toast: ${await js<string>(`[...document.querySelectorAll("[data-sonner-toast]")].map((t) => t.textContent).join(" | ")`)}`);
		await shot("light-reading-stopped");
	} catch (err) {
		log(`HARNESS ERROR ${(err as Error).stack ?? err}`);
	} finally {
		// Keep the drafts this test made for the user to look at? No: remove them; the screenshots are the record.
		for (const d of repos.drafts.list().filter((x) => !draftsBefore.has(x.id))) {
			repos.drafts.remove(d.id);
			await rm(join(appFolders().drafts, d.id), { recursive: true, force: true });
		}
		for (const id of createdProviders) if (aiStore.get(id)) aiStore.remove(id);
		for (const [slot, v] of Object.entries(slotsBefore)) aiStore.setSlot(slot as "planner" | "vision" | "cheap", v);
		log(`cleanup: providers ${providersBefore.size} -> ${aiStore.list().length}; drafts back to ${repos.drafts.list().length}`);
		log(`renderer console errors: ${errors.length ? errors.join(" || ") : "none"}`);
		applyTheme("system");
		await wait(300);
		app.quit();
	}
}
