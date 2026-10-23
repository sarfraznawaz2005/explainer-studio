import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { DEFAULT_VOICE, VoiceSettings, voiceEvents } from "@shared/ipc/voice";
import { VoiceSetup, type NarrationStatus, type NarrationUpdate } from "@shared/narration";
import { VideoPlan } from "@shared/plan/schema";
import { PlanSettings } from "@shared/planner";
import type { Draft } from "@shared/models";
import { appFolders } from "../app/folders";
import { audioBaseFor } from "../app/media-url";
import { writeLog } from "../app/logger";
import { getMainWindow } from "../app/window";
import { repos } from "../db/repos";
import { applyVoice, narrationCounts, plannedClips, pruneClips, voicePlan, type VoiceRun } from "./narration";
import { voiceEngine } from "./index";

/** One voice run at a time: the Kokoro sidecar speaks one sentence after another anyway. */
let job: { id: string; draftId: string; abort: AbortController; last: NarrationUpdate } | null = null;
const finished = new Map<string, NarrationUpdate>();

export const voiceDir = (draftId: string) => join(appFolders().drafts, draftId, "voice");

function emit(u: NarrationUpdate) {
	if (job?.id === u.jobId) job.last = u;
	getMainWindow()?.webContents.send(voiceEvents.draft, u);
}

function mustDraft(id: string): Draft {
	const d = repos.drafts.get(id);
	if (!d) throw new Error("This draft was not found. It may have been deleted.");
	return d;
}

function mustPlan(d: Draft): VideoPlan {
	const r = VideoPlan.safeParse(d.plan);
	if (!r.success) throw new Error("This draft has no script yet. Finish the script in New video first.");
	return r.data;
}

/** The draft's own setup, or the app default voice and speed (and the voice picked in the wizard). */
export function voiceSetupOf(d: Draft): VoiceSetup {
	const own = VoiceSetup.safeParse(d.voice);
	if (own.success) return own.data;
	const global = VoiceSettings.safeParse(repos.settings.get("voice.settings"));
	const wizard = PlanSettings.safeParse(d.settings);
	return {
		voice: (wizard.success ? wizard.data.voice : undefined) ?? (global.success ? global.data.voice : DEFAULT_VOICE),
		speed: global.success ? global.data.speed : 1,
		lexicon: [],
	};
}

export function narrationStatus(draftId: string): NarrationStatus {
	const d = mustDraft(draftId);
	const setup = voiceSetupOf(d);
	const plan = VideoPlan.safeParse(d.plan);
	const counts = plan.success ? narrationCounts(plan.data, setup, voiceDir(d.id)) : { total: 0, voiced: 0, pending: 0, voicedMs: 0 };
	const running = job?.draftId === draftId ? job.last : (finished.get(draftId) ?? null);
	return { setup, ...counts, audioBase: audioBaseFor(d.id), engineReady: voiceEngine().isReady(), running: running?.state === "running" ? running : null };
}

export function saveVoiceSetup(draftId: string, setup: VoiceSetup): NarrationStatus {
	mustDraft(draftId);
	if (job?.draftId === draftId) throw new Error("Wait for the voice to finish, or stop it, before changing these settings.");
	repos.drafts.update(draftId, { voice: setup });
	return narrationStatus(draftId);
}

/** Saves the newest plan with the clips made so far. Re-reads the draft so edits made during the run are kept. */
function saveRun(draftId: string, setup: VoiceSetup, run: VoiceRun) {
	const d = repos.drafts.get(draftId);
	const plan = d && VideoPlan.safeParse(d.plan);
	if (!plan?.success) return;
	repos.drafts.update(draftId, { plan: applyVoice(plan.data, setup, run.durations) });
}

export function startNarration(draftId: string): string {
	const d = mustDraft(draftId);
	const plan = mustPlan(d);
	if (job) throw new Error(job.draftId === draftId ? "The voice for this draft is already being made." : "Another draft is being voiced. Wait for it to finish, or stop it.");
	const engine = voiceEngine();
	if (!engine.isReady()) throw new Error("The voice engine is not ready. Install or repair it in Settings → Voice.");
	const setup = voiceSetupOf(d);
	const dir = voiceDir(d.id);
	const id = randomUUID();
	const abort = new AbortController();
	const total = plannedClips(plan, setup).length;
	job = { id, draftId, abort, last: { jobId: id, draftId, state: "running", done: 0, total, made: 0, reused: 0, detail: "Starting the voice engine" } };
	emit(job.last);
	const t0 = Date.now();
	let lastEmit = 0;
	void (async () => {
		let run: VoiceRun | null = null;
		try {
			run = await voicePlan(plan, setup, {
				dir,
				signal: abort.signal,
				speak: (req) => engine.speak(req),
				onProgress: (p) => {
					// A few updates per second at most; every new clip is worth showing.
					if (Date.now() - lastEmit < 150 && p.done < p.total) return;
					lastEmit = Date.now();
					emit({ ...job!.last, done: p.done, total: p.total, made: p.made, reused: p.reused, detail: `Sentence ${p.done} of ${p.total}` });
				},
			});
			saveRun(draftId, setup, run);
			// Old clips are kept for a while (switching voice back is free), but not forever.
			const keep = new Set(plannedClips(plan, setup).map((c) => c.clip));
			const removed = await pruneClips(dir, keep, keep.size);
			writeLog("voice", "info", `draft ${draftId}: ${run.total} sentences, ${run.made} made, ${run.reused} reused, ${removed} old clips removed, ${Math.round((Date.now() - t0) / 1000)} s`);
			emit({ ...job!.last, state: "done", done: run.total, total: run.total, made: run.made, reused: run.reused, detail: "Voice ready" });
		} catch (err) {
			const partial = (err as { partial?: VoiceRun }).partial;
			if (partial) saveRun(draftId, setup, partial);
			const last = job!.last;
			if (abort.signal.aborted) {
				writeLog("voice", "info", `draft ${draftId}: voice stopped after ${partial?.made ?? 0} new clips`);
				emit({ ...last, state: "cancelled", detail: "Stopped. The sentences already voiced are kept." });
			} else {
				writeLog("voice", "error", `draft ${draftId}: voice failed`, err);
				emit({ ...last, state: "error", error: (err as Error)?.message ?? String(err) });
			}
		} finally {
			finished.set(draftId, job!.last);
			job = null;
		}
	})();
	return id;
}

/** True while this draft's voice is being made. */
export const voiceBusy = (draftId: string) => job?.draftId === draftId;

export function cancelNarration(jobId: string): void {
	if (job?.id === jobId) job.abort.abort(new Error("Stopped by the user"));
}

export function cancelAllNarration(): void {
	job?.abort.abort(new Error("The app is closing"));
}
