import { z } from "zod";
import { isNarrow, isPhone } from "./frame";
import type { Timeline } from "./timing";

/**
 * Burned-in captions, shown a few words at a time while the voice speaks.
 *
 * Word times are estimated: each sentence is its own voice clip with a known
 * length, and its words share that time by their length (a comma or a full stop
 * adds a short pause). Close enough to read along; no extra voice model needed.
 *
 * Words are grouped 2 to 5 at a time (fewer and shorter lines in narrow
 * frames), breaking at the end of a clause. A group shows from its first word
 * until the next group starts, or a short hold after its last word.
 * Rules adapted from common caption practice (see the hyperframes caption notes, Apache-2.0).
 */

export const CAPTION_STYLES = {
	off: { label: "No captions", hint: "" },
	pill: { label: "Pill", hint: "White words on a dark pill" },
	karaoke: { label: "Karaoke", hint: "The spoken word lights up" },
	pop: { label: "Pop", hint: "Big bold words that pop in" },
} as const;
export const CaptionStyle = z.enum(["off", "pill", "karaoke", "pop"]);
export type CaptionStyle = z.infer<typeof CaptionStyle>;

export type CaptionWord = { text: string; from: number; to: number };
export type CaptionGroup = { words: CaptionWord[]; from: number; to: number };

/** The words of a sentence. Scripts without spaces (Chinese, Japanese, Thai) are cut into short pieces. */
export function splitWords(text: string): string[] {
	const words = text.trim().split(/\s+/).filter(Boolean);
	if (words.length > 1 || text.length <= 12) return words;
	const out: string[] = [];
	for (let i = 0; i < text.length; i += 6) out.push(text.slice(i, i + 6));
	return out;
}

/** How long a word takes, in parts of its sentence: its length, plus a pause after punctuation. */
const weight = (w: string) => w.replace(/[^\p{L}\p{N}]/gu, "").length + 1 + (/[.!?…。！？]$/u.test(w) ? 3 : /[,;:،、，]$/u.test(w) ? 2 : 0);

/** Word times (absolute frames) inside one sentence that starts at `from` and lasts `duration` frames. */
export function wordTimes(text: string, from: number, duration: number): CaptionWord[] {
	const words = splitWords(text);
	const total = words.reduce((n, w) => n + weight(w), 0) || 1;
	let t = from;
	return words.map((w) => {
		const len = (duration * weight(w)) / total;
		const word = { text: w, from: Math.round(t), to: Math.round(t + len) };
		t += len;
		return word;
	});
}

/** Words per group and characters per line, by frame shape. */
const LIMITS = { wide: { words: 5, chars: 34 }, narrow: { words: 4, chars: 22 } } as const;
/** A group stays this long after its last word when nothing follows at once. */
const HOLD_MS = 400;

/** Caption groups for one sentence. */
export function groupWords(words: CaptionWord[], narrow: boolean): CaptionWord[][] {
	const lim = narrow ? LIMITS.narrow : LIMITS.wide;
	const groups: CaptionWord[][] = [];
	let cur: CaptionWord[] = [];
	const chars = (g: CaptionWord[]) => g.reduce((n, w) => n + w.text.length + 1, -1);
	for (const w of words) {
		if (cur.length && (cur.length >= lim.words || chars([...cur, w]) > lim.chars)) {
			groups.push(cur);
			cur = [];
		}
		cur.push(w);
		// End of a clause: start a new group, if this one has 2 words or more.
		if (cur.length >= 2 && /[,.;:!?…،、，。！？]$/u.test(w.text)) {
			groups.push(cur);
			cur = [];
		}
	}
	if (cur.length) {
		// A lone last word joins the group before it when there is room.
		const last = groups.at(-1);
		if (cur.length === 1 && last && last.length < lim.words && chars([...last, ...cur]) <= lim.chars + 6) last.push(...cur);
		else groups.push(cur);
	}
	return groups;
}

/** Every caption group of the video, in order, with absolute frames. */
export function captionGroups(timeline: Pick<Timeline, "fps" | "scenes">, width: number, height: number): CaptionGroup[] {
	const narrow = isNarrow(width, height);
	const hold = Math.round((HOLD_MS / 1000) * timeline.fps);
	const all: CaptionGroup[] = [];
	for (const t of timeline.scenes)
		for (const s of t.sentences) {
			const words = wordTimes(s.text, t.from + s.from, s.duration);
			for (const g of groupWords(words, narrow)) all.push({ words: g, from: g[0]!.from, to: g.at(-1)!.to + hold });
		}
	// A group never runs into the next one.
	for (let i = 0; i + 1 < all.length; i++) all[i]!.to = Math.min(all[i]!.to, all[i + 1]!.from);
	return all;
}

/** The group on screen at a frame, or null. */
export function groupAt(groups: CaptionGroup[], frame: number): CaptionGroup | null {
	let lo = 0;
	let hi = groups.length - 1;
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		const g = groups[mid]!;
		if (frame < g.from) hi = mid - 1;
		else if (frame >= g.to) lo = mid + 1;
		else return g;
	}
	return null;
}

/**
 * The band at the bottom of the frame the captions use, in pixels: scenes keep
 * their content above it. Phones (9:16) put it above the app's own buttons.
 */
export function captionBand(style: CaptionStyle, width: number, height: number): { bottom: number; height: number } {
	if (style === "off") return { bottom: 0, height: 0 };
	const short = Math.min(width, height);
	if (isPhone(width, height)) return { bottom: Math.round(height * 0.2), height: Math.round(short * 0.16) };
	return { bottom: Math.round(height * 0.05), height: Math.round(short * (isNarrow(width, height) ? 0.15 : 0.12)) };
}
