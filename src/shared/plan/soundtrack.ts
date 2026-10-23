import type { Mood, SfxRole, SoundSetup } from "../assets";
import type { VideoPlan } from "./schema";
import { msToFrames, type Timeline } from "./timing";

/**
 * Music and sound effects for a plan, in frames. Pure maths, shared by the
 * in-app Player and the final render, so both mix the same way.
 *  - One music bed per chapter, picked by mood, looped to fill the chapter,
 *    faded in and out, and lowered ("ducked") while the voice speaks.
 *  - A sound effect on every reveal and on every scene change.
 */

export type LibraryItem = { id: string; kind: string; url: string; mood: string | null; durationMs: number | null };

export type MusicSpan = {
	assetId: string;
	src: string;
	/** Absolute first frame and length of the bed. */
	from: number;
	durationInFrames: number;
	/** Length of one play of the track; null = unknown (played once). */
	trackFrames: number | null;
	volume: number;
	duck: boolean;
	fadeFrames: number;
};
export type SfxHit = { assetId: string; src: string; frame: number; durationInFrames: number; volume: number; role: SfxRole | "cue" };
export type Soundtrack = {
	music: MusicSpan[];
	sfx: SfxHit[];
	/** Absolute frame ranges where the voice speaks (merged), for ducking. */
	speech: [number, number][];
	/** Music level while the voice speaks, as a share of the music volume. */
	duckTo: number;
	duckRampFrames: number;
};

export const DUCK_TO = 0.3;
const DUCK_RAMP_MS = 300;
/** Pauses shorter than this keep the music down, so it does not pump between sentences. */
const DUCK_HOLD_MS = 900;
const FADE_MS = 1200;
/** No reveal pop this close after a scene-change whoosh. */
const SFX_GAP_MS = 350;

/* ---------- Mood per chapter ---------- */

const MOOD_WORDS: Record<Mood, RegExp> = {
	dramatic: /\b(war|battle|danger|dangerous|crisis|disaster|revolution|conflict|death|collapse|attack|threat|fight|invasion|extinction|catastroph\w*)\b/i,
	curious: /\b(why|how|mystery|mysteries|secret|secrets|discover\w*|explore|question|puzzle|hidden|strange|wonder|surprising|inside)\b/i,
	calm: /\b(review|summary|summari[sz]e|recap|reflect\w*|wrap|conclusion|key takeaways|remember)\b/i,
	upbeat: /\b(intro|introduction|welcome|getting started|build|practice|project|tips|let'?s|start)\b/i,
	ambient: /\b(space|ocean|sea|nature|universe|stars?|planet|climate|forest|rain|earth|weather|cells?)\b/i,
	playful: /\b(game|fun|play|silly|counting|colou?rs|shapes|animals?)\b/i,
};

const YOUNG = /\b(kg|kindergarten|nursery|pre-?school|reception|primary|elementary|grade [1-4]|class [1-4]|year [1-4]|ages? [3-9])\b/i;

/** Mood for one chapter: words in its title and goal first, then its place in the video, then the audience. */
export function chapterMood(plan: VideoPlan, chapterIndex: number): Mood {
	const ch = plan.chapters[chapterIndex];
	if (!ch) return "calm";
	const young = YOUNG.test(plan.meta.level);
	const text = `${ch.title} ${ch.goal ?? ""}`;
	for (const mood of ["dramatic", "calm", "curious", "upbeat", "ambient", "playful"] as const) {
		if (MOOD_WORDS[mood].test(text)) return young && mood !== "dramatic" && mood !== "calm" ? "playful" : mood;
	}
	const last = plan.chapters.length - 1;
	if (chapterIndex === 0) return young ? "playful" : "upbeat";
	if (chapterIndex === last && last > 0) return "calm";
	if (young) return chapterIndex % 2 ? "playful" : "upbeat";
	return chapterIndex % 2 ? "curious" : "ambient";
}

/** Small stable hash, so the same draft always gets the same picks. */
function hash(s: string): number {
	let h = 2166136261;
	for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
	return h >>> 0;
}

export type ChapterPick = { chapterId: string; title: string; mood: Mood; assetId: string | null; auto: boolean };

/**
 * Music for every chapter. A user pick wins ("none" = silence); otherwise a track
 * with the chapter's mood, never the same track twice in a row when there is a choice.
 */
export function pickChapterMusic(plan: VideoPlan, setup: SoundSetup, library: LibraryItem[], seed: string): ChapterPick[] {
	const music = library.filter((a) => a.kind === "music");
	const known = new Set(music.map((a) => a.id));
	const out: ChapterPick[] = [];
	let prev: string | null = null;
	plan.chapters.forEach((ch, i) => {
		const mood = chapterMood(plan, i);
		const own = setup.music.picks[ch.id];
		if (own === "none") {
			out.push({ chapterId: ch.id, title: ch.title, mood, assetId: null, auto: false });
			prev = null;
			return;
		}
		if (own && known.has(own)) {
			out.push({ chapterId: ch.id, title: ch.title, mood, assetId: own, auto: false });
			prev = own;
			return;
		}
		const byMood = music.filter((a) => a.mood === mood);
		const pool = (byMood.length ? byMood : music).slice().sort((a, b) => a.id.localeCompare(b.id));
		const choices = pool.length > 1 ? pool.filter((a) => a.id !== prev) : pool;
		const pick = choices.length ? choices[hash(`${seed}|${ch.id}`) % choices.length]! : null;
		out.push({ chapterId: ch.id, title: ch.title, mood, assetId: pick?.id ?? null, auto: true });
		prev = pick?.id ?? null;
	});
	return out;
}

/** Starter pack sound for each role, used when the draft has no own pick. */
export type RoleDefaults = Partial<Record<SfxRole, string>>;

/** Voice ranges in absolute frames, with short pauses closed up. */
export function speechRanges(timeline: Timeline, holdFrames: number): [number, number][] {
	const raw: [number, number][] = [];
	for (const t of timeline.scenes) for (const s of t.sentences) if (s.audio) raw.push([t.from + s.from, t.from + s.from + s.duration]);
	raw.sort((a, b) => a[0] - b[0]);
	const out: [number, number][] = [];
	for (const r of raw) {
		const last = out.at(-1);
		if (last && r[0] - last[1] <= holdFrames) last[1] = Math.max(last[1], r[1]);
		else out.push([r[0], r[1]]);
	}
	return out;
}

/**
 * How loud the music is at an absolute frame, as a share of its volume: 1 in
 * silence, `duckTo` while the voice speaks, with a short ramp either side.
 */
export function duckGain(frame: number, speech: [number, number][], duckTo: number, ramp: number): number {
	// Binary search for the last range starting at or before frame + ramp.
	let lo = 0;
	let hi = speech.length - 1;
	let idx = -1;
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		if (speech[mid]![0] - ramp <= frame) {
			idx = mid;
			lo = mid + 1;
		} else hi = mid - 1;
	}
	let closeness = 0;
	for (const i of [idx, idx + 1]) {
		const r = speech[i];
		if (!r) continue;
		const [a, b] = r;
		let c = 0;
		if (frame >= a && frame < b) c = 1;
		else if (frame < a) c = ramp ? Math.max(0, 1 - (a - frame) / ramp) : 0;
		else c = ramp ? Math.max(0, 1 - (frame - b) / ramp) : 0;
		closeness = Math.max(closeness, c);
	}
	return 1 - (1 - duckTo) * closeness;
}

/** Fade in at the start and out at the end of a music bed. */
export function fadeGain(local: number, length: number, fade: number): number {
	if (fade <= 0) return 1;
	return Math.max(0, Math.min(1, local / fade, (length - local) / fade));
}

/** Music volume at an absolute frame for one bed: volume × fade × duck. */
export function musicVolumeAt(span: MusicSpan, frame: number, st: Pick<Soundtrack, "speech" | "duckTo" | "duckRampFrames">): number {
	const fade = fadeGain(frame - span.from, span.durationInFrames, span.fadeFrames);
	const duck = span.duck ? duckGain(frame, st.speech, st.duckTo, st.duckRampFrames) : 1;
	return Math.max(0, Math.min(1, span.volume * fade * duck));
}

export function buildSoundtrack(
	plan: VideoPlan,
	timeline: Timeline,
	setup: SoundSetup,
	library: LibraryItem[],
	opts: { seed: string; roleDefaults?: RoleDefaults },
): Soundtrack {
	const fps = timeline.fps;
	const byId = new Map(library.map((a) => [a.id, a]));
	const frames = (ms: number | null) => (ms ? Math.max(1, msToFrames(ms, fps)) : null);
	const speech = speechRanges(timeline, msToFrames(DUCK_HOLD_MS, fps));
	const music: MusicSpan[] = [];
	const sfx: SfxHit[] = [];

	if (setup.music.enabled) {
		if (plan.music.length) {
			// Hand-placed music in the plan wins over the automatic beds.
			for (const m of plan.music) {
				const a = byId.get(m.assetId);
				if (!a || a.kind !== "music") continue;
				// Plan times count from the first scene, so a brand intro shifts them.
				const from = timeline.intro + msToFrames(m.startMs, fps);
				const end = m.endMs !== undefined ? timeline.intro + msToFrames(m.endMs, fps) : timeline.durationInFrames;
				if (end > from) music.push({ assetId: a.id, src: a.url, from, durationInFrames: end - from, trackFrames: frames(a.durationMs), volume: m.volume, duck: m.duck && setup.music.duck, fadeFrames: msToFrames(FADE_MS, fps) });
			}
		} else {
			const picks = pickChapterMusic(plan, setup, library, opts.seed);
			timeline.chapters.forEach((c, i) => {
				const a = picks[i]?.assetId ? byId.get(picks[i]!.assetId!) : undefined;
				if (!a || c.durationInFrames <= 0) return;
				music.push({ assetId: a.id, src: a.url, from: c.from, durationInFrames: c.durationInFrames, trackFrames: frames(a.durationMs), volume: setup.music.volume, duck: setup.music.duck, fadeFrames: msToFrames(FADE_MS, fps) });
			});
		}
	}

	if (setup.sfx.enabled) {
		const role = (r: SfxRole) => {
			const id = setup.sfx.roles[r] ?? opts.roleDefaults?.[r];
			const a = id ? byId.get(id) : undefined;
			return a && a.kind === "sfx" ? a : undefined;
		};
		const hit = (a: LibraryItem | undefined, frame: number, r: SfxHit["role"]) => {
			if (!a || frame < 0 || frame >= timeline.durationInFrames) return;
			sfx.push({ assetId: a.id, src: a.url, frame, durationInFrames: Math.min(frames(a.durationMs) ?? fps * 2, timeline.durationInFrames - frame), volume: setup.sfx.volume, role: r });
		};
		const gap = msToFrames(SFX_GAP_MS, fps);
		const whoosh = role("transition");
		const pop = role("reveal");
		timeline.scenes.forEach((t, i) => {
			if (i > 0) hit(whoosh, t.from, "transition");
			for (const c of t.cues) {
				const at = t.from + c.frame;
				if (c.action === "sfx") hit((c.sfx ? byId.get(c.sfx) : undefined) ?? role("correct"), at, "cue");
				else if ((c.action === "reveal" || c.action === "focus") && !(i > 0 && whoosh && at - t.from < gap)) hit(pop, at, "reveal");
			}
		});
		for (const s of plan.sfx) hit(byId.get(s.assetId), timeline.intro + msToFrames(s.atMs, fps), "cue");
		sfx.sort((a, b) => a.frame - b.frame);
	}

	return { music, sfx, speech, duckTo: DUCK_TO, duckRampFrames: msToFrames(DUCK_RAMP_MS, fps) };
}

/** The asset ids a soundtrack uses (for credits and "used by" checks). */
export function soundtrackAssets(st: Soundtrack): string[] {
	return [...new Set([...st.music.map((m) => m.assetId), ...st.sfx.map((s) => s.assetId)])];
}
