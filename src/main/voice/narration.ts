import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, open, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { VideoPlan } from "@shared/plan/schema";
import { applyLexicon, type VoiceSetup } from "@shared/narration";

/**
 * Per-sentence voice for a plan (PLAN.md sections 7 and 9).
 * Every clip is named by a hash of what is spoken, the voice, the speed and the
 * model, so a clip that exists is always right for its sentence: editing one
 * sentence (or one dictionary word) makes only the clips that changed.
 */

/** Part of the Kokoro model hash: a new model makes new clips. */
export const MODEL_TAG = "kokoro-v1.0-7d5df8ec";
export const CLIP_RE = /^[0-9a-f]{32}\.wav$/;

export function clipName(spoken: string, setup: Pick<VoiceSetup, "voice" | "speed">): string {
	return `${createHash("sha256").update(`${MODEL_TAG}|${setup.voice}|${setup.speed.toFixed(2)}|${spoken}`).digest("hex").slice(0, 32)}.wav`;
}

export type PlannedClip = { sentenceId: string; text: string; spoken: string; clip: string };

/** Every sentence of the plan with the text the engine will say and its clip name. */
export function plannedClips(plan: VideoPlan, setup: VoiceSetup): PlannedClip[] {
	return plan.chapters.flatMap((ch) =>
		ch.scenes.flatMap((sc) =>
			sc.narration.map((n) => {
				const spoken = applyLexicon(n.text, setup.lexicon);
				return { sentenceId: n.id, text: n.text, spoken, clip: clipName(spoken, setup) };
			}),
		),
	);
}

/**
 * Length of a WAV file in ms, from its header (fmt and data chunks).
 * Reads only the first bytes, so it is cheap on cache hits.
 */
export async function wavDurationMs(path: string): Promise<number> {
	const f = await open(path, "r");
	try {
		const head = Buffer.alloc(4096);
		const { bytesRead } = await f.read(head, 0, head.length, 0);
		const size = (await f.stat()).size;
		const buf = head.subarray(0, bytesRead);
		if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") throw new Error("Not a WAV file");
		let byteRate = 0;
		for (let p = 12; p + 8 <= buf.length; ) {
			const id = buf.toString("ascii", p, p + 4);
			const len = buf.readUInt32LE(p + 4);
			if (id === "fmt ") byteRate = buf.readUInt32LE(p + 16);
			if (id === "data") {
				if (!byteRate) break;
				const dataBytes = Math.min(len, size - (p + 8));
				return Math.round((dataBytes / byteRate) * 1000);
			}
			p += 8 + len + (len % 2);
		}
		throw new Error("WAV file has no audio data");
	} finally {
		await f.close();
	}
}

export type Speak = (req: { text: string; voice: string; speed: number; out: string }) => Promise<{ durationMs: number }>;

export type VoiceRun = {
	/** Clip name → measured length, for every sentence handled. */
	durations: Map<string, number>;
	made: number;
	reused: number;
	total: number;
};

/**
 * Voices every sentence that has no clip yet; reuses the clips that exist.
 * Same text twice is voiced once. Stops between sentences when `signal` aborts
 * and puts what was done so far in `partial` on any thrown error.
 */
export async function voicePlan(
	plan: VideoPlan,
	setup: VoiceSetup,
	opts: { dir: string; speak: Speak; signal?: AbortSignal; onProgress?: (p: { done: number; total: number; made: number; reused: number; text: string }) => void },
): Promise<VoiceRun> {
	await mkdir(opts.dir, { recursive: true });
	const clips = plannedClips(plan, setup);
	const run: VoiceRun = { durations: new Map(), made: 0, reused: 0, total: clips.length };
	let done = 0;
	try {
		for (const c of clips) await one(c);
	} catch (err) {
		throw Object.assign(err instanceof Error ? err : new Error(String(err)), { partial: run });
	}
	return run;

	async function one(c: PlannedClip) {
		if (opts.signal?.aborted) throw opts.signal.reason instanceof Error ? opts.signal.reason : new Error("Cancelled");
		const out = join(opts.dir, c.clip);
		if (!run.durations.has(c.clip)) {
			let ms: number | null = null;
			if (existsSync(out)) ms = await wavDurationMs(out).catch(() => null);
			if (ms !== null && ms > 0) run.reused++;
			else {
				ms = (await opts.speak({ text: c.spoken, voice: setup.voice, speed: setup.speed, out })).durationMs;
				run.made++;
			}
			run.durations.set(c.clip, ms);
		} else run.reused++;
		done++;
		opts.onProgress?.({ done, total: clips.length, made: run.made, reused: run.reused, text: c.text });
	}
}

/**
 * Writes clip names and measured lengths into the plan. Matches by clip name, so it
 * is safe to apply to a newer copy of the plan: a sentence edited during the run
 * has a different clip name and keeps no stale voice.
 */
export function applyVoice(plan: VideoPlan, setup: VoiceSetup, durations: Map<string, number>): VideoPlan {
	return {
		...plan,
		meta: { ...plan.meta, voice: setup.voice },
		chapters: plan.chapters.map((ch) => ({
			...ch,
			scenes: ch.scenes.map((sc) => ({
				...sc,
				narration: sc.narration.map((n) => {
					const clip = clipName(applyLexicon(n.text, setup.lexicon), setup);
					const ms = durations.get(clip);
					if (ms === undefined) return n.audio || n.durationMs ? { id: n.id, text: n.text } : n;
					return { ...n, audio: clip, durationMs: Math.max(1, Math.min(120_000, Math.round(ms))) };
				}),
			})),
		})),
	};
}

/** Sentences whose stored clip is the right one for their text and the voice setup, and exists on disk. */
export function narrationCounts(plan: VideoPlan, setup: VoiceSetup, dir: string) {
	const byId = new Map(plan.chapters.flatMap((c) => c.scenes.flatMap((s) => s.narration.map((n) => [n.id, n] as const))));
	let voiced = 0;
	let voicedMs = 0;
	const clips = plannedClips(plan, setup);
	for (const c of clips) {
		const n = byId.get(c.sentenceId);
		if (n?.audio === c.clip && n.durationMs && existsSync(join(dir, c.clip))) {
			voiced++;
			voicedMs += n.durationMs;
		}
	}
	return { total: clips.length, voiced, pending: clips.length - voiced, voicedMs };
}

/**
 * Deletes clips in the draft's voice folder that the plan no longer uses, once there
 * are more than `allowUnused` of them. Only clip files (and unfinished .part files) are touched.
 */
export async function pruneClips(dir: string, keep: Set<string>, allowUnused = 0): Promise<number> {
	let names: string[];
	try {
		names = await readdir(dir);
	} catch {
		return 0;
	}
	const unused = names.filter((n) => CLIP_RE.test(n) && !keep.has(n));
	const drop = [...(unused.length > allowUnused ? unused : []), ...names.filter((n) => n.endsWith(".wav.part"))];
	for (const n of drop) await rm(join(dir, n), { force: true });
	return drop.length;
}
