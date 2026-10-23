import type { Voice } from "@shared/ipc/voice";

/** Kokoro's best-rated English voices (VOICES.md grades A to B-). Shown first. */
const RECOMMENDED = new Set(["af_heart", "af_bella", "af_nicole", "am_michael", "am_fenrir", "am_puck", "bf_emma", "bm_george", "bm_fable"]);

/**
 * Kokoro names voices <accent><gender>_<name>: a = American, b = British; f/m.
 * Other accents need extra language packs, so only English voices are offered.
 */
export function describeVoices(ids: string[]): Voice[] {
	const out: Voice[] = [];
	for (const id of ids) {
		const m = /^([ab])([fm])_([a-z0-9]+)$/.exec(id);
		if (!m) continue;
		const name = m[3]!;
		out.push({
			id,
			name: name.charAt(0).toUpperCase() + name.slice(1),
			accent: m[1] === "a" ? "American" : "British",
			gender: m[2] === "f" ? "female" : "male",
			recommended: RECOMMENDED.has(id),
		});
	}
	return out.sort((a, b) => Number(b.recommended) - Number(a.recommended) || a.accent.localeCompare(b.accent) || a.name.localeCompare(b.name));
}

/** espeak language for a voice: British voices need en-gb phonemes. */
export const langOf = (voice: string) => (voice.startsWith("b") ? "en-gb" : "en-us");

export function sampleSentence(v: Pick<Voice, "name">): string {
	return `Hi, I'm ${v.name}. Let's explore how light bends when it passes through water, one simple step at a time.`;
}
