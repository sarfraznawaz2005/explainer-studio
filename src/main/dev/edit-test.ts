import { app, type BrowserWindow } from "electron";
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { VideoPlan, type Scene } from "@shared/plan/schema";
import { aiStore } from "../ai";
import { applyTheme } from "../app/theme";
import { repos } from "../db/repos";
import { duplicateDraft, removeDraft } from "../library";

/**
 * EXPLAINER_EDIT_TEST=<folder>: Studio editing in the real app, on a copy of a voiced draft
 * (EXPLAINER_EDIT_DRAFT, else the newest draft with a plan). Two app starts:
 *  Start 1: 22 edits in the UI (content form, change type, style, a sentence), then 22 undos
 *           (the saved plan must match the start) and 22 redos (it must match the end); one scene
 *           rewritten by the AI (Claude CLI login), every other scene unchanged; undo/redo of the
 *           rewrite; screenshots; one last edit, then the app is killed (no clean quit).
 *  Start 2: the last edit is back after the restart (autosave); the test copy is deleted.
 */
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
type State = { copyId: string; sceneId: string; marker: string };

/** Without voice clip names and measured lengths (they come and go with the voice step). */
const words = (p: VideoPlan) => JSON.stringify({ ...p, chapters: p.chapters.map((c) => ({ ...c, scenes: c.scenes.map((s) => ({ ...s, narration: s.narration.map((n) => ({ id: n.id, text: n.text })) })) })) });

export async function runEditTest(win: BrowserWindow, dir: string): Promise<void> {
	mkdirSync(dir, { recursive: true });
	const statePath = join(dir, "state.json");
	const phase = existsSync(statePath) ? "b" : "a";
	const logPath = join(dir, "log.txt");
	if (phase === "a") writeFileSync(logPath, "");
	const log = (msg: string) => {
		appendFileSync(logPath, `${new Date().toISOString()} [${phase}] ${msg}\n`);
		console.log(`[edit-test] ${msg}`);
	};
	const js = <T = unknown>(code: string) => win.webContents.executeJavaScript(code, true) as Promise<T>;
	const shot = async (name: string) => {
		win.webContents.invalidate();
		await wait(500);
		writeFileSync(join(dir, `${name}.png`), (await win.webContents.capturePage()).toPNG());
		log(`shot ${name}`);
	};
	const until = async (what: string, test: () => Promise<boolean> | boolean, timeoutMs: number, everyMs = 250) => {
		const end = Date.now() + timeoutMs;
		while (Date.now() < end) {
			if (await test()) return true;
			await wait(everyMs);
		}
		log(`TIMEOUT waiting for ${what}`);
		return false;
	};
	const dom = (code: string) => () => js<boolean>(code);
	const text = (sel: string) => js<string>(`document.querySelector(${JSON.stringify(sel)})?.textContent ?? ""`);
	const clickSel = (sel: string) => js<boolean>(`(() => { const b = document.querySelector(${JSON.stringify(sel)}); if (!b || b.disabled) return false; b.click(); return true; })()`);
	const click = (label: string, scope = "document") =>
		js<boolean>(
			`(() => { const root = ${scope === "document" ? "document" : `document.querySelector(${JSON.stringify(scope)})`}; const b = root && [...root.querySelectorAll("button, [role=menuitem], [role=option]")].find((x) => x.textContent?.trim() === ${JSON.stringify(label)} && !x.disabled && x.getAttribute("aria-disabled") !== "true"); b?.click(); return !!b; })()`,
		);
	/** Radix menus and selects open on pointer events, not click(). */
	const pointerOpen = async (sel: string) => {
		await js(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
		await wait(200);
		const s = JSON.stringify(sel);
		await js(`(() => { const b = document.querySelector(${s}); b?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" })); })()`);
		return until(`open ${sel}`, dom(`document.querySelector(${s})?.getAttribute("aria-expanded") === "true" || document.querySelector(${s})?.getAttribute("data-state") === "open"`), 3000, 100);
	};
	const pickOption = async (label: string) => {
		await until(`option ${label}`, dom(`!!document.querySelector("[role=listbox] [role=option], [role=menu][data-state=open] [role=menuitem]")`), 3000, 100);
		const ok = await js<boolean>(
			`(() => { const o = [...document.querySelectorAll("[role=listbox] [role=option], [role=menu][data-state=open] [role=menuitem]")].find((x) => x.textContent?.trim() === ${JSON.stringify(label)}); if (!o) return false; o.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, pointerType: "mouse" })); o.click(); return true; })()`,
		);
		await wait(250);
		return ok;
	};
	const stored = () => VideoPlan.parse(repos.drafts.get(state.copyId)!.plan);
	const saveState = () => text("[data-testid=save-state]");
	const saved = async () => {
		await wait(150);
		return until("Saved", async () => (await saveState()).trim() === "Saved", 30_000, 150);
	};
	const sceneButtons = () => js<number>(`document.querySelectorAll("nav[aria-label=Scenes] li > button").length`);
	const pickScene = async (i: number) => {
		await js(`document.querySelectorAll("nav[aria-label=Scenes] li > button")[${i}]?.click()`);
		await until("form", dom(`!!document.querySelector("[data-testid=props-form]")`), 5000, 100);
		await wait(250);
	};
	/** Types into the first plain text field of the content form and leaves it (a commit). */
	const editFirstText = async (suffix: string) =>
		js<string | null>(`((suffix) => {
			const el = [...document.querySelectorAll("[data-testid=props-form] input:not([type=number]), [data-testid=props-form] textarea")].find((x) => !x.disabled && !x.className.includes("font-mono"));
			if (!el) return null;
			const max = el.maxLength > 0 ? el.maxLength : 200;
			const v = (el.value.slice(0, Math.max(1, max - suffix.length - 1)) + " " + suffix).trim();
			el.focus();
			const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
			Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v);
			el.dispatchEvent(new Event("input", { bubbles: true }));
			el.blur();
			return el.value;
		})(${JSON.stringify(suffix)})`);
	const key = (k: string, shift = false) => js(`window.dispatchEvent(new KeyboardEvent("keydown", { key: ${JSON.stringify(k)}, ctrlKey: true, shiftKey: ${shift}, bubbles: true }))`);
	const theme = async (t: "light" | "dark") => {
		applyTheme(t);
		await js(`document.documentElement.classList.toggle("dark", ${t === "dark"})`);
		await wait(1200);
	};
	const errors: string[] = [];
	win.webContents.on("console-message", (e) => {
		if (e.level === "error") errors.push(e.message);
	});
	let state: State = phase === "b" ? (JSON.parse(readFileSync(statePath, "utf8")) as State) : { copyId: "", sceneId: "", marker: "" };

	try {
		await wait(1500);
		await theme("light");
		if (phase === "a") await phaseA();
		else await phaseB();
	} catch (err) {
		log(`FAILED: ${(err as Error).stack ?? err}`);
	}
	log(`console errors: ${errors.length}${errors.length ? ` — ${errors.slice(0, 5).join(" | ")}` : ""}`);
	if (phase === "b" || !existsSync(statePath)) {
		log("done");
		app.quit();
	}

	async function phaseA() {
		const baseId = process.env.EXPLAINER_EDIT_DRAFT ?? repos.drafts.list().filter((d) => d.plan).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]?.id;
		if (!baseId) throw new Error("no draft with a script to copy");
		const copyId = await duplicateDraft(baseId);
		state = { copyId, sceneId: "", marker: "" };
		log(`copy of ${baseId} → ${copyId}`);
		await js(`location.hash = "#/studio?draft=${copyId}"`);
		await until("studio", dom(`!!document.querySelector("[data-testid=save-state]") && !!document.querySelector("nav[aria-label=Scenes]")`), 30_000);
		await wait(1500);
		const n = await sceneButtons();
		const original = stored();
		log(`studio open: ${n} scenes, save state "${await saveState()}"`);
		await pickScene(Math.min(3, n - 1));
		await shot("a1-studio-edit-panel");

		// 22 edits through the UI.
		let edits = 0;
		const content = original.chapters.flatMap((c) => c.scenes).map((s, i) => ({ s, i }));
		for (const { s, i } of content) {
			if (edits >= 15) break;
			await pickScene(i);
			const v = await editFirstText(`e${edits + 1}`);
			if (v === null) continue;
			if (!(await saved())) throw new Error(`edit ${edits + 1} was not saved`);
			edits++;
			log(`edit ${edits}: ${s.type} ${s.id} → "${v.slice(-40)}"`);
		}
		const swaps: [number, string][] = [
			[content.find((c) => c.s.type === "bullets")?.i ?? 2, "Summary checklist"],
			[content.find((c) => c.s.type === "definition")?.i ?? 3, "Key-term glossary"],
			[content.find((c) => c.s.type === "flow")?.i ?? 4, "Cycle"],
			[content.find((c) => c.s.type === "compare" || c.s.type === "code")?.i ?? 5, "Mind map"],
		];
		for (const [i, label] of swaps) {
			await pickScene(i);
			const before = stored().chapters.flatMap((c) => c.scenes)[i]!.type;
			if (before === "title" || before === "chapter") continue;
			if (!(await pointerOpen("[data-testid=swap-type]"))) throw new Error("the change type menu did not open");
			if (edits === 15) await shot("a2-swap-menu");
			if (!(await pickOption(label))) throw new Error(`no menu item ${label}`);
			if (!(await saved())) throw new Error(`swap to ${label} was not saved`);
			edits++;
			log(`edit ${edits}: ${before} → ${stored().chapters.flatMap((c) => c.scenes)[i]!.type}`);
		}
		for (const style of ["Neon", "Blueprint"]) {
			if (!(await pointerOpen("[aria-label='Visual style']"))) throw new Error("the style list did not open");
			if (!(await pickOption(style))) throw new Error(`no style ${style}`);
			if (!(await saved())) throw new Error(`style ${style} was not saved`);
			edits++;
			log(`edit ${edits}: style → ${stored().meta.style}`);
		}
		await shot("a3-studio-blueprint");
		// A narration sentence.
		await pickScene(2);
		await clickSel("[aria-label='Edit sentence 1']");
		await until("sentence editor", dom(`!!document.querySelector("textarea[aria-label='Sentence text']")`), 3000, 100);
		await js(`(() => { const el = document.querySelector("textarea[aria-label='Sentence text']"); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(el, el.value + " Edited."); el.dispatchEvent(new Event("input", { bubbles: true })); })()`);
		await click("Save");
		if (!(await saved())) throw new Error("the sentence edit was not saved");
		edits++;
		log(`edit ${edits}: sentence → "${stored().chapters.flatMap((c) => c.scenes)[2]!.narration[0]!.text.slice(-50)}"`);
		while (edits < 22) {
			await pickScene(edits % n);
			if ((await editFirstText(`x${edits}`)) !== null && (await saved())) edits++;
		}
		const edited = stored();
		log(`${edits} edits saved; plan changed: ${words(edited) !== words(original)}`);

		// Undo every edit, then redo every edit.
		const undoTip = await js<string>(`document.querySelector("[data-testid=undo]")?.disabled ? "disabled" : "enabled"`);
		for (let k = 0; k < edits; k++) {
			await key("z");
			if (!(await saved())) throw new Error(`undo ${k + 1} was not saved`);
		}
		const undone = stored();
		log(`after ${edits} undos: matches the start = ${words(undone) === words(original)}; undo button was ${undoTip}; undo now ${(await js<boolean>(`document.querySelector("[data-testid=undo]").disabled`)) ? "disabled" : "enabled"}`);
		for (let k = 0; k < edits; k++) {
			await key("y");
			if (!(await saved())) throw new Error(`redo ${k + 1} was not saved`);
		}
		log(`after ${edits} redos: matches the end = ${words(stored()) === words(edited)}; redo now ${(await js<boolean>(`document.querySelector("[data-testid=redo]").disabled`)) ? "disabled" : "enabled"}`);
		await shot("a4-after-redo");

		// One scene rewritten by the AI.
		const model = process.env.EXPLAINER_PLANNER_MODEL ?? "claude-sonnet-5-5";
		const slotsBefore = aiStore.getSlots();
		const claude = await aiStore.save({ kind: "claude-subscription", name: "Claude (edit test)", baseUrl: null, defaultModel: model });
		aiStore.setSlot("planner", { providerId: claude.id, modelId: model });
		try {
			const plan = stored();
			const all = plan.chapters.flatMap((c) => c.scenes);
			const ti = all.findIndex((s, i) => i > 2 && s.type !== "title" && s.type !== "chapter");
			const target = all[ti]!;
			await pickScene(ti);
			await clickSel("[data-testid=regen-scene]");
			await until("rewrite dialog cost", async () => !(await text("[data-testid=regen-cost]")).includes("Working out"), 30_000);
			log(`rewrite dialog: ${await text("[data-testid=regen-cost]")}`);
			await shot("a5-rewrite-dialog");
			await js(`(() => { const el = document.querySelector("#regen-wish"); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(el, "Show it with a different scene type and add an everyday example."); el.dispatchEvent(new Event("input", { bubbles: true })); })()`);
			await clickSel("[data-testid=regen-start]");
			const t0 = Date.now();
			await until("rewrite running", async () => !(await saveState()).includes("Saved"), 20_000, 200);
			await shot("a6-rewrite-running");
			const done = await until("rewrite done", async () => (await saveState()).trim() === "Saved" && words(stored()) !== words(plan), 15 * 60_000, 1000);
			if (!done) throw new Error("the rewrite did not finish");
			const after = stored();
			const others = all.filter((s) => s.id !== target.id);
			const same = others.every((s) => JSON.stringify(after.chapters.flatMap((c) => c.scenes).find((x) => x.id === s.id)) === JSON.stringify(s));
			const nt = after.chapters.flatMap((c) => c.scenes).find((s) => s.id === target.id)!;
			log(`rewrite in ${Math.round((Date.now() - t0) / 1000)} s: ${target.type} "${target.id}" → ${nt.type}; narration "${nt.narration.map((x) => x.text).join(" ").slice(0, 160)}"`);
			log(`other ${others.length} scenes unchanged (exact, voice clips included): ${same}; scene count ${all.length} → ${after.chapters.flatMap((c) => c.scenes).length}`);
			await wait(1500);
			await shot("a7-after-rewrite");
			await key("z");
			await saved();
			const back = stored().chapters.flatMap((c) => c.scenes).find((s) => s.id === target.id) as Scene;
			log(`undo of the rewrite: old scene back = ${back.type === target.type && JSON.stringify(back.props) === JSON.stringify(target.props)}`);
			await key("y");
			await saved();
			log(`redo of the rewrite: new scene back = ${stored().chapters.flatMap((c) => c.scenes).find((s) => s.id === target.id)!.type === nt.type}`);
		} finally {
			aiStore.remove(claude.id);
			for (const [slot, v] of Object.entries(slotsBefore)) aiStore.setSlot(slot as "planner", v as never);
			log("test provider removed, slots restored");
		}

		// Timeline lanes and the chapter rewrite button; dark theme.
		log(`timeline lanes: ${(await js<string>(`[...document.querySelectorAll("[data-testid=sound-lanes] [role=img]")].map((l) => l.getAttribute("aria-label") + "=" + l.children.length).join(", ")`))}; chapter rewrite buttons: ${await js<number>(`document.querySelectorAll("[data-testid=regen-chapter]").length`)}`);
		await theme("dark");
		await pickScene(Math.min(5, n - 1));
		await shot("a8-studio-dark");
		await theme("light");

		// The last edit, then a hard kill: the next start must show it.
		const si = Math.min(4, n - 1);
		await pickScene(si);
		const marker = `Autosave ${Date.now().toString(36)}`;
		const v = await editFirstText(marker);
		if (!(await saved())) throw new Error("the last edit was not saved");
		state = { copyId, sceneId: stored().chapters.flatMap((c) => c.scenes)[si]!.id, marker };
		writeFileSync(statePath, JSON.stringify(state));
		log(`last edit saved ("${v?.slice(-30)}"); killing the app`);
		spawn("taskkill", ["/F", "/T", "/PID", String(process.pid)], { detached: true, stdio: "ignore", windowsHide: true }).unref();
		await wait(60_000);
	}

	async function phaseB() {
		const plan = stored();
		const inDb = JSON.stringify(plan.chapters.flatMap((c) => c.scenes).find((s) => s.id === state.sceneId)?.props ?? {}).includes(state.marker);
		await js(`location.hash = "#/studio?draft=${state.copyId}"`);
		await until("studio", dom(`!!document.querySelector("[data-testid=save-state]")`), 30_000);
		await wait(1500);
		const idx = plan.chapters.flatMap((c) => c.scenes).findIndex((s) => s.id === state.sceneId);
		await pickScene(idx);
		const shown = await js<boolean>(`[...document.querySelectorAll("[data-testid=props-form] input, [data-testid=props-form] textarea")].some((x) => x.value.includes(${JSON.stringify(state.marker)}))`);
		log(`after restart: last edit in the saved plan = ${inDb}; shown in the editor = ${shown}; style = ${plan.meta.style}`);
		await shot("b1-after-restart");
		await removeDraft(state.copyId);
		log(`test copy deleted: ${repos.drafts.get(state.copyId) === null}`);
	}
}
