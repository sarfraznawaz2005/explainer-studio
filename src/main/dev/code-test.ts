import { app, session, type BrowserWindow } from "electron";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { STYLE_IDS, VideoPlan, type VideoPlanInput } from "@shared/plan/schema";
import { ENDLESS_CODE, CRASH_IN_SCENE_2, LAYOUT_ISSUES_CODE, NAN_CODE, OVERFLOW_CODE, SAMPLE_CODE } from "../../../video/src/samples/code-samples";
import { SAMPLE_PLAN } from "../../../video/src/samples/web-page-journey";
import { GALLERY_PLAN } from "../../../video/src/samples/gallery";
import { CODE_STARTER } from "@shared/plan/code-starter";
import { openCheckPage, testDraw } from "../app/code-check";
import { repos } from "../db/repos";
import { VIDEO_FORMATS } from "@shared/planner";

/**
 * EXPLAINER_CODE_TEST=<folder>: the "AI free-form" sandbox in the real app.
 *  - The check page is locked: no app bridge, no Node, no network, no other pages.
 *  - The test draw passes good code and catches crashes, NaN values, endless loops and text outside the frame.
 *  - The Studio plays AI code only in the sandboxed iframe; scene buttons and play work through it;
 *    a crash shows the error bar; the iframe cannot navigate away.
 * Run it with EXPLAINER_USER_DATA=<empty folder>. Results go to <folder>/results.json; the app quits after.
 */
const withCode = (source: string): VideoPlan => VideoPlan.parse({ ...SAMPLE_PLAN, meta: { ...SAMPLE_PLAN.meta, style: "code", code: { name: "Test", idea: "", source } } } satisfies VideoPlanInput);

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runCodeTest(win: BrowserWindow, dir: string): Promise<void> {
	mkdirSync(dir, { recursive: true });
	const results: Record<string, { ok: boolean; detail?: unknown }> = {};
	const logPath = join(dir, "log.txt");
	writeFileSync(logPath, "");
	const pass = (name: string, ok: boolean, detail?: unknown) => {
		results[name] = { ok, detail };
		appendFileSync(logPath, `${ok ? "PASS" : "FAIL"} ${name} ${detail === undefined ? "" : JSON.stringify(detail).slice(0, 2000)}\n`);
		console.log(`[code-test] ${ok ? "PASS" : "FAIL"} ${name}`);
	};
	// Proof that nothing leaves the PC: every request to the test hosts is recorded (and cancelled).
	const outgoing: string[] = [];
	session.defaultSession.webRequest.onBeforeRequest({ urls: ["https://example.com/*", "http://127.0.0.1:9/*"] }, (d, cb) => {
		outgoing.push(d.url);
		cb({ cancel: true });
	});
	try {
		const page = await openCheckPage();
		const iso = (await page.webContents.executeJavaScript(
			`(async () => {
				const out = { studio: typeof window.studio, require: typeof require, process: typeof process, origin: location.origin };
				const tryFetch = async (u) => { try { const r = await fetch(u); return r.ok ? "allowed" : "blocked"; } catch (e) { return "blocked"; } };
				out.web = await tryFetch("https://example.com/");
				out.local = await tryFetch("http://127.0.0.1:9/");
				out.file = await tryFetch("file:///C:/Windows/win.ini");
				out.app = await tryFetch("es-preview://app/index.html");
				try { new Function("return 1")(); out.eval = "allowed"; } catch { out.eval = "blocked"; }
				const img = await new Promise((r) => { const i = new Image(); i.onload = () => r("allowed"); i.onerror = () => r("blocked"); i.src = "https://example.com/x.png"; });
				out.webImage = img;
				return out;
			})()`,
			true,
		)) as Record<string, string>;
		pass("check page has no app bridge and no Node", iso.studio === "undefined" && iso.require === "undefined" && iso.process === "undefined", iso);
		pass("check page is its own origin", iso.origin === "es-preview://app", iso.origin);
		pass("check page cannot reach the network or files", iso.web === "blocked" && iso.local === "blocked" && iso.file === "blocked" && iso.webImage === "blocked" && outgoing.length === 0, { ...iso, outgoing });
		pass("check page serves only the preview page", iso.app === "blocked", iso.app);
		pass("check page may compile code (eval allowed there only)", iso.eval === "allowed", iso.eval);

		const t0 = Date.now();
		const good = await testDraw(withCode(SAMPLE_CODE));
		pass("good code: no errors", good.errors.length === 0 && good.frames > 5, { ...good, ms: Date.now() - t0 });

		// The starter the AI begins from: every scene type, no errors and no warnings.
		const starterPlan = VideoPlan.parse({ ...GALLERY_PLAN, meta: { ...GALLERY_PLAN.meta, style: "code", code: { name: "Starter", idea: "", source: CODE_STARTER } } } satisfies VideoPlanInput);
		const starter = await testDraw(starterPlan);
		pass("the starter file draws every scene type cleanly", starter.errors.length === 0 && starter.warnings.length === 0, starter);
		const starterTall = await testDraw({ ...starterPlan, meta: { ...starterPlan.meta, width: 1080, height: 1920 } });
		pass("the starter file draws cleanly in a tall frame", starterTall.errors.length === 0 && starterTall.warnings.length === 0, starterTall);
		const starterTweaked = await testDraw({ ...starterPlan, meta: { ...starterPlan.meta, tweaks: { accent: "#e11d48", text: 1.15, space: 1.25, speed: 2 } } });
		pass("the starter file still fits with the largest tweaks", starterTweaked.errors.length === 0 && !starterTweaked.warnings.some((w) => /goes outside|on top of each other|cut off/.test(w.message)), starterTweaked);

		const crash = await testDraw(withCode(CRASH_IN_SCENE_2));
		pass("crash in scene 2 is found and named", crash.errors.length > 0 && crash.errors.every((e) => e.scene === 1) && /boom in scene 2/.test(crash.errors[0]?.message ?? ""), crash);

		const nan = await testDraw(withCode(NAN_CODE));
		pass("NaN values are found", nan.errors.some((e) => /NaN/.test(e.message)), nan);

		const endless = await testDraw(withCode(ENDLESS_CODE));
		pass("an endless loop is stopped and reported", endless.errors.some((e) => /loop ran too long/.test(e.message)), endless);

		const over = await testDraw(withCode(OVERFLOW_CODE));
		pass("text outside the frame is a warning", over.errors.length === 0 && over.warnings.some((w) => /goes outside/.test(w.message)), over);

		pass("the good sample gives no layout warnings", good.warnings.length === 0, good.warnings);

		const t1 = Date.now();
		const layout = await testDraw(withCode(LAYOUT_ISSUES_CODE));
		const has = (re: RegExp) => layout.warnings.some((w) => re.test(w.message) && /Fix: /.test(w.message));
		const kinds = { overlap: has(/on top of each other/), edge: has(/touches the frame edge/), small: has(/too small to read/), clipped: has(/cut off by its box/), contrast: has(/hard to read: contrast/), frozen: has(/Nothing moves/), brief: has(/needs about/) };
		pass("hard-to-read text and frozen motion are warnings with a Fix line", layout.errors.length === 0 && Object.values(kinds).every(Boolean), { kinds, ms: Date.now() - t1, warnings: layout.warnings.map((w) => w.message) });
		// The built-in scenes in every frame shape: no text outside, on top of other text, cut off or at the edge.
		for (const size of Object.values(VIDEO_FORMATS)) {
			for (const style of STYLE_IDS.filter((x) => x !== "code")) {
				const plan = VideoPlan.parse({ ...GALLERY_PLAN, meta: { ...GALLERY_PLAN.meta, style, width: size.width, height: size.height } } satisfies VideoPlanInput);
				const r = await testDraw(plan);
				// The test has no figure files: the placeholder shows the file name. Not a layout problem.
				const layout = r.warnings.filter((w) => /goes outside|on top of each other|cut off by its box|touches the frame edge/.test(w.message) && !/\.png"/.test(w.message));
				const types = plan.chapters.flatMap((c) => c.scenes).map((s) => s.type);
				pass(`built-in scenes fit a ${size.label} frame (${style})`, r.errors.length === 0 && layout.length === 0, { errors: r.errors, layout: layout.map((w) => `${types[w.scene]}: ${w.message}`) });
			}
			// Captions on: the scenes keep their text above the captions (nothing on top of each other).
			for (const captions of ["pill", "pop"] as const) {
				const plan = VideoPlan.parse({ ...GALLERY_PLAN, meta: { ...GALLERY_PLAN.meta, style: "clean", captions, width: size.width, height: size.height } } satisfies VideoPlanInput);
				const r = await testDraw(plan);
				const layout = r.warnings.filter((w) => /goes outside|on top of each other|cut off by its box|touches the frame edge/.test(w.message) && !/\.png"/.test(w.message));
				const types = plan.chapters.flatMap((c) => c.scenes).map((s) => s.type);
				pass(`captions (${captions}) do not cover the scenes in a ${size.label} frame`, r.errors.length === 0 && layout.length === 0, { errors: r.errors, layout: layout.map((w) => `${types[w.scene]}: ${w.message}`) });
			}
		}

		const broken = await testDraw(withCode("export default function Video( {"));
		pass("code that does not compile is reported once", broken.errors.length === 1 && broken.errors[0]!.scene === -1, broken);

		const after = await testDraw(withCode(SAMPLE_CODE));
		pass("the check page still works after all that", after.errors.length === 0, after.frames);

		// ---------- The Studio ----------
		const js = <T = unknown>(code: string) => win.webContents.executeJavaScript(code, true) as Promise<T>;
		const until = async (test: () => Promise<boolean>, ms: number) => {
			const end = Date.now() + ms;
			while (Date.now() < end) {
				if (await test()) return true;
				await wait(250);
			}
			return false;
		};
		const shot = async (name: string) => writeFileSync(join(dir, `${name}.png`), (await win.webContents.capturePage()).toPNG());
		const mk = (title: string, source: string) =>
			repos.drafts.create({
				title,
				level: "High school",
				stage: "preview",
				source: { title, sections: [{ heading: "Intro", text: "How a page reaches you." }], figures: [] },
				plan: withCode(source),
				settings: { level: "High school", language: "en", tone: "Friendly", targetMinutes: null, style: "code" },
			});
		const codeDraft = mk("Code video", SAMPLE_CODE);
		await js(`location.hash = "#/studio?draft=${codeDraft.id}"`);
		const framed = await until(() => js<boolean>("!!document.querySelector('[data-testid=sandbox-player]')"), 15_000);
		pass("the Studio shows the sandboxed player for code", framed);
		// The newest preview frame (a frame from an earlier draft can linger for a moment).
		const sandbox = () => win.webContents.mainFrame.framesInSubtree.filter((f) => f.url.startsWith("es-preview://") && !f.detached).at(-1);
		await until(async () => !!sandbox() && ((await sandbox()!.executeJavaScript("!!document.querySelector('canvas, div div')")) as boolean), 15_000);
		await wait(2500);
		await shot("studio-code");
		const f = sandbox();
		const inside = f ? ((await f.executeJavaScript("({ studio: typeof window.studio, origin: location.origin, parentReadable: (() => { try { return !!window.parent.document; } catch { return false; } })() })")) as Record<string, unknown>) : null;
		pass("the preview frame has no app bridge and cannot read the app page", !!inside && inside.studio === "undefined" && inside.origin === "es-preview://app" && inside.parentReadable === false, inside);
		const mainEval = await js<string>("(() => { try { eval('1'); return 'allowed'; } catch { return 'blocked'; } })()");
		pass("the app window still blocks eval", mainEval === "blocked", mainEval);

		const sceneText = () => js<string>("[...document.querySelectorAll('span')].map((s) => s.textContent).find((t) => /^Scene \\d+ of \\d+$/.test(t ?? '')) ?? ''");
		const before = await sceneText();
		await js("document.querySelector('[aria-label=\"Next scene\"]')?.click()");
		const moved = await until(async () => (await sceneText()) !== before, 5_000);
		pass("next scene seeks the sandboxed player and the Studio follows", moved, { before, after: await sceneText() });
		await js("[...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Play')?.click()");
		const playing = await until(() => js<boolean>("[...document.querySelectorAll('button')].some((b) => b.textContent?.trim() === 'Pause')"), 5_000);
		pass("play works through the sandbox", playing);
		await js("[...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Pause')?.click()");

		if (f) {
			await f.executeJavaScript("location.href = 'https://example.com/'").catch(() => undefined);
			await wait(1000);
			const urls = win.webContents.mainFrame.framesInSubtree.map((x) => x.url);
			// The app page's policy (frame-src es-preview:) stops it before any request: the frame shows an error page.
			pass("the preview frame cannot navigate away (no request leaves)", outgoing.length === 0, { urls, outgoing });
		}

		// ---------- Quick tweaks (no AI call) ----------
		const hasTweaksBar = () => js<boolean>("!!document.querySelector('[data-testid=code-tweaks]')");
		pass("no tweaks bar for a design that does not read the tweaks", !(await hasTweaksBar()));
		const biggest = async () => {
			await until(async () => !!sandbox() && ((await sandbox()!.executeJavaScript("document.querySelectorAll('div').length > 5")) as boolean), 15_000);
			await wait(2000);
			return (await sandbox()!.executeJavaScript("Math.max(...[...document.querySelectorAll('div')].filter((d) => d.textContent && d.children.length === 0).map((d) => parseFloat(getComputedStyle(d).fontSize) || 0))")) as number;
		};
		const plain = mk("Starter", CODE_STARTER);
		await js(`location.hash = "#/studio?draft=${plain.id}"`);
		const barShown = await until(hasTweaksBar, 15_000);
		const sizeBefore = await biggest();
		const bigger = repos.drafts.create({
			title: "Starter bigger",
			level: "High school",
			stage: "preview",
			source: { title: "x", sections: [{ heading: "Intro", text: "How a page reaches you." }], figures: [] },
			plan: { ...withCode(CODE_STARTER), meta: { ...withCode(CODE_STARTER).meta, tweaks: { text: 1.15, space: 1, speed: 1 } } },
			settings: { level: "High school", language: "en", tone: "Friendly", targetMinutes: null, style: "code" },
		});
		await js(`location.hash = "#/studio?draft=${bigger.id}"`);
		await until(hasTweaksBar, 15_000);
		const sizeAfter = await biggest();
		await shot("studio-tweaks");
		pass("a design that reads the tweaks shows the bar, and bigger text makes bigger text", barShown && sizeAfter > sizeBefore, { barShown, sizeBefore, sizeAfter });

		// ---------- Change one part ----------
		const pickShown = await until(() => js<boolean>("!!document.querySelector('[data-testid=pick-part]')"), 8_000);
		await js("document.querySelector('[data-testid=pick-part]')?.click()");
		await wait(500);
		const pickOn = (await sandbox()!.executeJavaScript("!!document.querySelector('div[style*=crosshair]')")) as boolean;
		const buttonText = await js<string>("document.querySelector('[data-testid=pick-part]')?.textContent ?? ''");
		// A click on a part inside the sandbox (as the user would): the capture handler names it.
		const clicked = (await sandbox()!.executeJavaScript(`(() => {
			const el = [...document.querySelectorAll('[data-id]')].find((e) => /^s\\d+-(title|item-0)$/.test(e.getAttribute('data-id')) && e.getBoundingClientRect().width > 0);
			if (!el) return null;
			const r = el.getBoundingClientRect();
			el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
			return el.getAttribute('data-id');
		})()`)) as string | null;
		const dialog = await until(() => js<boolean>("!!document.querySelector('[data-testid=code-part]')"), 5_000);
		const partText = await js<string>("document.querySelector('[data-testid=code-part]')?.textContent ?? ''");
		await shot("studio-pick-part");
		const stillPaused = await js<boolean>("[...document.querySelectorAll('button')].some((b) => b.textContent?.trim() === 'Play')");
		pass("change one part: pick mode names the clicked part and opens the dialog for it (the click does not play)", pickShown && !!clicked && dialog && partText.includes(clicked ?? "~") && stillPaused, { pickShown, pickOn, buttonText, clicked, dialog, partText, stillPaused });
		await js("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
		await wait(400);

		const bad = mk("Crash video", CRASH_IN_SCENE_2);
		await js(`location.hash = "#/studio?draft=${bad.id}"`);
		await until(() => js<boolean>("!!document.querySelector('[data-testid=sandbox-player]')"), 15_000);
		await wait(2500);
		await js("document.querySelector('[aria-label=\"Next scene\"]')?.click()");
		const errBar = await until(() => js<boolean>("!!document.querySelector('[data-testid=code-errors]')"), 8_000);
		await shot("studio-code-error");
		pass("a code crash shows the error bar", errBar, await js<string>("document.querySelector('[data-testid=code-errors]')?.textContent ?? ''"));
	} catch (err) {
		pass("code test crashed", false, String((err as Error)?.stack ?? err));
	}
	session.defaultSession.webRequest.onBeforeRequest(null);
	writeFileSync(join(dir, "results.json"), JSON.stringify(results, null, 2));
	console.log(`[code-test] ${Object.values(results).every((r) => r.ok) ? "ALL PASS" : "FAILURES"} -> ${dir}`);
	app.quit();
}
