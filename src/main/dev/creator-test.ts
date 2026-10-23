import { app, type BrowserWindow } from "electron";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { VideoPlan, type VideoPlanInput } from "@shared/plan/schema";
import { computeTimeline } from "@shared/plan/timing";
import { SAMPLE_PLAN } from "../../../video/src/samples/web-page-journey";
import { appFolders } from "../app/folders";
import { applyTheme } from "../app/theme";
import { setLogo } from "../brand";
import { repos } from "../db/repos";
import { renderQueue } from "../render";

/**
 * EXPLAINER_CREATOR_TEST=<folder>: brand kit, series, level copies, dashboard and storage
 * in the real app. Run it with EXPLAINER_USER_DATA=<empty folder> so it never touches the
 * user's data (the render engine folder may be copied in beforehand to skip the download).
 *  - Brand kit made in the UI (channel, tagline; the logo through the same main code the file dialog uses).
 *  - A series made in the UI; two drafts added as episodes; one moved.
 *  - "Version for another level" from the Drafts page.
 *  - A real render of episode 1: frames from the MP4 at the intro, mid-video and outro;
 *    the video row and youtube.txt carry the series and episode.
 *  - Storage: planted cache and leftover files, cleaned through the confirm dialog; the toast reports the freed space.
 */
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const FFPROBE = join(app.getAppPath(), "node_modules", "@remotion", "compositor-win32-x64-msvc", "ffprobe.exe");
const FFMPEG = join(app.getAppPath(), "node_modules", "@remotion", "compositor-win32-x64-msvc", "ffmpeg.exe");

/** A short plan: two chapters, three scenes, so the render takes about a minute. */
function shortPlan(title: string): VideoPlanInput {
	const [a, b] = SAMPLE_PLAN.chapters;
	return { ...SAMPLE_PLAN, meta: { ...SAMPLE_PLAN.meta, title }, chapters: [{ ...a!, scenes: a!.scenes.slice(0, 2) }, { ...b!, scenes: b!.scenes.slice(0, 1) }] };
}

export async function runCreatorTest(win: BrowserWindow, dir: string): Promise<void> {
	mkdirSync(dir, { recursive: true });
	const logPath = join(dir, "log.txt");
	writeFileSync(logPath, "");
	const log = (msg: string) => {
		appendFileSync(logPath, `${new Date().toISOString()} ${msg}\n`);
		console.log(`[creator-test] ${msg}`);
	};
	const js = <T = unknown>(code: string) => win.webContents.executeJavaScript(code, true) as Promise<T>;
	const shot = async (name: string) => {
		win.webContents.invalidate();
		await wait(600);
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
			`(() => { const root = ${scope === "document" ? "document" : `document.querySelector(${JSON.stringify(scope)})`}; const b = root && [...root.querySelectorAll("button, [role=menuitem], [role=option], [role=radio]")].find((x) => x.textContent?.trim() === ${JSON.stringify(label)} && !x.disabled && x.getAttribute("aria-disabled") !== "true"); b?.click(); return !!b; })()`,
		);
	/** Opens a Radix menu or select. `closeFirst` presses Escape first (never inside a dialog: it would close it). */
	const pointerOpen = async (sel: string, closeFirst = true) => {
		if (closeFirst) {
			await js(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
			await wait(200);
		}
		const s = JSON.stringify(sel);
		await js(`(() => { const b = document.querySelector(${s}); b?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" })); })()`);
		return until(`open ${sel}`, dom(`document.querySelector(${s})?.getAttribute("aria-expanded") === "true" || document.querySelector(${s})?.getAttribute("data-state") === "open"`), 3000, 100);
	};
	const pickOption = async (label: string) => {
		await until(`option ${label}`, dom(`!!document.querySelector("[role=listbox] [role=option], [role=menu][data-state=open] [role=menuitem]")`), 3000, 100);
		const ok = await js<boolean>(
			`(() => { const o = [...document.querySelectorAll("[role=listbox] [role=option], [role=menu][data-state=open] [role=menuitem]")].find((x) => x.textContent?.trim().startsWith(${JSON.stringify(label)})); if (!o) return false; o.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, pointerType: "mouse" })); o.click(); return true; })()`,
		);
		await wait(300);
		return ok;
	};
	/** Sets a React-controlled input the way typing does. */
	const type = (sel: string, value: string) =>
		js<boolean>(`(() => {
			const el = document.querySelector(${JSON.stringify(sel)});
			if (!el) return false;
			el.focus();
			const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
			Object.getOwnPropertyDescriptor(proto, "value").set.call(el, ${JSON.stringify(value)});
			el.dispatchEvent(new Event("input", { bubbles: true }));
			return true;
		})()`);
	const go = async (hash: string, ready: string) => {
		await js(`location.hash = ${JSON.stringify(hash)}`);
		await until(hash, dom(`!!document.querySelector(${JSON.stringify(ready)})`), 20_000);
		await wait(700);
	};
	const toasts = () => js<string>(`[...document.querySelectorAll("[data-sonner-toast]")].map((t) => t.textContent).join(" | ")`);
	const theme = async (t: "light" | "dark") => {
		applyTheme(t);
		await js(`document.documentElement.classList.toggle("dark", ${t === "dark"})`);
		await wait(1200);
	};
	const errors: string[] = [];
	win.webContents.on("console-message", (e) => {
		if (e.level === "error") errors.push(e.message);
	});

	try {
		await wait(2000);
		await theme("light");
		if (repos.drafts.count() || repos.brandKits.count()) throw new Error("run this with EXPLAINER_USER_DATA pointing at an empty folder");

		// Two short drafts with source material and one figure.
		const mk = (title: string) => {
			const d = repos.drafts.create({
				title,
				level: "High school",
				stage: "preview",
				source: { title, sections: [{ heading: "Intro", text: "How a page reaches you." }], figures: [] },
				plan: VideoPlan.parse(shortPlan(title)),
				settings: { level: "High school", language: "en", tone: "Friendly", targetMinutes: null, style: "auto" },
			});
			const figs = join(appFolders().drafts, d.id, "source", "figures");
			mkdirSync(figs, { recursive: true });
			writeFileSync(join(figs, "in1-001.png"), Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201a2b5d4f40000000049454e44ae426082", "hex"));
			return d;
		};
		const ep1 = mk("Packets and routers");
		const ep2 = mk("DNS lookups");
		log(`drafts: ${ep1.id}, ${ep2.id}`);

		// ---------- Brand kit ----------
		await go("#/brand", "[data-testid=brand-start]");
		await shot("01-brand-empty");
		await clickSel("[data-testid=brand-start]");
		await until("new kit dialog", dom(`!!document.querySelector("[data-testid=kit-channel]")`), 5000);
		await type("[data-testid=kit-channel]", "Science with Sam");
		await clickSel("[data-testid=kit-create]");
		await until("editor", dom(`!!document.querySelector("[data-testid=brand-channel]")`), 10_000);
		const kit = repos.brandKits.list()[0]!;
		log(`kit created in the UI: ${kit.name}, default=${kit.isDefault}`);
		// The logo: drawn in the window, saved as PNG, then imported by the same code the file dialog calls.
		const dataUrl = await js<string>(`(() => { const c = document.createElement("canvas"); c.width = 256; c.height = 256; const g = c.getContext("2d"); const gr = g.createLinearGradient(0, 0, 256, 256); gr.addColorStop(0, "#0f766e"); gr.addColorStop(1, "#6366f1"); g.fillStyle = gr; g.beginPath(); g.arc(128, 128, 120, 0, Math.PI * 2); g.fill(); g.fillStyle = "#fff"; g.font = "bold 150px Segoe UI"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("S", 128, 138); return c.toDataURL("image/png"); })()`);
		const logoFile = join(dir, "logo.png");
		writeFileSync(logoFile, Buffer.from(dataUrl.split(",")[1]!, "base64"));
		const withLogo = await setLogo(kit.id, logoFile);
		log(`logo stored: ${withLogo.data.logo}`);
		await go("#/", "[data-testid=home-queue]");
		await go("#/brand", "[data-testid=brand-channel]");
		await type('input[aria-label="Tagline"]', "Big ideas, made simple");
		await until("autosave", async () => (await text("[data-testid=brand-save]")).includes("Saved") && (repos.brandKits.get(kit.id)!.data as { tagline: string }).tagline === "Big ideas, made simple", 10_000);
		log(`tagline autosaved: ${(repos.brandKits.get(kit.id)!.data as { tagline: string }).tagline}; logo shown: ${await js<boolean>(`!!document.querySelector("[data-testid=brand-logo]")?.naturalWidth`)}`);
		await wait(1500);
		await shot("02-brand-editor");
		await click("Outro", "[data-testid=brand-preview] + div");
		await wait(2500);
		await js(`document.querySelector("[data-testid=brand-preview] button")?.click()`);
		await shot("03-brand-preview-outro");

		// ---------- Series ----------
		await go("#/series", "[data-testid=series-new]");
		await clickSel("[data-testid=series-new]");
		await until("series dialog", dom(`!!document.querySelector("[data-testid=series-title]")`), 5000);
		await type("[data-testid=series-title]", "How the web works");
		await clickSel("[data-testid=series-save]");
		await until("series card", dom(`!!document.querySelector("[data-testid=series-card]")`), 10_000);
		for (const d of [ep1, ep2]) {
			await clickSel("[data-testid=series-add-episode]");
			await until("add dialog", dom(`!!document.querySelector('[aria-label="Draft to add"]')`), 5000);
			await wait(800);
			await pointerOpen('[aria-label="Draft to add"]', false);
			log(`pick ${d.title}: ${await pickOption(d.title)}`);
			await clickSel("[data-testid=episode-add]");
			await until("episode added", () => repos.drafts.get(d.id)!.episode !== null, 10_000);
			await wait(800);
		}
		const numbers = async () => js<string>(`[...document.querySelectorAll("[data-testid=episode-row]")].map((r) => r.querySelector("[data-testid=episode-number]").textContent + " " + r.querySelector("button").textContent.split("High school")[0]).join(" / ")`);
		log(`episodes in the UI: ${await numbers()}`);
		await shot("04-series");
		await js(`document.querySelectorAll('[data-testid=episode-row] button[aria-label="Move up"]')[1]?.click()`);
		await until("moved", () => repos.drafts.get(ep2.id)!.episode === 1, 5000);
		await wait(600);
		log(`after moving episode 2 up: ${await numbers()}; db: ${repos.drafts.get(ep1.id)!.episode}/${repos.drafts.get(ep2.id)!.episode}`);
		await js(`document.querySelectorAll('[data-testid=episode-row] button[aria-label="Move down"]')[0]?.click()`);
		await until("moved back", () => repos.drafts.get(ep1.id)!.episode === 1, 5000);
		log(`moved back: ${await numbers()}`);

		// ---------- Version for another level ----------
		await go("#/drafts", "[data-testid=draft-row]");
		log(`drafts page series badges: ${await js<string>(`[...document.querySelectorAll("[data-testid=draft-series]")].map((b) => b.textContent).join(" | ")`)}`);
		await shot("05-drafts");
		const rowIdx = await js<number>(`[...document.querySelectorAll("[data-testid=draft-row]")].findIndex((r) => r.textContent.includes("Packets and routers"))`);
		await pointerOpen(`[data-testid=draft-row]:nth-child(${rowIdx + 1}) button[aria-label^="Actions for"]`);
		await pickOption("Version for another level");
		await until("level dialog", dom(`!!document.querySelector('[aria-label="Audience level for the new version"]')`), 5000);
		await pointerOpen('[aria-label="Audience level for the new version"]', false);
		await pickOption("Kindergarten");
		await wait(300);
		await shot("06-level-dialog");
		await clickSel("[data-testid=level-make]");
		await until("wizard", async () => (await js<string>("location.hash")).includes("/new?draft="), 10_000);
		const newId = decodeURIComponent((await js<string>("location.hash")).split("draft=")[1] ?? "");
		if (!newId) throw new Error("the level copy did not open in the wizard");
		const copy = repos.drafts.get(newId);
		log(`level copy: ${copy?.title}; level=${copy?.level}; settings.level=${(copy?.settings as { level?: string } | null)?.level}; outline=${copy?.outline}; plan=${copy?.plan}; figures=${readdirSync(join(appFolders().drafts, newId, "source", "figures")).join(",")}`);
		await wait(2500);
		await shot("07-level-wizard");

		// ---------- Render episode 1 with the brand kit ----------
		await go(`#/studio?draft=${ep1.id}`, "[data-testid=render-button]");
		await clickSel("[data-testid=render-button]");
		await until("render dialog", dom(`!!document.querySelector("[data-testid=render-start]") && !document.body.textContent.includes("Checking the draft")`), 20_000);
		await wait(700);
		log(`render dialog: ${(await text("[role=dialog]")).replace(/\s+/g, " ").slice(0, 700)}`);
		await shot("08-render-dialog");
		// Draft quality, 720p: the brand layer is the same at every size.
		await click("720p", "[role=dialog]");
		await click("Draft", "[role=dialog]");
		await clickSel("[data-testid=render-start]");
		await until("queued", () => !!renderQueue.activeFor(ep1.id), 10_000, 200);
		const jobId = renderQueue.activeFor(ep1.id)!;
		const t0 = Date.now();
		await go("#/", "[data-testid=home-queue]");
		await wait(6000);
		await shot("09-home-rendering");
		const done = await until("render done", () => !renderQueue.activeFor(ep1.id), 20 * 60_000, 1000);
		const job = repos.jobs.get(jobId)!;
		log(`render ${job.status} in ${Math.round((Date.now() - t0) / 1000)} s${job.error ? `: ${job.error}` : ""}`);
		if (!done || job.status !== "done") throw new Error("render failed");
		const video = repos.videos.list().find((v) => v.draftId === ep1.id)!;
		const vdir = dirname(video.filePath);
		const plan = VideoPlan.parse(JSON.parse(readFileSync(join(vdir, "plan.json"), "utf8")));
		const tl = computeTimeline(plan);
		const probe = spawnSync(FFPROBE, ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", video.filePath], { encoding: "utf8" }).stdout.trim();
		const bare = computeTimeline(VideoPlan.parse({ ...plan, meta: { ...plan.meta, brand: undefined } }));
		log(`video row: series=${video.seriesId === ep1.seriesId}, episode=${video.episode}; plan.json brand: channel=${plan.meta.brand?.channel}, logo=${plan.meta.brand?.logo}, series=${JSON.stringify(plan.meta.brand?.series)}`);
		log(`length: mp4 ${Number(probe).toFixed(2)} s; timeline ${(tl.durationInFrames / tl.fps).toFixed(2)} s = scenes ${(bare.durationInFrames / bare.fps).toFixed(2)} s + intro ${tl.intro / tl.fps} s + outro ${tl.outro / tl.fps} s`);
		const yt = readFileSync(join(vdir, "youtube.txt"), "utf8");
		log(`youtube.txt has episode line: ${yt.includes('Episode 1 of the series "How the web works".')}; subscribe line: ${yt.includes("Subscribe to Science with Sam")}; first chapter at 0:00: ${/\n0:00 /.test(yt)}`);
		const frame = (at: number, name: string) => spawnSync(FFMPEG, ["-y", "-v", "error", "-ss", at.toFixed(2), "-i", video.filePath, "-frames:v", "1", join(dir, `${name}.png`)]);
		const fps = tl.fps;
		frame((tl.intro * 0.7) / fps, "10-mp4-intro");
		frame(tl.intro / fps + 4, "11-mp4-watermark");
		frame((tl.durationInFrames - tl.outro) / fps + 3, "12-mp4-outro");
		log(`frames saved from the MP4: ${["10-mp4-intro", "11-mp4-watermark", "12-mp4-outro"].map((n) => `${n} ${existsSync(join(dir, `${n}.png`))}`).join(", ")}`);
		await go("#/", "[data-testid=home-queue]");
		await wait(1500);
		await shot("13-home-dashboard");

		// ---------- Storage ----------
		const junk = join(appFolders().cache, "test-junk");
		mkdirSync(junk, { recursive: true });
		writeFileSync(join(junk, "blob.bin"), Buffer.alloc(3 * 1024 * 1024));
		const leftover = join(appFolders().drafts, randomUUID());
		mkdirSync(join(leftover, "voice"), { recursive: true });
		writeFileSync(join(leftover, "voice", "old.wav"), Buffer.alloc(1024 * 1024));
		await go("#/settings?section=storage", "[data-testid=storage-areas]");
		await until("measured", dom(`!!document.querySelector("[data-testid=clean-cache]")`), 20_000);
		await wait(800);
		log(`storage: ${(await text("[data-testid=clean-cache]")).replace(/\s+/g, " ")} || ${(await text("[data-testid=clean-leftovers]")).replace(/\s+/g, " ")}`);
		await shot("14-storage");
		await clickSel("[data-testid=storage-clean]");
		await until("confirm", dom(`!!document.querySelector("[role=alertdialog]")`), 5000);
		log(`confirm dialog: ${(await text("[role=alertdialog]")).replace(/\s+/g, " ")}`);
		await shot("15-storage-confirm");
		// Cancel first: nothing may be deleted.
		await click("Cancel", "[role=alertdialog]");
		await wait(800);
		log(`after Cancel: junk still there = ${existsSync(join(junk, "blob.bin"))}, leftover still there = ${existsSync(leftover)}`);
		await clickSel("[data-testid=storage-clean]");
		await until("confirm", dom(`!!document.querySelector("[role=alertdialog]")`), 5000);
		await click("Clean up", "[role=alertdialog]");
		await until("freed toast", async () => (await toasts()).includes("Freed"), 20_000);
		log(`toast: ${await toasts()}`);
		log(`after Clean up: junk gone = ${!existsSync(junk)}, leftover gone = ${!existsSync(leftover)}, drafts kept = ${[ep1, ep2].every((d) => existsSync(join(appFolders().drafts, d.id)))}, video kept = ${existsSync(video.filePath)}`);
		await wait(1200);
		await shot("16-storage-cleaned");

		// ---------- Dark theme ----------
		await theme("dark");
		await go("#/series", "[data-testid=series-card]");
		await shot("17-series-dark");
		await go("#/brand", "[data-testid=brand-channel]");
		await wait(1500);
		await shot("18-brand-dark");
		await theme("light");
	} catch (err) {
		log(`FAILED: ${(err as Error).stack ?? err}`);
	}
	log(`console errors: ${errors.length}${errors.length ? ` — ${errors.slice(0, 5).join(" | ")}` : ""}`);
	log("done");
	app.quit();
}
