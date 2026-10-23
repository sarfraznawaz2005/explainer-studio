import { describe, expect, it } from "vitest";
import { SoundSetup } from "../src/shared/assets";
import { VideoPlan, type VideoPlanInput } from "../src/shared/plan/schema";
import { buildSoundtrack, chapterMood, duckGain, musicVolumeAt, pickChapterMusic, type LibraryItem } from "../src/shared/plan/soundtrack";
import { computeTimeline } from "../src/shared/plan/timing";

const scene = (id: string, n: number, voiced = true) => ({
	id,
	type: "bullets" as const,
	props: { items: ["One", "Two", "Three"] },
	narration: Array.from({ length: n }, (_, i) => ({ id: `${id}-n${i}`, text: `Sentence ${i} of ${id} has a few words in it.`, ...(voiced ? { durationMs: 2000, audio: `${"a".repeat(31)}${i}.wav` } : {}) })),
});

function plan(chapters: { title: string; scenes: number }[], level = "High school", voiced = true): VideoPlan {
	const input: VideoPlanInput = {
		version: 1,
		meta: { title: "T", level },
		chapters: chapters.map((c, i) => ({ id: `ch${i}`, title: c.title, scenes: Array.from({ length: c.scenes }, (_, k) => scene(`c${i}s${k}`, 3, voiced)) })),
	};
	return VideoPlan.parse(input);
}

const lib: LibraryItem[] = [
	{ id: "m-calm", kind: "music", url: "es-media://asset/calm.mp3", mood: "calm", durationMs: 60_000 },
	{ id: "m-up1", kind: "music", url: "es-media://asset/up1.mp3", mood: "upbeat", durationMs: 90_000 },
	{ id: "m-up2", kind: "music", url: "es-media://asset/up2.mp3", mood: "upbeat", durationMs: 90_000 },
	{ id: "m-cur", kind: "music", url: "es-media://asset/cur.mp3", mood: "curious", durationMs: 5_000 },
	{ id: "m-dra", kind: "music", url: "es-media://asset/dra.mp3", mood: "dramatic", durationMs: 90_000 },
	{ id: "s-pop", kind: "sfx", url: "es-media://asset/pop.ogg", mood: null, durationMs: 100 },
	{ id: "s-woosh", kind: "sfx", url: "es-media://asset/woosh.ogg", mood: null, durationMs: 380 },
];
const roles = { reveal: "s-pop", transition: "s-woosh" };

describe("music moods", () => {
	it("reads the chapter's words, then its place in the video", () => {
		const p = plan([{ title: "Welcome", scenes: 1 }, { title: "Why do cells divide?", scenes: 1 }, { title: "The war of 1812", scenes: 1 }, { title: "Stars and planets", scenes: 1 }, { title: "Recap", scenes: 1 }]);
		expect(p.chapters.map((_, i) => chapterMood(p, i))).toEqual(["upbeat", "curious", "dramatic", "ambient", "calm"]);
		const kids = plan([{ title: "Counting", scenes: 1 }, { title: "Shapes", scenes: 1 }], "Kindergarten");
		expect(chapterMood(kids, 0)).toBe("playful");
	});

	it("picks by mood, never the same track twice in a row, and honours the user's pick", () => {
		const p = plan([{ title: "Welcome", scenes: 1 }, { title: "Let's build it", scenes: 1 }, { title: "Start practising", scenes: 1 }]);
		const auto = pickChapterMusic(p, SoundSetup.parse({}), lib, "draft-1");
		expect(auto.every((c) => c.assetId?.startsWith("m-up"))).toBe(true);
		expect(auto[0]!.assetId).not.toBe(auto[1]!.assetId);
		expect(auto[1]!.assetId).not.toBe(auto[2]!.assetId);
		// Same seed, same picks.
		expect(pickChapterMusic(p, SoundSetup.parse({}), lib, "draft-1")).toEqual(auto);
		const own = pickChapterMusic(p, SoundSetup.parse({ music: { picks: { ch0: "m-dra", ch1: "none" } } }), lib, "draft-1");
		expect(own.map((c) => [c.assetId, c.auto])).toEqual([
			["m-dra", false],
			[null, false],
			[own[2]!.assetId, true],
		]);
	});
});

describe("ducking", () => {
	it("is full in silence, low in speech, and ramps in between", () => {
		const speech: [number, number][] = [
			[100, 200],
			[400, 500],
		];
		expect(duckGain(0, speech, 0.3, 10)).toBe(1);
		expect(duckGain(150, speech, 0.3, 10)).toBeCloseTo(0.3);
		expect(duckGain(95, speech, 0.3, 10)).toBeCloseTo(0.65);
		expect(duckGain(205, speech, 0.3, 10)).toBeCloseTo(0.65);
		expect(duckGain(300, speech, 0.3, 10)).toBe(1);
		expect(duckGain(450, speech, 0.3, 10)).toBeCloseTo(0.3);
		expect(duckGain(999, speech, 0.3, 10)).toBe(1);
	});
});

describe("soundtrack", () => {
	it("lays one faded, looped, ducked bed per chapter", () => {
		const p = plan([{ title: "Welcome", scenes: 2 }, { title: "Why it works", scenes: 2 }]);
		const t = computeTimeline(p);
		const st = buildSoundtrack(p, t, SoundSetup.parse({}), lib, { seed: "d", roleDefaults: roles });
		expect(st.music).toHaveLength(2);
		expect(st.music.map((m) => [m.from, m.durationInFrames])).toEqual(t.chapters.map((c) => [c.from, c.durationInFrames]));
		const curious = st.music[1]!;
		expect(curious.assetId).toBe("m-cur");
		expect(curious.trackFrames).toBe(150);
		// Speech ranges cover every voiced sentence.
		const first = t.scenes[0]!;
		// Second sentence: past the fade-in.
		const s0 = first.from + first.sentences[1]!.from;
		expect(st.speech.some(([a, b]) => s0 >= a && s0 < b)).toBe(true);
		// Volume: silent at the fade start, ducked while talking, full in a silent stretch.
		const bed = st.music[0]!;
		expect(musicVolumeAt(bed, bed.from, st)).toBe(0);
		const talking = musicVolumeAt(bed, s0 + 10, st);
		expect(talking).toBeCloseTo(bed.volume * st.duckTo, 5);
		const noDuck = buildSoundtrack(p, t, SoundSetup.parse({ music: { duck: false } }), lib, { seed: "d", roleDefaults: roles });
		expect(musicVolumeAt(noDuck.music[0]!, s0 + 10, noDuck)).toBeCloseTo(bed.volume, 5);
	});

	it("pops on every reveal and whooshes on every scene change", () => {
		const p = plan([{ title: "Welcome", scenes: 2 }, { title: "Next", scenes: 1 }]);
		const t = computeTimeline(p);
		const st = buildSoundtrack(p, t, SoundSetup.parse({}), lib, { seed: "d", roleDefaults: roles });
		const whooshes = st.sfx.filter((s) => s.role === "transition").map((s) => s.frame);
		expect(whooshes).toEqual(t.scenes.slice(1).map((s) => s.from));
		const pops = st.sfx.filter((s) => s.role === "reveal").map((s) => s.frame);
		const reveals = t.scenes.flatMap((s, i) => s.cues.filter((c) => c.action === "reveal").map((c) => ({ at: s.from + c.frame, i, local: c.frame })));
		// A reveal right on a scene change is covered by the whoosh; every other reveal pops.
		const expected = reveals.filter((r) => !(r.i > 0 && r.local < 11)).map((r) => r.at);
		expect(pops).toEqual(expected);
		expect(pops.length).toBeGreaterThanOrEqual(6);
		expect(st.sfx.every((s) => s.durationInFrames > 0 && s.volume === 0.35)).toBe(true);
	});

	it("turns off music and effects on request, and skips assets that are gone", () => {
		const p = plan([{ title: "Welcome", scenes: 2 }]);
		const t = computeTimeline(p);
		const off = buildSoundtrack(p, t, SoundSetup.parse({ music: { enabled: false }, sfx: { enabled: false } }), lib, { seed: "d", roleDefaults: roles });
		expect(off.music).toEqual([]);
		expect(off.sfx).toEqual([]);
		const gone = buildSoundtrack(p, t, SoundSetup.parse({ music: { picks: { ch0: "deleted-id" } } }), [], { seed: "d", roleDefaults: roles });
		expect(gone.music).toEqual([]);
		expect(gone.sfx).toEqual([]);
	});

	it("does not duck when nothing is voiced yet", () => {
		const p = plan([{ title: "Welcome", scenes: 1 }], "High school", false);
		const st = buildSoundtrack(p, computeTimeline(p), SoundSetup.parse({}), lib, { seed: "d", roleDefaults: roles });
		expect(st.speech).toEqual([]);
	});
});
