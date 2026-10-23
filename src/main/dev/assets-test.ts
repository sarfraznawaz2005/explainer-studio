import { app, type BrowserWindow } from "electron";
import { appendFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { SoundSetup } from "@shared/assets";
import { VideoPlan } from "@shared/plan/schema";
import { buildSoundtrack, type Soundtrack } from "@shared/plan/soundtrack";
import { computeTimeline } from "@shared/plan/timing";
import { SAMPLE_PLAN } from "../../../video/src/samples/web-page-journey";
import { appFolders } from "../app/folders";
import { applyTheme } from "../app/theme";
import { assetLibrary, draftSound, hasFreesoundKey, licensesDir } from "../assets";
import { STARTER_FILES } from "../assets/starter-manifest";
import { repos } from "../db/repos";
import { voiceEngine } from "../voice";

/**
 * EXPLAINER_ASSETS_TEST=<folder>: the asset library in the real app.
 *  1. Starter pack: installs (or is already installed) with license data for every file.
 *  2. Library actions: favourite, edit, license dialog, delete with confirm, resume the pack.
 *  3. Preview: a voiced draft plays with music ducked under the voice and a pop on every reveal.
 *  4. Two drafts share the same library files.
 *  5. Freesound search and import, when a key is saved in Settings → Assets.
 * Test drafts are removed at the end; library edits are put back.
 */
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runAssetsTest(win: BrowserWindow, dir: string): Promise<void> {
	mkdirSync(dir, { recursive: true });
	const logPath = join(dir, "log.txt");
	writeFileSync(logPath, "");
	const log = (msg: string) => {
		appendFileSync(logPath, `${new Date().toISOString()} ${msg}\n`);
		console.log(`[assets-test] ${msg}`);
	};
	const js = <T = unknown>(code: string) => win.webContents.executeJavaScript(code, true) as Promise<T>;
	const shot = async (name: string) => {
		win.webContents.invalidate();
		await wait(400);
		writeFileSync(join(dir, `${name}.png`), (await win.webContents.capturePage()).toPNG());
		log(`shot ${name}`);
	};
	const until = async (what: string, code: string, timeoutMs: number, everyMs = 400) => {
		const end = Date.now() + timeoutMs;
		while (Date.now() < end) {
			if (await js<boolean>(code)) return true;
			await wait(everyMs);
		}
		log(`TIMEOUT waiting for ${what}`);
		return false;
	};
	const click = (text: string, scope = "document") =>
		js<boolean>(
			`(() => { const root = ${scope === "document" ? "document" : `document.querySelector(${JSON.stringify(scope)})`}; const b = root && [...root.querySelectorAll("button, a, [role=menuitem], [role=radio]")].find((x) => x.textContent?.trim().includes(${JSON.stringify(text)}) && !x.disabled); b?.click(); return !!b; })()`,
		);
	const clickLabel = (label: string) => js<boolean>(`(() => { const b = document.querySelector(${JSON.stringify(`[aria-label="${label}"]`)}); if (!b || b.disabled) return false; b.click(); return true; })()`);
	/** Radix menus and selects open on key or pointer events, not click(). */
	const openWithKey = (label: string) =>
		js<boolean>(`(() => { const b = document.querySelector(${JSON.stringify(`[aria-label="${label}"]`)}); if (!b) return false; b.focus(); b.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); return true; })()`);
	const type = (selector: string, value: string) =>
		js<boolean>(`(() => {
			const el = document.querySelector(${JSON.stringify(selector)});
			if (!el) return false;
			Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, ${JSON.stringify(value)});
			el.dispatchEvent(new Event("input", { bubbles: true }));
			return true;
		})()`);
	const toasts = () => js<string>(`[...document.querySelectorAll("[data-sonner-toast]")].map((t) => t.textContent).join(" | ")`);
	const errors: string[] = [];
	win.webContents.on("console-message", (e) => {
		if (e.level === "error") errors.push(e.message);
	});
	const drafts: string[] = [];
	let restore: (() => void) | null = null;

	/** 5. Freesound search and import (needs a key saved in the app). */
	const freesoundStep = async () => {
		// Uses the key the user saved in Settings → Assets; the key itself is never read or logged here.
		if (!hasFreesoundKey()) log("freesound: skipped (no key saved in Settings → Assets)");
		else {
			await js(`location.hash = "#/assets"`);
			await wait(800);
			await click("Sound effects");
			await click("Search Freesound");
			await until("freesound dialog", `!!document.querySelector("[aria-label='Search words']")`, 5000);
			await type("[aria-label='Search words']", "pop");
			await click("Search", "[role=dialog] form");
			await until("results", `!!document.querySelector("[role=dialog] li") || !!document.querySelector("[role=dialog] [role=alert]")`, 30_000);
			await wait(500);
			await shot("9-freesound");
			const badges = await js<string[]>(`[...document.querySelectorAll("[role=dialog] li")].map((li) => li.querySelector("span[title]")?.textContent ?? "?")`);
			log(`freesound results: ${badges.length} shown, licenses: ${JSON.stringify(badges)}; footer: ${await js<string>(`document.querySelector("[role=dialog] .tabular-nums")?.parentElement?.parentElement?.textContent ?? ""`)}`);
			const n0 = assetLibrary.list().length;
			await click("Add", "[role=dialog] li");
			await wait(6000);
			const added = assetLibrary.list().filter((a) => a.source === "freesound");
			log(`freesound import: library ${n0} -> ${assetLibrary.list().length}; freesound assets: ${added.map((a) => `${a.title} (${a.license}, by ${a.author})`).join("; ")}; toasts: ${await toasts()}`);
		}
	};

	try {
		await wait(1500);
		applyTheme("light");
		await js(`document.documentElement.classList.remove("dark")`);

		// EXPLAINER_ASSETS_ONLY_FREESOUND=1: only the Freesound step.
		if (process.env.EXPLAINER_ASSETS_ONLY_FREESOUND) {
			await freesoundStep();
			return;
		}
		// 1. Starter pack.
		await js(`location.hash = "#/assets"`);
		await wait(1200);
		const card = () => js<string>(`document.querySelector("[data-testid=starter-card]")?.textContent ?? ""`);
		log(`starter card at open: "${(await card()).slice(0, 160)}"`);
		const t0 = Date.now();
		for (const label of ["Download", "Try again", "Finish download"]) if (await click(label, "[data-testid=starter-card]")) log(`clicked ${label}`);
		await until("install running", `(document.querySelector("[data-testid=starter-card]")?.textContent ?? "").includes("Downloading") || !document.querySelector("[data-testid=starter-card]")`, 15_000, 200);
		await wait(2500);
		await shot("1-starter-downloading");
		const installed = await until("starter installed or failed", `!document.querySelector("[data-testid=starter-card]") || /failed|Finish download|Try again/.test(document.querySelector("[data-testid=starter-card]")?.textContent ?? "")`, 15 * 60_000, 1000);
		if (await card()) throw new Error(`starter pack did not finish: ${await card()}`);
		await wait(800);
		log(`starter: ${installed ? "installed" : "NOT installed"} after ${((Date.now() - t0) / 1000).toFixed(1)} s; toasts: ${await toasts()}`);
		const rows = assetLibrary.list();
		const starterRows = rows.filter((a) => a.source === "starter");
		const missingMeta = starterRows.filter((a) => !a.license || !a.licenseUrl || !a.author || !a.sourceUrl || !a.pack || !a.sha256 || !a.durationMs);
		log(`library: ${rows.length} assets (${starterRows.length} starter: ${starterRows.filter((a) => a.kind === "music").length} music, ${starterRows.filter((a) => a.kind === "sfx").length} sfx; expected ${STARTER_FILES}); rows missing license data: ${missingMeta.length}`);
		log(`licenses: ${[...new Set(starterRows.map((a) => a.license))].join(", ")}; license files: ${existsSync(licensesDir()) ? readdirSync(licensesDir()).join(", ") : "none"}`);
		const libFiles = readdirSync(assetLibrary.dir()).filter((f) => !f.endsWith(".part"));
		log(`library folder: ${libFiles.length} files for ${rows.length} rows`);
		await shot("2-music");
		await click("Sound effects");
		await wait(600);
		await shot("3-sfx");

		// 2. Library actions on a music track.
		await click("Music");
		await wait(500);
		const track = rows.find((a) => a.title === "Mysterious Lights")!;
		const before = { favorite: track.favorite, bpm: track.bpm };
		restore = () => repos.assets.update(track.id, before);
		await clickLabel(`Favourite ${track.title}`);
		await wait(500);
		log(`favourite: db=${assetLibrary.get(track.id)!.favorite}`);
		await clickLabel("Show favourites only");
		await wait(400);
		log(`favourites filter rows: ${await js<number>(`document.querySelectorAll("ul[aria-label=Music] > li").length`)}`);
		await clickLabel("Show favourites only");
		await openWithKey(`More actions for ${track.title}`);
		await wait(400);
		await click("Edit details", "[role=menu]");
		await until("edit dialog", `!!document.querySelector("#ed-bpm")`, 3000);
		await type("#ed-bpm", "96");
		await wait(200);
		await shot("4-edit");
		await click("Save", "[role=dialog]");
		await wait(800);
		log(`edit: db bpm=${assetLibrary.get(track.id)!.bpm}`);
		await clickLabel(`License for ${track.title}`);
		await wait(600);
		await shot("5-license");
		log(`license dialog: ${(await js<string>(`document.querySelector("[role=dialog]")?.textContent ?? ""`)).slice(0, 200)}`);
		await js(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
		await wait(400);

		// Delete a starter effect, then resume the pack to get it back.
		await click("Sound effects");
		await wait(500);
		const bong = assetLibrary.list("sfx").find((a) => a.title === "Bong")!;
		await openWithKey(`More actions for Bong`);
		await wait(400);
		await click("Delete", "[role=menu]");
		await until("confirm", `!!document.querySelector("[role=alertdialog]")`, 3000);
		await shot("6-delete-confirm");
		log(`confirm says: ${await js<string>(`document.querySelector("[role=alertdialog]")?.textContent ?? ""`)}`);
		await click("Delete", "[role=alertdialog]");
		await wait(1000);
		const fileGone = !existsSync(join(assetLibrary.dir(), bong.filePath));
		log(`deleted Bong: row=${!!assetLibrary.get(bong.id)} file gone=${fileGone}; card: "${(await card()).slice(0, 80)}"`);
		await click("Finish download", "[data-testid=starter-card]");
		await until("pack complete again", `!document.querySelector("[data-testid=starter-card]")`, 120_000, 500);
		log(`after resume: ${assetLibrary.list("sfx").filter((a) => a.title === "Bong").length} Bong, ${assetLibrary.list().filter((a) => a.source === "starter").length} starter assets`);

		// 3. Preview with voice, music and effects.
		if (!voiceEngine().isReady()) throw new Error("The voice engine is not installed. Install it in Settings → Voice first.");
		const plan = VideoPlan.parse({ ...SAMPLE_PLAN, meta: { ...VideoPlan.parse(SAMPLE_PLAN).meta, title: "Sound mix test" } });
		const draft = repos.drafts.create({ title: plan.meta.title, level: plan.meta.level, stage: "preview", source: { version: 1 }, plan, voice: { voice: "af_heart", speed: 1, lexicon: [] } });
		drafts.push(draft.id);
		await js(`location.hash = "#/studio?draft=${draft.id}"`);
		await until("studio", `!!document.querySelector("[data-testid=voice-state]") && !!document.querySelector("[data-testid=sound-button]")`, 15_000);
		await click("Make voice");
		await until("voice started", `!!document.querySelector("[data-testid=voice-progress]")`, 10_000, 100);
		await until("voice done", `!document.querySelector("[data-testid=voice-progress]")`, 10 * 60_000, 500);
		await wait(1500);
		const st = await js<Soundtrack>(`window.__esSoundtrack`);
		log(`soundtrack: ${st.music.length} music beds (${st.music.map((m) => m.assetId.slice(0, 8)).join(", ")}), ${st.sfx.length} effects (${st.sfx.filter((s) => s.role === "reveal").length} reveal, ${st.sfx.filter((s) => s.role === "transition").length} transition), ${st.speech.length} speech ranges`);
		await shot("7-studio");

		// Sound dialog: look, then turn chapter 1 music off and back on.
		await js(`document.querySelector("[data-testid=sound-button]")?.click()`);
		await until("sound dialog", `!!document.querySelector("[role=dialog]")`, 3000);
		await wait(500);
		await shot("8-sound-dialog");
		await openWithKey("Music for chapter 1");
		await wait(400);
		await js(`[...document.querySelectorAll("[role=option]")].find((o) => o.textContent?.includes("No music"))?.click()`);
		await wait(1200);
		const off = await js<Soundtrack>(`window.__esSoundtrack`);
		const saved = SoundSetup.parse(repos.drafts.get(draft.id)!.audio ?? {});
		log(`chapter 1 music off: beds ${st.music.length} -> ${off.music.length}; saved picks ${JSON.stringify(saved.music.picks)}`);
		await openWithKey("Music for chapter 1");
		await wait(400);
		await js(`[...document.querySelectorAll("[role=option]")].find((o) => o.textContent?.startsWith("Auto"))?.click()`);
		await wait(1200);
		log(`chapter 1 back to auto: beds ${(await js<Soundtrack>(`window.__esSoundtrack`)).music.length}`);
		await js(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
		await wait(500);

		// Play and listen: music volume against voice, and effect plays against reveal frames.
		await js(`(() => {
			window.__esPlays = [];
			document.addEventListener("play", (e) => { const a = e.target; if (a instanceof HTMLMediaElement) window.__esPlays.push({ src: a.currentSrc || a.src, f: window.__esPlayer.getCurrentFrame() }); }, true);
		})()`);
		const sound = await js<Soundtrack>(`window.__esSoundtrack`);
		await js(`window.__esPlayer.seekTo(0)`);
		await wait(500);
		await js(`window.__esPlayer.play()`);
		const listenMs = Number(process.env.EXPLAINER_ASSETS_LISTEN_MS ?? 45_000);
		const samples: { f: number; music: number | null; voice: boolean }[] = [];
		const tl0 = Date.now();
		while (Date.now() - tl0 < listenMs) {
			const r = await js<{ f: number; auds: { src: string; vol: number }[] }>(
				`(() => ({ f: window.__esPlayer.getCurrentFrame(), auds: [...document.querySelectorAll("audio")].filter((a) => !a.paused && a.currentSrc).map((a) => ({ src: a.currentSrc, vol: a.volume })) }))()`,
			);
			const musicSrc = new Set(sound.music.map((m) => m.src));
			const m = r.auds.find((a) => musicSrc.has(a.src));
			samples.push({ f: r.f, music: m ? m.vol : null, voice: r.auds.some((a) => a.src.includes("/voice/")) });
			await wait(100);
		}
		await js(`window.__esPlayer.pause()`);
		const lastFrame = samples.at(-1)?.f ?? 0;
		const plays = await js<{ src: string; f: number }[]>(`window.__esPlays`);
		// Ducking: compare music volume while voice plays against silent stretches (fades excluded).
		const bedAt = (f: number) => sound.music.find((m) => f >= m.from + m.fadeFrames && f < m.from + m.durationInFrames - m.fadeFrames);
		const inSpeech = (f: number) => sound.speech.some(([a, b]) => f >= a + 3 && f < b - 3);
		const farFromSpeech = (f: number) => sound.speech.every(([a, b]) => f < a - sound.duckRampFrames - 3 || f > b + sound.duckRampFrames + 3);
		const talk = samples.filter((s) => s.music !== null && bedAt(s.f) && inSpeech(s.f) && s.voice).map((s) => s.music! / bedAt(s.f)!.volume);
		const quiet = samples.filter((s) => s.music !== null && bedAt(s.f) && farFromSpeech(s.f)).map((s) => s.music! / bedAt(s.f)!.volume);
		const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
		const noMusic = samples.filter((s) => bedAt(s.f) && s.music === null).length;
		log(`listen: ${samples.length} samples over frames 0-${lastFrame}; music level while voice speaks ${avg(talk).toFixed(3)} of full (n=${talk.length}, min ${Math.min(...talk).toFixed(3)}, max ${Math.max(...talk).toFixed(3)}), in pauses ${avg(quiet).toFixed(3)} (n=${quiet.length}); samples inside a bed with no music playing: ${noMusic}`);
		// Effects: each expected hit in the played range should have a play event within a few frames.
		const expected = sound.sfx.filter((s) => s.frame > 5 && s.frame < lastFrame - 10);
		let heard = 0;
		const misses: number[] = [];
		const offsets: number[] = [];
		for (const h of expected) {
			const p = plays.find((x) => x.src === h.src && Math.abs(x.f - h.frame) <= 6);
			if (p) {
				heard++;
				offsets.push(p.f - h.frame);
			} else misses.push(h.frame);
		}
		log(`effects: ${heard}/${expected.length} expected hits heard in frames 0-${lastFrame} (${expected.filter((s) => s.role === "reveal").length} reveals, ${expected.filter((s) => s.role === "transition").length} transitions); frame offsets ${JSON.stringify(offsets)}; missed at ${JSON.stringify(misses)}`);
		writeFileSync(join(dir, "listen.json"), JSON.stringify({ samples, plays, soundtrack: sound }, null, 1));

		// 4. Shared library: a second draft mixes from the same files.
		const draft2 = repos.drafts.create({ title: "Sound mix test 2", level: plan.meta.level, stage: "preview", source: { version: 1 }, plan });
		drafts.push(draft2.id);
		const mix = (id: string) => {
			const ds = draftSound(id);
			const p = VideoPlan.parse(repos.drafts.get(id)!.plan);
			return buildSoundtrack(p, computeTimeline(p), ds.setup, ds.library, { seed: ds.seed, roleDefaults: ds.roleDefaults });
		};
		const a1 = mix(draft.id);
		const a2 = mix(draft2.id);
		const srcs = new Set([...a1.music, ...a1.sfx, ...a2.music, ...a2.sfx].map((x) => x.src));
		const draftFiles = drafts.flatMap((id) => (existsSync(join(appFolders().drafts, id)) ? readdirSync(join(appFolders().drafts, id), { recursive: true }).map(String) : []));
		const copies = draftFiles.filter((f) => /\.(mp3|ogg|flac)$/i.test(f));
		log(`shared: draft 1 uses ${new Set([...a1.music, ...a1.sfx].map((x) => x.assetId)).size} assets, draft 2 uses ${new Set([...a2.music, ...a2.sfx].map((x) => x.assetId)).size}; ${srcs.size} distinct library URLs, all under es-media://asset/: ${[...srcs].every((s) => s.startsWith("es-media://asset/"))}; library files ${readdirSync(assetLibrary.dir()).length} for ${assetLibrary.list().length} rows; music/sfx copies inside draft folders: ${copies.length}`);

		await freesoundStep();

		// Dark look.
		applyTheme("dark");
		await js(`document.documentElement.classList.add("dark")`);
		await js(`location.hash = "#/assets"`);
		await wait(900);
		await shot("10-dark-assets");
		await js(`location.hash = "#/studio?draft=${draft.id}"`);
		await until("studio", `!!document.querySelector("[data-testid=sound-button]")`, 15_000);
		await js(`document.querySelector("[data-testid=sound-button]")?.click()`);
		await wait(700);
		await shot("11-dark-sound");
		await js(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
		log(`console errors: ${errors.length}${errors.length ? ` — ${errors.slice(0, 5).join(" || ")}` : ""}`);
	} catch (err) {
		log(`FAILED: ${(err as Error)?.stack ?? String(err)}`);
		await shot("failed").catch(() => undefined);
	} finally {
		restore?.();
		for (const id of drafts) {
			repos.drafts.remove(id);
			await rm(join(appFolders().drafts, id), { recursive: true, force: true });
			log(`removed test draft ${id}`);
		}
		applyTheme("system");
		log("done");
		app.quit();
	}
}
