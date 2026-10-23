import { z } from "zod";
import { Speed, VoiceId } from "./voice-ids";

/**
 * Voice for one draft (PLAN.md section 9): voice, speed and a pronunciation
 * dictionary. Each sentence is voiced on its own and cached by what is
 * actually spoken, so an edit re-voices only the sentences it changes.
 */

export const LEXICON_MAX = 200;

export const Pronunciation = z.object({
	/** Word or short phrase as written in the script, e.g. "SQL". */
	word: z
		.string()
		.trim()
		.min(1)
		.max(60)
		.regex(/[\p{L}\p{N}]/u, "Needs a letter or a number"),
	/** How to say it, written the way it sounds, e.g. "sequel". */
	say: z.string().trim().min(1).max(120),
	/** Match upper and lower case exactly ("US" the country, not "us"). */
	matchCase: z.boolean().default(false),
});
export type Pronunciation = z.infer<typeof Pronunciation>;

export const VoiceSetup = z.object({
	voice: VoiceId,
	speed: Speed,
	lexicon: z.array(Pronunciation).max(LEXICON_MAX).default([]),
});
export type VoiceSetup = z.infer<typeof VoiceSetup>;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The text the voice engine gets: every dictionary word replaced by how it is said.
 * Whole words only ("SQL" changes, "SQLite" does not). Longer entries win, so
 * "New York" is replaced before "York". Replacements are never replaced again.
 */
export function applyLexicon(text: string, lexicon: Pronunciation[]): string {
	if (!lexicon.length) return text;
	const entries = [...lexicon].sort((a, b) => b.word.length - a.word.length);
	const pattern = new RegExp(`(?<![\\p{L}\\p{N}_])(?:${entries.map((e) => escape(e.word)).join("|")})(?![\\p{L}\\p{N}_])`, "giu");
	return text.replace(pattern, (hit) => {
		const e = entries.find((x) => (x.matchCase ? x.word === hit : x.word.toLowerCase() === hit.toLowerCase()));
		return e ? e.say : hit;
	});
}

/** Live state of a "make voice" run for a draft. */
export const NarrationUpdate = z.object({
	jobId: z.string(),
	draftId: z.string(),
	state: z.enum(["running", "done", "error", "cancelled"]),
	/** Sentences handled so far, of `total`. */
	done: z.number().int().min(0),
	total: z.number().int().min(0),
	/** New clips made by the voice engine. */
	made: z.number().int().min(0),
	/** Clips found in the cache (sentences that did not change). */
	reused: z.number().int().min(0),
	detail: z.string(),
	error: z.string().optional(),
});
export type NarrationUpdate = z.infer<typeof NarrationUpdate>;

/** How much of a draft has up-to-date voice. */
export const NarrationStatus = z.object({
	setup: VoiceSetup,
	total: z.number().int(),
	/** Sentences whose clip matches their text, voice, speed and dictionary. */
	voiced: z.number().int(),
	/** Sentences that need a new clip (new, edited, or voice settings changed). */
	pending: z.number().int(),
	/** Seconds of voice in the plan (voiced sentences only). */
	voicedMs: z.number().int(),
	/** URL prefix for the clips of this draft (es-media protocol). */
	audioBase: z.string(),
	engineReady: z.boolean(),
	running: NarrationUpdate.nullable(),
});
export type NarrationStatus = z.infer<typeof NarrationStatus>;
