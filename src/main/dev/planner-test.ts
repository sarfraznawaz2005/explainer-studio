import { app, type BrowserWindow } from "electron";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { aiStore } from "../ai";
import { appFolders } from "../app/folders";
import { applyTheme } from "../app/theme";
import { repos } from "../db/repos";

/**
 * EXPLAINER_PLANNER_TEST=<folder>: a PDF chapter becomes a previewable plan in the real app.
 *  1. Claude through the local Claude Code CLI login on every slot (removed at the end).
 *  2. Reads Computer Science XI.pdf pages 81-85, then Continue to outline.
 *  3. Writes the outline, edits it (autosave), tries a delete and cancels it.
 *  4. Paid-run check: a pay-per-use provider on the Planner slot shows a cost and asks first; Cancel starts nothing.
 *  5. Approves the outline on Claude: script, fact/level/pacing checks, quality report.
 *  6. Opens the plan in the Studio and plays it.
 * Only drafts and providers it created are removed.
 */
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const PDF = resolve(app.getAppPath(), "..", "Computer Science XI.pdf");

export async function runPlannerTest(win: BrowserWindow, dir: string): Promise<void> {
	mkdirSync(dir, { recursive: true });
	const logPath = join(dir, "log.txt");
	writeFileSync(logPath, "");
	const log = (msg: string) => {
		appendFileSync(logPath, `${new Date().toISOString()} ${msg}\n`);
		console.log(`[planner-test] ${msg}`);
	};
	const js = <T = unknown>(code: string) => win.webContents.executeJavaScript(code, true) as Promise<T>;
	const shot = async (name: string) => {
		await wait(400);
		writeFileSync(join(dir, `${name}.png`), (await win.webContents.capturePage()).toPNG());
		log(`shot ${name}`);
	};
	const until = async (what: string, code: string, timeoutMs: number, everyMs = 400, onTick?: () => Promise<void>) => {
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
	const toasts = () => js<string>(`[...document.querySelectorAll("[data-sonner-toast]")].map((t) => t.textContent).join(" | ")`);
	const openSelect = async (label: string, option: string) => {
		await js(`document.querySelector("[aria-label='${label}']")?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" }))`);
		await until(`${label} open`, `!!document.querySelector("[role=option]")`, 3000);
		await click(option, "[role=listbox]");
		await wait(400);
	};
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

		// 1. Claude on every slot.
		const model = process.env.EXPLAINER_PLANNER_MODEL ?? "claude-sonnet-5-5";
		const claude = await aiStore.save({ kind: "claude-subscription", name: "Claude (test)", baseUrl: null, defaultModel: model });
		createdProviders.push(claude.id);
		for (const slot of ["planner", "vision", "cheap"] as const) aiStore.setSlot(slot, { providerId: claude.id, modelId: model });
		log(`all slots: Claude subscription / ${model}`);

		// 2. Read the PDF chapter.
		await js(`location.hash = "#/new"`);
		await wait(1000);
		if (await js<boolean>(`document.body.textContent.includes("Read something else")`)) await click("Read something else");
		await js(`(async () => { window.__addFiles(await window.studio.invoke("ingest:inspect", { paths: [${JSON.stringify(PDF)}] })); })()`);
		await wait(600);
		await js(`document.querySelector("[aria-label='Pages to read from Computer Science XI.pdf']")?.focus()`);
		await win.webContents.insertText("81-85");
		await wait(300);
		await click("Read material");
		const t0 = Date.now();
		await until("reading done", `document.body.textContent.includes("Saved as draft")`, 15 * 60_000, 1000);
		log(`reading took ${Math.round((Date.now() - t0) / 1000)} s`);
		const draft = repos.drafts.list().find((d) => !draftsBefore.has(d.id));
		if (!draft) throw new Error("no draft was made");
		log(`draft ${draft.id}: ${JSON.stringify((draft.source as { stats: unknown }).stats)}`);
		await wait(800);
		await click("Continue to outline");
		await until("wizard", `document.body.textContent.includes("Plan the video")`, 10_000);
		await until("estimate", `!!document.querySelector("[data-testid=estimate-cost]")`, 30_000);
		await openSelect("Target length", "About 5 minutes");
		await wait(1200);
		log(`outline estimate: ${await text("[data-testid=estimate-cost]")} | ${await js<string>(`[...document.querySelectorAll("h3")].find((h) => h.textContent.includes("Before you run"))?.closest("div.rounded-2xl, section, div")?.parentElement?.textContent ?? ""`)}`);
		await shot("light-1-plan-start");

		// 3. Outline.
		await click("Write the outline");
		const t1 = Date.now();
		await until("outline running", `!!document.querySelector("[aria-label='Planning progress']")`, 10_000, 200);
		await shot("light-2-outline-running");
		await until("outline done", `!document.querySelector("[aria-label='Planning progress']") && !!document.querySelector("[aria-label='Chapter 1 title']")`, 10 * 60_000, 1000);
		log(`outline took ${Math.round((Date.now() - t1) / 1000)} s; toast: ${await toasts()}`);
		await wait(800);
		await shot("light-3-outline");
		const o1 = repos.drafts.get(draft.id)!.outline as { title: string; hook: string[]; chapters: { title: string; minutes: number; sources: string[]; keyPoints: string[] }[] };
		log(`outline: "${o1.title}" | hook: ${o1.hook.join(" ")} | ${o1.chapters.map((c) => `${c.title} (${c.minutes} min, ${c.sources.join("/")}, ${c.keyPoints.length} pts)`).join(" | ")}`);

		// Edit chapter 1's title; autosave.
		await js(`document.querySelector("[aria-label='Chapter 1 title']")?.focus(); document.querySelector("[aria-label='Chapter 1 title']")?.select()`);
		await win.webContents.insertText("Why we sort things");
		await until("saved", `document.body.textContent.includes("· Saved")`, 10_000);
		log(`after edit, saved chapter 1 title: "${(repos.drafts.get(draft.id)!.outline as { chapters: { title: string }[] }).chapters[0]!.title}"`);
		// Delete asks first; cancel keeps the chapter.
		const before = o1.chapters.length;
		await js(`document.querySelector("[aria-label='Delete chapter ${before}']")?.click()`);
		await until("delete confirm", `!!document.querySelector("[role=alertdialog]")`, 3000);
		log(`delete confirm: ${await text("[role=alertdialog]")}`);
		await shot("light-4-delete-confirm");
		await click("Cancel", "[role=alertdialog]");
		await wait(500);
		log(`chapters after cancel: ${await js<number>(`document.querySelectorAll("[aria-label$=' title'][aria-label^='Chapter ']").length`)} (was ${before})`);

		// 4. Paid run: a pay-per-use provider on the Planner slot. The key is a dummy; no call is made.
		const paid = await aiStore.save({ kind: "anthropic", name: "Anthropic API (test)", apiKey: "sk-ant-test-dummy-key-never-sent", baseUrl: null, defaultModel: model });
		createdProviders.push(paid.id);
		aiStore.setSlot("planner", { providerId: paid.id, modelId: model });
		await openSelect("Tone", "Calm");
		await until("paid estimate", `document.body.textContent.includes("Paid per use")`, 30_000);
		await wait(800);
		log(`script estimate (paid): ${await text("[data-testid=estimate-cost]")}`);
		await shot("light-5-paid-estimate");
		const usageBefore = repos.aiUsage.count();
		await click("Approve and write script");
		await until("cost confirm", `!!document.querySelector("[role=alertdialog]")`, 10_000);
		log(`cost confirm: ${await text("[role=alertdialog]")}`);
		await shot("light-6-paid-confirm");
		await click("Cancel", "[role=alertdialog]");
		await wait(1500);
		log(`after Cancel: running=${await js<boolean>(`!!document.querySelector("[aria-label='Planning progress']")`)}, new usage rows=${repos.aiUsage.count() - usageBefore}, stage=${repos.drafts.get(draft.id)!.stage}`);
		const guard = await js<string>(
			`window.studio.invoke("planner:outline", { draftId: ${JSON.stringify(draft.id)}, settings: { level: "High school" }, confirmedCost: false }).then(() => "STARTED (bad)", (e) => e.message)`,
		);
		log(`main refuses an unconfirmed paid run: ${guard}`);
		aiStore.remove(paid.id);
		aiStore.setSlot("planner", { providerId: claude.id, modelId: model });
		await openSelect("Tone", "Friendly");
		await until("subscription estimate", `document.body.textContent.includes("Subscription")`, 30_000);

		// 5. Script on Claude.
		await click("Approve and write script");
		const t2 = Date.now();
		await until("script running", `!!document.querySelector("[aria-label='Planning progress']")`, 15_000, 200);
		let shots = 0;
		const seen = new Set<string>();
		await until("script done", `document.body.textContent.includes("Plan ready") || document.body.textContent.includes("Approve and write script")`, 30 * 60_000, 1500, async () => {
			const line = await js<string>(`[...document.querySelectorAll("ol li")].map((l) => l.textContent).join(" / ")`);
			if (line && !seen.has(line)) {
				seen.add(line);
				log(`progress: ${line.slice(0, 300)}`);
				if (shots < 4 && (seen.size === 2 || seen.size % 4 === 0)) await shot(`light-7-script-${++shots}`);
			}
		});
		log(`script took ${Math.round((Date.now() - t2) / 1000)} s; toast: ${await toasts()}`);
		const d2 = repos.drafts.get(draft.id)!;
		const report = d2.report as { fact: { checked: number; issues: { status: string; sentence: string; note: string }[] }; level: { avgWords: number; issues: { status: string; kind: string }[] }; pacing: { issues: { kind: string; detail: string }[] }; estimateMinutes: number } | null;
		const plan = d2.plan as { meta: Record<string, unknown>; chapters: { title: string; scenes: { type: string }[] }[] } | null;
		log(`stage ${d2.stage}; plan meta ${JSON.stringify(plan?.meta)}`);
		log(`chapters: ${plan?.chapters.map((c) => `${c.title} [${c.scenes.map((s) => s.type).join(",")}]`).join(" | ")}`);
		log(`report: ${JSON.stringify(report && { checked: report.fact.checked, facts: report.fact.issues, avg: report.level.avgWords, level: report.level.issues.map((i) => `${i.kind}:${i.status}`), pacing: report.pacing.issues, minutes: report.estimateMinutes })}`);
		await wait(800);
		await shot("light-8-plan-ready");
		applyTheme("dark");
		await js(`document.documentElement.classList.add("dark")`);
		await wait(1000);
		await shot("dark-8-plan-ready");
		applyTheme("light");
		await js(`document.documentElement.classList.remove("dark")`);
		await wait(600);

		// 6. Studio.
		await click("Open in Studio");
		await until("studio", `!!document.querySelector(".__remotion-player, [class*=remotion]") || document.body.textContent.includes("Scene 1 of")`, 20_000);
		await wait(2500);
		await shot("light-9-studio");
		log(`studio header: ${await js<string>(`document.querySelector("header h1")?.parentElement?.parentElement?.textContent ?? ""`)}`);
		for (let k = 0; k < 3; k++) {
			await js(`window.dispatchEvent(new KeyboardEvent("keydown", { key: "]" }))`);
			await wait(300);
		}
		await wait(1500);
		await shot("light-10-studio-scene4");
		applyTheme("dark");
		await js(`document.documentElement.classList.add("dark")`);
		for (let k = 0; k < 4; k++) {
			await js(`window.dispatchEvent(new KeyboardEvent("keydown", { key: "]" }))`);
			await wait(300);
		}
		await wait(1500);
		await shot("dark-11-studio-scene8");
		await click("Play");
		await wait(4000);
		await click("Pause");
		log(`studio after play: ${await js<string>(`[...document.querySelectorAll("span")].find((s) => s.textContent?.startsWith("Scene "))?.textContent ?? ""`)}`);
		await shot("dark-12-studio-played");
	} catch (err) {
		log(`HARNESS ERROR ${(err as Error).stack ?? err}`);
	} finally {
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
