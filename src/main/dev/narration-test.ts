import { app, type BrowserWindow } from "electron";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { VideoPlan, type VideoPlanInput } from "@shared/plan/schema";
import { computeTimeline } from "@shared/plan/timing";
import { SAMPLE_PLAN } from "../../../video/src/samples/web-page-journey";
import { appFolders } from "../app/folders";
import { applyTheme } from "../app/theme";
import { repos } from "../db/repos";
import { voiceEngine } from "../voice";
import { plannedClips, wavDurationMs } from "../voice/narration";
import { voiceDir, voiceSetupOf } from "../voice/narration-jobs";

/**
 * EXPLAINER_NARRATION_TEST=<folder>: per-sentence voice in the real app.
 *  1. A draft with a plan of 3+ minutes (the sample, repeated). "Make voice" voices it with Kokoro.
 *  2. Plays the whole preview and samples the Player clock against the playing clip: drift per sample.
 *  3. Edits one sentence in the inspector: only that sentence is voiced again (cache hits for the rest).
 *  4. Adds a pronunciation rule (DNS → domain name system): only sentences with DNS are voiced again, and they sound different.
 * Only the draft it created (and its voice folder) is removed.
 */
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function longPlan(minSeconds: number): VideoPlan {
  const base = VideoPlan.parse(SAMPLE_PLAN);
  const chapters = [...base.chapters];
  for (
    let k = 2;
    computeTimeline({ ...base, chapters }).durationInFrames / base.meta.fps <
    minSeconds;
    k++
  ) {
    for (const ch of base.chapters)
      chapters.push({
        ...ch,
        id: `${ch.id}-${k}`,
        title: `${ch.title} (part ${k})`,
        scenes: ch.scenes.map((s) => ({
          ...s,
          id: `${s.id}-${k}`,
          narration: s.narration.map((n) => ({ ...n, id: `${n.id}-${k}` })),
        })),
      });
  }
  return VideoPlan.parse({
    ...base,
    meta: { ...base.meta, title: "Voice sync test" },
    chapters,
  } satisfies VideoPlanInput);
}

export async function runNarrationTest(
  win: BrowserWindow,
  dir: string,
): Promise<void> {
  mkdirSync(dir, { recursive: true });
  const logPath = join(dir, "log.txt");
  writeFileSync(logPath, "");
  const log = (msg: string) => {
    appendFileSync(logPath, `${new Date().toISOString()} ${msg}\n`);
    console.log(`[narration-test] ${msg}`);
  };
  const js = <T = unknown>(code: string) =>
    win.webContents.executeJavaScript(code, true) as Promise<T>;
  const shot = async (name: string) => {
    // A window behind other windows may stop painting: force a fresh frame first.
    win.webContents.invalidate();
    await wait(400);
    writeFileSync(
      join(dir, `${name}.png`),
      (await win.webContents.capturePage()).toPNG(),
    );
    log(`shot ${name}`);
  };
  const until = async (
    what: string,
    code: string,
    timeoutMs: number,
    everyMs = 400,
  ) => {
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
      `(() => { const root = ${scope === "document" ? "document" : `document.querySelector(${JSON.stringify(scope)})`}; const b = root && [...root.querySelectorAll("button, a")].find((x) => x.textContent?.trim().includes(${JSON.stringify(text)}) && !x.disabled); b?.click(); return !!b; })()`,
    );
  const clickLabel = (label: string) =>
    js<boolean>(
      `(() => { const b = document.querySelector(${JSON.stringify(`[aria-label="${label}"]`)}); if (!b || b.disabled) return false; b.click(); return true; })()`,
    );
  /** Types into a React-controlled field. */
  const type = (selector: string, value: string) =>
    js<boolean>(`(() => {
			const el = document.querySelector(${JSON.stringify(selector)});
			if (!el) return false;
			const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
			Object.getOwnPropertyDescriptor(proto, "value").set.call(el, ${JSON.stringify(value)});
			el.dispatchEvent(new Event("input", { bubbles: true }));
			return true;
		})()`);
  const toasts = () =>
    js<string>(
      `[...document.querySelectorAll("[data-sonner-toast]")].map((t) => t.textContent).join(" | ")`,
    );
  const voiceState = () =>
    js<string>(
      `document.querySelector("[data-testid=voice-state]")?.textContent ?? ""`,
    );
  const errors: string[] = [];
  win.webContents.on("console-message", (e) => {
    if (e.level === "error") errors.push(e.message);
  });
  let draftId: string | null = null;
  /** Waits for the voice run to end; returns the "Voice ready" toast text. */
  const waitVoice = async (what: string, timeoutMs: number) => {
    const t0 = Date.now();
    await until(
      `${what} started`,
      `!!document.querySelector("[data-testid=voice-progress]")`,
      10_000,
      100,
    );
    const ok = await until(
      `${what} done`,
      `!document.querySelector("[data-testid=voice-progress]")`,
      timeoutMs,
      500,
    );
    await wait(600);
    const t = await toasts();
    log(
      `${what}: ${ok ? "done" : "NOT done"} in ${((Date.now() - t0) / 1000).toFixed(1)} s; toasts: ${t}`,
    );
    return t;
  };

  try {
    await wait(1500);
    applyTheme("light");
    await js(`document.documentElement.classList.remove("dark")`);
    if (!voiceEngine().isReady())
      throw new Error(
        "The voice engine is not installed. Install it in Settings → Voice first.",
      );

    // 1. Draft with a long plan.
    const plan = longPlan(185);
    const est = computeTimeline(plan);
    const draft = repos.drafts.create({
      title: plan.meta.title,
      level: plan.meta.level,
      stage: "preview",
      source: { version: 1 },
      plan,
      voice: { voice: "af_heart", speed: 1, lexicon: [] },
    });
    draftId = draft.id;
    const sentences = plannedClips(plan, voiceSetupOf(draft));
    log(
      `draft ${draft.id}: ${plan.chapters.length} chapters, ${sentences.length} sentences (${new Set(sentences.map((s) => s.clip)).size} unique), estimated ${(est.durationInFrames / est.fps).toFixed(0)} s`,
    );

    await js(`location.hash = "#/studio?draft=${draft.id}"`);
    await until(
      "studio",
      `!!document.querySelector("[data-testid=voice-state]")`,
      15_000,
    );
    log(`voice badge before: "${await voiceState()}"`);
    await shot("1-studio-no-voice");

    // Make voice.
    if (!(await click("Make voice")))
      throw new Error("Make voice button not found");
    await wait(1500);
    await shot("2-voicing");
    const first = await waitVoice("first voice run", 15 * 60_000);
    log(`voice badge after: "${await voiceState()}"`);
    const voicedDraft = VideoPlan.parse(repos.drafts.get(draft.id)!.plan);
    const tl = computeTimeline(voicedDraft);
    const timed = tl.scenes.flatMap((s) =>
      s.sentences.map((x) => ({ ...x, abs: s.from + x.from })),
    );
    log(
      `after voice: ${timed.filter((s) => !s.estimated).length}/${timed.length} sentences voiced; video ${(tl.durationInFrames / tl.fps).toFixed(1)} s (estimate was ${(est.durationInFrames / est.fps).toFixed(1)} s)`,
    );
    const header = await js<string>(
      `document.querySelector("header")?.textContent ?? ""`,
    );
    log(`studio header: ${header.slice(0, 160)}`);
    if (!first.includes("Voice ready")) log("WARN: no Voice ready toast");
    await shot("3-voiced");

    // 2. Sync over the whole video (EXPLAINER_NARRATION_QUICK skips it).
    if (process.env.EXPLAINER_NARRATION_QUICK) log("sync: skipped (quick run)");
    else {
      await js(`window.__esPlayer.seekTo(0)`);
      await wait(500);
      await js(`window.__esPlayer.play()`);
      const fps = tl.fps;
      const byClip = new Map<string, { abs: number; duration: number }[]>();
      for (const s of timed)
        if (s.audio)
          byClip.set(s.audio, [
            ...(byClip.get(s.audio) ?? []),
            { abs: s.abs, duration: s.duration },
          ]);
      const drifts: number[] = [];
      let silentInSpeech = 0;
      let speechSamples = 0;
      let wrongClip = 0;
      const t0 = Date.now();
      for (;;) {
        const r = await js<{
          f: number;
          playing: boolean;
          auds: { clip: string; t: number }[];
        }>(
          `(() => { const p = window.__esPlayer; return { f: p.getCurrentFrame(), playing: p.isPlaying(), auds: [...document.querySelectorAll("audio")].filter((a) => !a.paused && a.currentSrc).map((a) => ({ clip: a.currentSrc.split("/").pop(), t: a.currentTime })) }; })()`,
        );
        if (!r.playing && Date.now() - t0 > 3000) break;
        if (Date.now() - t0 > (tl.durationInFrames / fps) * 1000 + 60_000) {
          log("sync: playback took too long, stopping");
          break;
        }
        // Which sentence should be speaking now (ignoring the first and last 3 frames of a clip).
        const now = timed.find(
          (s) => s.audio && r.f >= s.abs + 3 && r.f < s.abs + s.duration - 3,
        );
        if (now) {
          speechSamples++;
          const a = r.auds.find((x) => x.clip === now.audio);
          if (!a) {
            if (r.auds.length) wrongClip++;
            else silentInSpeech++;
          } else drifts.push(a.t - (r.f - now.abs) / fps);
        }
        await wait(250);
      }
      const abs = drifts.map((d) => Math.abs(d) * 1000).sort((a, b) => a - b);
      const pct = (p: number) =>
        abs.length
          ? abs[Math.min(abs.length - 1, Math.floor(p * abs.length))]!
          : NaN;
      const mean =
        drifts.reduce((n, d) => n + d * 1000, 0) / Math.max(1, drifts.length);
      log(
        `sync: played ${((Date.now() - t0) / 1000).toFixed(0)} s of a ${(tl.durationInFrames / fps).toFixed(0)} s video; ${speechSamples} samples during speech, ${drifts.length} with the right clip playing, ${silentInSpeech} silent, ${wrongClip} wrong clip; drift ms: mean ${mean.toFixed(1)}, median ${pct(0.5).toFixed(0)}, p95 ${pct(0.95).toFixed(0)}, max ${pct(1).toFixed(0)}`,
      );
      writeFileSync(join(dir, "drift.json"), JSON.stringify(drifts));
    }

    // 3. Edit one sentence in the inspector.
    await js(`window.__esPlayer.pause()`);
    for (let i = 0; i < 4; i++) await clickLabel("Next scene");
    await wait(600);
    const before = await js<string>(
      `document.querySelector("[aria-label='Scene details'] li p")?.textContent ?? ""`,
    );
    await clickLabel("Edit sentence 1");
    await until(
      "editor",
      `!!document.querySelector("[aria-label='Sentence text']")`,
      3000,
    );
    const newText =
      "Every device on the internet has its own number, called an IP address.";
    await type("[aria-label='Sentence text']", newText);
    await shot("4-edit-sentence");
    await click("Save", "[aria-label='Scene details']");
    const edit = await waitVoice("re-voice after edit", 3 * 60_000);
    const after = await js<string>(
      `document.querySelector("[aria-label='Scene details'] li p")?.textContent ?? ""`,
    );
    log(`edited: "${before}" -> "${after}"`);

    // 4. Pronunciation rule.
    const setupBefore = voiceSetupOf(repos.drafts.get(draft.id)!);
    const planNow = VideoPlan.parse(repos.drafts.get(draft.id)!.plan);
    const withDns = plannedClips(planNow, setupBefore).filter((c) =>
      /\bDNS\b/i.test(c.text),
    );
    const dnsClip = withDns[0]!;
    const msBefore = await wavDurationMs(
      join(voiceDir(draft.id), dnsClip.clip),
    );
    await clickLabel("Voice settings");
    await until(
      "voice dialog",
      `!!document.querySelector("[role=dialog]")`,
      3000,
    );
    await click("Add word", "[role=dialog]");
    await wait(300);
    await type("[aria-label='Written word 1']", "DNS");
    await type("[aria-label='Say word 1 as']", "domain name system");
    await wait(300);
    await shot("5-pronunciation");
    await click("Save", "[role=dialog]");
    await until(
      "dialog closed",
      `!document.querySelector("[role=dialog]")`,
      3000,
    );
    await wait(800);
    log(
      `after rule, badge: "${await voiceState()}"; sentences with DNS: ${withDns.length} (${new Set(withDns.map((c) => c.clip)).size} unique)`,
    );
    await click("Update voice");
    const lex = await waitVoice(
      "re-voice after pronunciation rule",
      3 * 60_000,
    );
    const setupAfter = voiceSetupOf(repos.drafts.get(draft.id)!);
    const newClip = plannedClips(
      VideoPlan.parse(repos.drafts.get(draft.id)!.plan),
      setupAfter,
    ).find((c) => c.sentenceId === dnsClip.sentenceId)!;
    const msAfter = await wavDurationMs(join(voiceDir(draft.id), newClip.clip));
    log(
      `pronunciation: "${dnsClip.text}" spoken as "${newClip.spoken}"; clip ${dnsClip.clip} (${msBefore} ms) -> ${newClip.clip} (${msAfter} ms)`,
    );
    log(`summary: first="${first}" | edit="${edit}" | lexicon="${lex}"`);

    // Dark theme look.
    applyTheme("dark");
    await js(`document.documentElement.classList.add("dark")`);
    await wait(500);
    await shot("6-dark");
    await clickLabel("Voice settings");
    await wait(600);
    await shot("7-dark-dialog");
    await js(
      `document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`,
    );
    await wait(300);
    log(
      `console errors: ${errors.length}${errors.length ? ` — ${errors.slice(0, 5).join(" || ")}` : ""}`,
    );
  } catch (err) {
    log(`FAILED: ${(err as Error)?.stack ?? String(err)}`);
    await shot("failed").catch(() => undefined);
  } finally {
    if (draftId && !process.env.EXPLAINER_KEEP_TEST_DRAFT) {
      repos.drafts.remove(draftId);
      await rm(join(appFolders().drafts, draftId), {
        recursive: true,
        force: true,
      });
      log(`removed test draft ${draftId}`);
    }
    applyTheme("system");
    log("done");
    app.quit();
  }
}
