import { app, clipboard, type BrowserWindow } from "electron";
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { SoundSetup } from "@shared/assets";
import type { RenderJobView } from "@shared/ipc/render";
import { VideoPlan } from "@shared/plan/schema";
import { computeTimeline } from "@shared/plan/timing";
import { RenderSettings, stamp, youtubeChapters } from "@shared/render";
import { aiStore } from "../ai";
import { appFolders } from "../app/folders";
import { applyTheme } from "../app/theme";
import { assetLibrary, saveDraftSound } from "../assets";
import { repos } from "../db/repos";
import { renderQueue } from "../render";
import type { RenderPayload } from "../render/queue";
import { chapterFiles, workDir } from "../render/queue";
import { voiceEngine } from "../voice";

/**
 * EXPLAINER_VIDEO_TEST=<folder>: a PDF becomes a finished video in the real app. Two app starts:
 *  Start 1: PDF pages 81-85 → outline and script (Claude CLI login) → voice (Kokoro) → Render
 *           dialog → render at the default 1080p30. While chapter 2+ renders, the app is killed
 *           (taskkill /F /T, no clean quit). state.json keeps what was done.
 *  Start 2: the job resumes at the cut-short chapter (finished chapter files untouched), then
 *           every output file is checked (ffprobe, chapter frames, captions, YouTube text);
 *           Videos and Drafts actions are driven in the UI; short copies render at 720p30,
 *           1440p60 and 4K30 (one with a CC BY sound, so its description must carry the credit).
 * Kept for the user: the PDF draft and its 1080p video. Test copies are deleted (in the UI).
 */
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const PDF = resolve(app.getAppPath(), "..", "Computer Science XI.pdf");
const FFPROBE = join(app.getAppPath(), "node_modules", "@remotion", "compositor-win32-x64-msvc", "ffprobe.exe");
const FFMPEG = join(app.getAppPath(), "node_modules", "@remotion", "compositor-win32-x64-msvc", "ffmpeg.exe");

type State = { draftId: string; jobId: string; videoId: string; doneBefore: number[]; mtimes: Record<number, number>; killedAt: string; cutChapter: number };

export async function runVideoTest(win: BrowserWindow, dir: string): Promise<void> {
	mkdirSync(dir, { recursive: true });
	const statePath = join(dir, "state.json");
	const phase = existsSync(statePath) ? "b" : "a";
	const logPath = join(dir, "log.txt");
	if (phase === "a") writeFileSync(logPath, "");
	const log = (msg: string) => {
		appendFileSync(logPath, `${new Date().toISOString()} [${phase}] ${msg}\n`);
		console.log(`[video-test] ${msg}`);
	};
	const js = <T = unknown>(code: string) => win.webContents.executeJavaScript(code, true) as Promise<T>;
	const shot = async (name: string) => {
		win.webContents.invalidate();
		await wait(500);
		writeFileSync(join(dir, `${name}.png`), (await win.webContents.capturePage()).toPNG());
		log(`shot ${name}`);
	};
	const until = async (what: string, test: () => Promise<boolean> | boolean, timeoutMs: number, everyMs = 500) => {
		const end = Date.now() + timeoutMs;
		while (Date.now() < end) {
			if (await test()) return true;
			await wait(everyMs);
		}
		log(`TIMEOUT waiting for ${what}`);
		return false;
	};
	const dom = (code: string) => () => js<boolean>(code);
	const click = (text: string, scope = "document") =>
		js<boolean>(
			`(() => { const root = ${scope === "document" ? "document" : `document.querySelector(${JSON.stringify(scope)})`}; const b = root && [...root.querySelectorAll("button, a, [role=menuitem], [role=radio], [role=option]")].find((x) => x.textContent?.trim().includes(${JSON.stringify(text)}) && !x.disabled); b?.click(); return !!b; })()`,
		);
	const clickSel = (sel: string) => js<boolean>(`(() => { const b = document.querySelector(${JSON.stringify(sel)}); if (!b || b.disabled) return false; b.click(); return true; })()`);
	/** Radix menus open on pointer or key events, not click(). */
	const openMenu = async (label: string) => {
		await js(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
		await wait(250);
		const sel = JSON.stringify(`[aria-label="${label}"]`);
		const found = await js<boolean>(`(() => { const b = document.querySelector(${sel}); if (!b) return false; b.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" })); return true; })()`);
		const open = found && (await until(`menu for ${label}`, dom(`document.querySelector(${sel})?.getAttribute("aria-expanded") === "true"`), 3000, 100));
		if (!open) log(`ERROR: could not open the menu "${label}" (found=${found})`);
		return open;
	};
	/** Confirms a destructive dialog only when it names the expected item; otherwise cancels. */
	const confirmIf = async (mustName: string, button: string) => {
		await until("confirm dialog", dom(`!!document.querySelector("[role=alertdialog]")`), 3000, 100);
		const t = await text("[role=alertdialog]");
		if (!t.includes(mustName)) {
			log(`ERROR: confirm names the wrong item, cancelled: ${t}`);
			await click("Cancel", "[role=alertdialog]");
			return false;
		}
		return click(button, "[role=alertdialog]");
	};
	const menuItem = async (text: string) => {
		// A closing menu stays in the page during its exit animation: use only the open one.
		await until(`menu ${text}`, dom(`!!document.querySelector("[role=menu][data-state=open] [role=menuitem]")`), 3000, 100);
		return click(text, "[role=menu][data-state=open]");
	};
	const toasts = () => js<string>(`[...document.querySelectorAll("[data-sonner-toast]")].map((t) => t.textContent).join(" | ")`);
	const text = (sel: string) => js<string>(`document.querySelector(${JSON.stringify(sel)})?.textContent ?? ""`);
	const theme = async (t: "light" | "dark") => {
		applyTheme(t);
		await js(`document.documentElement.classList.toggle("dark", ${t === "dark"})`);
		// The theme event from main arrives a moment later and repaints; wait for it before a screenshot.
		await wait(1200);
	};
	const errors: string[] = [];
	win.webContents.on("console-message", (e) => {
		if (e.level === "error") errors.push(e.message);
	});
	const job = (id: string) => repos.jobs.get(id)!;
	const payload = (id: string) => job(id).payload as RenderPayload;
	const probe = (file: string) => {
		const r = spawnSync(FFPROBE, ["-v", "error", "-show_streams", "-show_format", "-of", "json", file], { encoding: "utf8" });
		return JSON.parse(r.stdout || "{}") as { streams?: { codec_type: string; codec_name: string; width?: number; height?: number; r_frame_rate?: string; sample_rate?: string; duration?: string }[]; format?: { duration: string; size: string } };
	};
	const summary = (file: string) => {
		const p = probe(file);
		const v = p.streams?.find((s) => s.codec_type === "video");
		const a = p.streams?.find((s) => s.codec_type === "audio");
		return { width: v?.width, height: v?.height, fps: v?.r_frame_rate, video: v?.codec_name, audio: a ? `${a.codec_name} ${a.sample_rate} Hz` : "none", seconds: Number(p.format?.duration ?? 0), bytes: Number(p.format?.size ?? 0) };
	};

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

	/* ---------- Start 1 ---------- */

	async function phaseA() {
		if (!voiceEngine().isReady()) throw new Error("The voice engine is not installed. Install it in Settings → Voice first.");
		const before = new Set(repos.drafts.list().map((d) => d.id));
		const model = process.env.EXPLAINER_PLANNER_MODEL ?? "claude-sonnet-5-5";
		const slotsBefore = aiStore.getSlots();
		const claude = await aiStore.save({ kind: "claude-subscription", name: "Claude (video test)", baseUrl: null, defaultModel: model });
		for (const slot of ["planner", "vision", "cheap"] as const) aiStore.setSlot(slot, { providerId: claude.id, modelId: model });
		log(`AI: Claude subscription / ${model}; render defaults: ${JSON.stringify(RenderSettings.parse(repos.settings.get("render.defaults") ?? {}))}`);
		let draftId: string;
		try {
			// PDF → draft.
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
			await until("reading done", dom(`document.body.textContent.includes("Saved as draft")`), 15 * 60_000, 1000);
			const draft = repos.drafts.list().find((d) => !before.has(d.id));
			if (!draft) throw new Error("no draft was made from the PDF");
			draftId = draft.id;
			log(`PDF read in ${Math.round((Date.now() - t0) / 1000)} s → draft ${draftId}`);

			// Outline and script (IPC, as the wizard does).
			const settings = { level: "High school", targetMinutes: 3, tone: "Friendly" };
			const t1 = Date.now();
			await js(`window.studio.invoke("planner:outline", { draftId: ${JSON.stringify(draftId)}, settings: ${JSON.stringify(settings)}, confirmedCost: false })`);
			await until("outline", () => !!repos.drafts.get(draftId)?.outline, 15 * 60_000, 2000);
			const outline = repos.drafts.get(draftId)!.outline as { title: string; chapters: { title: string }[] };
			log(`outline in ${Math.round((Date.now() - t1) / 1000)} s: "${outline.title}" — ${outline.chapters.map((c) => c.title).join(" | ")}`);
			await js(`window.studio.invoke("planner:outline:save", { draftId: ${JSON.stringify(draftId)}, outline: ${JSON.stringify({ ...outline, approved: true })} })`);
			const t2 = Date.now();
			await js(`window.studio.invoke("planner:script", { draftId: ${JSON.stringify(draftId)}, settings: ${JSON.stringify(settings)}, confirmedCost: false })`);
			const ok = await until("script", () => !!repos.drafts.get(draftId)?.plan, 40 * 60_000, 3000);
			if (!ok) throw new Error("the script was not written");
			const plan = VideoPlan.parse(repos.drafts.get(draftId)!.plan);
			const tl = computeTimeline(plan);
			log(`script in ${Math.round((Date.now() - t2) / 1000)} s: ${plan.chapters.length} chapters, ${tl.scenes.length} scenes, est. ${(tl.durationInFrames / 30).toFixed(0)} s`);
		} finally {
			aiStore.remove(claude.id);
			for (const [slot, v] of Object.entries(slotsBefore)) aiStore.setSlot(slot as "planner", v as never);
			log("test provider removed, slots restored");
		}

		// Voice in the Studio.
		await js(`location.hash = "#/studio?draft=${draftId}"`);
		await until("studio", dom(`!!document.querySelector("[data-testid=voice-state]") && !!document.querySelector("[data-testid=render-button]")`), 20_000);
		await click("Make voice");
		await until("voice started", dom(`!!document.querySelector("[data-testid=voice-progress]")`), 90_000, 300);
		const tv = Date.now();
		await until("voice done", dom(`!document.querySelector("[data-testid=voice-progress]")`), 30 * 60_000, 1000);
		log(`voice in ${Math.round((Date.now() - tv) / 1000)} s: ${await text("[data-testid=voice-state]")}`);
		await wait(1500);
		await shot("a1-studio-voiced");

		// Render dialog at the defaults.
		await clickSel("[data-testid=render-button]");
		await until("render dialog", dom(`!!document.querySelector("[data-testid=render-start]") && !document.body.textContent.includes("Checking the draft")`), 20_000);
		await wait(600);
		log(`render dialog: ${(await text("[role=dialog]")).replace(/\s+/g, " ").slice(0, 600)}`);
		await shot("a2-render-dialog-light");
		await theme("dark");
		await shot("a3-render-dialog-dark");
		await theme("light");
		await clickSel("[data-testid=render-start]");
		await until("queued", () => !!renderQueue.activeFor(draftId), 10_000, 200);
		const jobId = renderQueue.activeFor(draftId)!;
		log(`toast: ${await toasts()}`);
		await js(`location.hash = "#/queue"`);
		const p0 = payload(jobId);
		log(`job ${jobId}: ${p0.width}x${p0.height} ${p0.fps} fps, ${p0.chapters.length} chapters (${p0.chapters.map((c) => c.frames).join("/")} frames), ${p0.settings.quality}`);
		if (p0.chapters.length < 3) log("NOTE: fewer than 3 chapters; the kill happens in the last chapter");

		// Kill the app while chapter 2 (or later) renders.
		const target = Math.min(2, p0.chapters.length - 1);
		await until(
			"chapter 2 rendering",
			() => {
				const p = payload(jobId);
				return p.chapters.slice(0, target).every((c) => c.done) && !p.chapters[target]!.done && p.step === "chapters";
			},
			60 * 60_000,
			500,
		);
		await wait(8000);
		await shot("a4-queue-light");
		await theme("dark");
		await shot("a5-queue-dark");
		const p = payload(jobId);
		const work = workDir(appFolders().videos, p.videoId);
		const doneBefore = p.chapters.map((c, i) => (c.done ? i : -1)).filter((i) => i >= 0);
		const mtimes = Object.fromEntries(doneBefore.map((i) => [i, statSync(chapterFiles(work, i).video).mtimeMs]));
		const state: State = { draftId, jobId, videoId: p.videoId, doneBefore, mtimes, killedAt: new Date().toISOString(), cutChapter: doneBefore.length };
		writeFileSync(statePath, JSON.stringify(state, null, 2));
		log(`KILL: chapters done ${JSON.stringify(doneBefore)}, cutting chapter ${state.cutChapter + 1}; db status=${job(jobId).status}; files in .work: ${readdirSync(work).join(", ")}`);
		await wait(300);
		// taskkill /F /T: the whole process tree ends at once, like a crash or Task Manager → End task.
		spawn("taskkill", ["/F", "/T", "/PID", String(process.pid)], { detached: true, stdio: "ignore", windowsHide: true }).unref();
		await wait(60_000);
	}

	/* ---------- Start 2 ---------- */

	async function phaseB() {
		const st = JSON.parse(readFileSync(statePath, "utf8")) as State;
		// Test videos left by an earlier run of this test (their drafts are gone).
		for (const v of repos.videos.list()) if (v.title.startsWith("Render test ") && !v.draftId) await js(`window.studio.invoke("library:video:remove", { videoId: ${JSON.stringify(v.id)} })`);
		if (job(st.jobId).status !== "done") await resumeCheck(st);
		else log(`resume already checked in an earlier run (job ${st.jobId} is done)`);
		await outputsAndUi(st);
	}

	async function resumeCheck(st: State) {
		log(`restart: db status of the killed job = ${job(st.jobId).status}, step = ${payload(st.jobId).step}`);
		// The queue resumes 3 s after start; watch which chapter renders first.
		let firstChapter = -1;
		const seen: string[] = [];
		const watch = (v: RenderJobView) => {
			const r = v.chapters.findIndex((c) => c.state === "rendering");
			if (r >= 0 && firstChapter < 0) firstChapter = r;
			const k = `${v.status}/${v.step}`;
			if (seen.at(-1) !== k) seen.push(k);
		};
		const tick = setInterval(() => {
			const j = repos.jobs.get(st.jobId);
			if (j) watch(renderQueue.view(j));
		}, 150);
		await js(`location.hash = "#/queue"`);
		await until("resumed", () => job(st.jobId).status === "running", 30_000, 200);
		await wait(4000);
		await shot("b1-queue-resumed");
		log(`queue text: ${(await text("[data-testid=active-job]")).replace(/\s+/g, " ").slice(0, 300)}`);
		const okDone = await until("render done", () => job(st.jobId).status !== "running" && job(st.jobId).status !== "queued", 90 * 60_000, 1000);
		clearInterval(tick);
		const j = job(st.jobId);
		const p = payload(st.jobId);
		log(`job ended: ${j.status}${j.error ? ` (${j.error})` : ""}; resumes=${p.resumes}; steps seen: ${seen.join(" → ")}`);
		log(`RESUME: first chapter rendered after restart = ${firstChapter + 1} (cut chapter was ${st.cutChapter + 1}); chapters done before kill: ${JSON.stringify(st.doneBefore.map((i) => i + 1))}`);
		if (!okDone || j.status !== "done") throw new Error("the resumed render did not finish");
		await wait(1500);
		await shot("b2-queue-done");
	}

	async function outputsAndUi(st: State) {
		// Output files.
		const video = repos.videos.get(st.videoId)!;
		const vdir = dirname(video.filePath);
		const files = readdirSync(vdir);
		log(`OUTPUT ${vdir}: ${files.map((f) => `${f} (${statSync(join(vdir, f)).size} B)`).join(", ")}`);
		const plan = VideoPlan.parse(JSON.parse(readFileSync(join(vdir, "plan.json"), "utf8")));
		const tl = computeTimeline(plan);
		const s = summary(video.filePath);
		log(`ffprobe video.mp4: ${JSON.stringify(s)}; timeline ${(tl.durationInFrames / tl.fps).toFixed(3)} s`);
		const yt = readFileSync(join(vdir, "youtube.txt"), "utf8");
		const chapters = youtubeChapters(tl);
		const missing = (chapters ?? []).filter((c) => !yt.includes(`${stamp(c.ms)} ${c.title}`));
		log(`youtube.txt chapters expected ${chapters?.length ?? 0}, missing ${missing.length}:\n${yt}`);
		// A frame from the real file at each chapter time (proves the stamps match the picture).
		for (const [i, c] of (chapters ?? []).entries()) {
			const at = c.ms / 1000 + 1.2;
			spawnSync(FFMPEG, ["-y", "-v", "error", "-ss", String(at), "-i", video.filePath, "-frames:v", "1", "-vf", "scale=640:-2", join(dir, `b-chapter-${i + 1}-at-${stamp(c.ms).replace(":", "m")}.png`)]);
		}
		const srt = readFileSync(join(vdir, "captions.srt"), "utf8");
		const cues = srt.trim().split(/\n\n/);
		const sentences = tl.scenes.reduce((n, t) => n + t.sentences.length, 0);
		log(`captions.srt: ${cues.length} cues for ${sentences} sentences; first: ${cues[0]?.replace(/\n/g, " / ")}; last: ${cues.at(-1)?.replace(/\n/g, " / ")}`);
		const thumbs = ["thumbnail.png", "thumbnail-b.png", "thumbnail-c.png"].map((f) => `${f} ${JSON.stringify(summary(join(vdir, f)))}`);
		log(`thumbnails: ${thumbs.join(" | ")}`);
		// Was any chapter finished before the kill rendered again? (same file time = no)
		log(`work folder removed: ${!existsSync(join(vdir, ".work"))}; mtimes before kill: ${JSON.stringify(st.mtimes)}`);

		// Short copies at other settings, one with a CC BY sound.
		const ccby = assetLibrary.list("sfx").find((a) => a.license.startsWith("CC-BY"));
		const short = (title: string) => {
			const d = repos.drafts.get(st.draftId)!;
			const full = VideoPlan.parse(d.plan);
			const sp = { ...full, meta: { ...full.meta, title }, chapters: full.chapters.slice(0, 1).map((c) => ({ ...c, scenes: c.scenes.slice(0, 3) })) };
			const copy = repos.drafts.create({ title, level: d.level, stage: "preview", source: d.source, plan: sp, settings: d.settings, outline: d.outline, voice: d.voice, audio: d.audio, seriesId: null, brandKitId: null });
			const from = join(appFolders().drafts, st.draftId, "voice");
			mkdirSync(join(appFolders().drafts, copy.id, "voice"), { recursive: true });
			for (const f of readdirSync(from)) writeFileSync(join(appFolders().drafts, copy.id, "voice", f), readFileSync(join(from, f)));
			return copy.id;
		};
		const variants: { title: string; settings: RenderSettings; ccby?: boolean }[] = [
			{ title: "Render test 720p30", settings: { resolution: "720p", fps: 30, quality: "draft", brand: false }, ccby: true },
			{ title: "Render test 1440p60", settings: { resolution: "1440p", fps: 60, quality: "draft", brand: false } },
			{ title: "Render test 4K30", settings: { resolution: "2160p", fps: 30, quality: "draft", brand: false } },
		];
		const made: { id: string; jobId: string; v: (typeof variants)[number] }[] = [];
		for (const v of variants) {
			const id = short(v.title);
			if (v.ccby && ccby) saveDraftSound(id, SoundSetup.parse({ sfx: { roles: { transition: ccby.id } } }));
			const r = await js<{ jobId: string }>(`window.studio.invoke("render:queue", { draftId: ${JSON.stringify(id)}, settings: ${JSON.stringify(v.settings)} })`);
			made.push({ id, jobId: r.jobId, v });
		}
		log(`queued ${made.length} short renders${ccby ? ` (CC BY sound "${ccby.title}" on the 720p one)` : " (no CC BY sound in the library)"}`);
		await wait(3000);
		await shot("b3-queue-three");
		await until("short renders", () => made.every((m) => ["done", "error", "cancelled"].includes(job(m.jobId).status)), 120 * 60_000, 2000);
		for (const m of made) {
			const jj = job(m.jobId);
			const pp = jj.payload as RenderPayload;
			if (jj.status !== "done") {
				log(`${m.v.title}: ${jj.status} ${jj.error ?? ""}`);
				continue;
			}
			const vv = repos.videos.get(pp.videoId)!;
			const ytx = readFileSync(join(dirname(vv.filePath), "youtube.txt"), "utf8");
			log(`${m.v.title}: ${JSON.stringify(summary(vv.filePath))}; credits in description: ${ytx.includes("Credits") ? ytx.split("Credits\n")[1]!.split("\n")[0] : "none"}`);
		}

		// Videos screen.
		await theme("light");
		await js(`location.hash = "#/library"`);
		await until("videos", dom(`document.querySelectorAll("[data-testid=video-card]").length >= 4`), 15_000);
		await wait(1500);
		await shot("b4-videos-grid-light");
		await theme("dark");
		await shot("b5-videos-grid-dark");
		await theme("light");
		await click("List", "[aria-label=View]");
		await wait(800);
		await shot("b6-videos-list");
		await js(`(() => { const el = document.querySelector("[aria-label='Search videos']"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, "4K"); el.dispatchEvent(new Event("input", { bubbles: true })); })()`);
		await wait(500);
		log(`search "4K": ${await js<number>(`document.querySelectorAll("[data-testid=video-row]").length`)} row(s)`);
		await js(`(() => { const el = document.querySelector("[aria-label='Search videos']"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, ""); el.dispatchEvent(new Event("input", { bubbles: true })); })()`);
		await click("Grid", "[aria-label=View]");
		await wait(500);

		// Play the main video.
		const mainTitle = video.title;
		await js(`[...document.querySelectorAll("[data-testid=video-card]")].find((c) => c.textContent.includes(${JSON.stringify(mainTitle)}))?.querySelector("button[aria-label^='Play']")?.click()`);
		await until("player", dom(`!!document.querySelector("[data-testid=video-player]")`), 5000);
		await wait(4000);
		const played = await js<{ t: number; ready: number; w: number; err: string | null }>(`(() => { const v = document.querySelector("[data-testid=video-player]"); return { t: v.currentTime, ready: v.readyState, w: v.videoWidth, err: v.error?.message ?? null }; })()`);
		log(`player: ${JSON.stringify(played)}`);
		await js(`document.querySelector("[data-testid=video-player]")?.pause()`);
		await shot("b7-player-dialog");
		// Copy pack from the player.
		clipboard.writeText("");
		await click("Copy pack", "[role=dialog]");
		await until("clipboard", () => clipboard.readText().length > 0, 5000, 100);
		const clip = clipboard.readText();
		log(`copy pack: clipboard ${clip.length} chars, has chapters=${clip.includes("Chapters")}, starts "${clip.slice(0, 40).replace(/\n/g, " / ")}"`);
		await js(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
		await wait(500);

		const menuFor = (title: string) => openMenu(`Actions for ${title}`);
		// Render again: the dialog opens for the draft.
		await menuFor(mainTitle);
		await menuItem("Render again");
		await until("re-render dialog", dom(`!!document.querySelector("[data-testid=render-start]") && !document.body.textContent.includes("Checking the draft")`), 15_000);
		log(`render again dialog: ${(await text("[role=dialog]")).replace(/\s+/g, " ").slice(0, 160)}`);
		await click("Cancel", "[role=dialog]");
		await wait(500);
		// Duplicate as draft.
		const draftsBefore = repos.drafts.count();
		await menuFor(mainTitle);
		await menuItem("Duplicate as draft");
		await until("duplicated", () => repos.drafts.count() === draftsBefore + 1, 10_000, 200);
		await until("duplicate toast", async () => (await toasts()).includes("New draft made"), 10_000, 200);
		const dup = repos.drafts.list({ orderBy: "createdAt" })[0]!;
		log(`duplicate as draft: ${dup.title} (${dup.id}); voice clips copied: ${existsSync(join(appFolders().drafts, dup.id, "voice")) ? readdirSync(join(appFolders().drafts, dup.id, "voice")).length : 0}; toast: ${await toasts()}`);
		// Show in folder (opens Explorer).
		await menuFor(mainTitle);
		await menuItem("Show in folder");
		await wait(800);
		// Delete a test video: confirm, Cancel first, then Delete.
		const victim = made[0]!;
		const victimVideo = (job(victim.jobId).payload as RenderPayload).videoId;
		if (!(await menuFor(victim.v.title))) throw new Error("menu did not open");
		await menuItem("Delete");
		await until("delete confirm", dom(`!!document.querySelector("[role=alertdialog]")`), 3000, 100);
		log(`delete confirm: ${await text("[role=alertdialog]")}`);
		await shot("b8-delete-video-confirm");
		await click("Cancel", "[role=alertdialog]");
		await wait(500);
		log(`after Cancel: video row=${!!repos.videos.get(victimVideo)}, folder=${existsSync(join(appFolders().videos, victimVideo))}`);
		if (!(await menuFor(victim.v.title))) throw new Error("menu did not open");
		await menuItem("Delete");
		await confirmIf(victim.v.title, "Delete video");
		await until("deleted", () => !repos.videos.get(victimVideo) && !existsSync(join(appFolders().videos, victimVideo)), 5000, 100);
		log(`after Delete: video row=${!!repos.videos.get(victimVideo)}, folder=${existsSync(join(appFolders().videos, victimVideo))}`);

		// Drafts screen.
		await js(`location.hash = "#/drafts"`);
		await until("drafts", dom(`document.querySelectorAll("[data-testid=draft-row]").length >= 2`), 10_000);
		await wait(800);
		log(`draft badges: ${await js<string>(`[...document.querySelectorAll("[data-testid=draft-row]")].map((r) => r.querySelector("span.truncate")?.textContent + " = " + r.querySelector("[data-testid=draft-badge]")?.textContent).join(" | ")`)}`);
		await shot("b9-drafts-light");
		await theme("dark");
		await shot("b10-drafts-dark");
		await theme("light");
		// Duplicate, then delete the duplicate (Cancel first).
		const n0 = repos.drafts.count();
		await openMenu(`Actions for ${dup.title}`);
		await menuItem("Duplicate");
		await until("draft duplicated", () => repos.drafts.count() === n0 + 1, 10_000, 200);
		const dup2 = repos.drafts.list({ orderBy: "createdAt" })[0]!;
		log(`drafts duplicate: "${dup2.title}"`);
		await wait(800);
		for (const d of [dup2, dup]) {
			await openMenu(`Actions for ${d.title}`);
			await menuItem("Delete");
			await until("draft delete confirm", dom(`!!document.querySelector("[role=alertdialog]")`), 3000, 100);
			if (d === dup2) {
				log(`draft delete confirm: ${await text("[role=alertdialog]")}`);
				await shot("b11-delete-draft-confirm");
				await click("Cancel", "[role=alertdialog]");
				await wait(400);
				log(`after Cancel: draft exists=${!!repos.drafts.get(d.id)}`);
				await openMenu(`Actions for ${d.title}`);
				await menuItem("Delete");
				await until("draft delete confirm 2", dom(`!!document.querySelector("[role=alertdialog]")`), 3000, 100);
			}
			await confirmIf(d.title, "Delete draft");
			await until("draft deleted", () => !repos.drafts.get(d.id) && !existsSync(join(appFolders().drafts, d.id)), 5000, 100);
			log(`deleted draft "${d.title}": row=${!!repos.drafts.get(d.id)}, folder=${existsSync(join(appFolders().drafts, d.id))}`);
			await wait(500);
		}
		// Resume: Open goes to the Studio for a voiced draft.
		await js(`[...document.querySelectorAll("[data-testid=draft-row]")].find((r) => r.textContent.includes(${JSON.stringify(mainTitle)}))?.querySelector("button.text-left")?.click()`);
		await until("studio opened", dom(`location.hash.includes("/studio?draft=")`), 5000, 100);
		log(`resume opens: ${await js<string>("location.hash")}`);
		await wait(1500);

		// Home shows real numbers.
		await js(`location.hash = "#/"`);
		await wait(1200);
		await shot("b12-home");

		// Clean up the remaining test copies (drafts and their videos), keep the PDF draft and its video.
		for (const m of made.slice(1)) {
			const vid = (job(m.jobId).payload as RenderPayload).videoId;
			await js(`window.studio.invoke("library:video:remove", { videoId: ${JSON.stringify(vid)} })`).catch(() => undefined);
		}
		for (const m of made) await js(`window.studio.invoke("library:draft:remove", { draftId: ${JSON.stringify(m.id)} })`).catch(() => undefined);
		for (const m of made) await js(`window.studio.invoke("render:job:clear", { jobId: ${JSON.stringify(m.jobId)} })`).catch(() => undefined);
		log(`kept: draft ${st.draftId} and video ${st.videoId} (${video.filePath}); test copies removed: ${made.every((m) => !repos.drafts.get(m.id))}`);
	}
}
