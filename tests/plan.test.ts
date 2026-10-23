import { describe, expect, it } from "vitest";
import { SCENE_TYPES, VideoPlan, type Scene, type SceneInput } from "@shared/plan/schema";
import {
	computeTimeline,
	cueFrame,
	defaultCues,
	estimateSentenceMs,
	LEAD_IN_MS,
	msToFrames,
	MIN_SCENE_MS,
	sceneAt,
	SENTENCE_GAP_MS,
	TAIL_MS,
	timeScene,
} from "@shared/plan/timing";
import { GALLERY_SCENES } from "../video/src/samples/gallery";
import { SAMPLE_PLAN } from "../video/src/samples/web-page-journey";

const scene = (input: SceneInput): Scene => VideoPlan.shape.chapters.element.shape.scenes.element.parse(input);

const bullets = (durations: number[], cues: SceneInput["cues"] = []) =>
	scene({
		id: "b",
		type: "bullets",
		props: { items: ["a", "b", "c"] },
		narration: durations.map((d, i) => ({ id: `s${i}`, text: `Sentence ${i}.`, durationMs: d })),
		cues,
	});

describe("plan schema", () => {
	it("accepts the sample plan; the sample and the gallery together use every scene type", () => {
		const plan = VideoPlan.parse(SAMPLE_PLAN);
		const used = new Set([...plan.chapters.flatMap((c) => c.scenes.map((s) => s.type)), ...GALLERY_SCENES.map((s) => s.type)]);
		expect([...used].sort()).toEqual([...SCENE_TYPES].sort());
	});

	it("fills defaults", () => {
		const plan = VideoPlan.parse(SAMPLE_PLAN);
		expect(plan.meta.wordsPerMinute).toBe(150);
		expect(plan.chapters[0]!.scenes[0]!.transition).toEqual({ type: "fade", durationMs: 400 });
		expect(plan.music).toEqual([]);
	});

	it("rejects duplicate scene ids, cues past the narration and bad props", () => {
		const bad = structuredClone(SAMPLE_PLAN);
		bad.chapters[1]!.scenes[0]!.id = "title";
		bad.chapters[0]!.scenes[1]!.cues = [{ at: 9, action: "reveal", target: 0 }];
		const r = VideoPlan.safeParse(bad);
		expect(r.success).toBe(false);
		const msgs = r.error!.issues.map((i) => i.message).join(" | ");
		expect(msgs).toMatch(/duplicate scene id "title"/);
		expect(msgs).toMatch(/cue points at sentence 9/);

		expect(() => scene({ id: "x", type: "flow", props: { steps: [{ label: "only one" }] } })).toThrow();
		expect(() => scene({ id: "x", type: "nope", props: {} } as never)).toThrow();
	});
});

describe("timing", () => {
	const fps = 30;

	it("estimates sentence length from words, with a floor", () => {
		expect(estimateSentenceMs("one two three four five six seven eight nine ten", 150)).toBe(4000);
		expect(estimateSentenceMs("Hi.", 150)).toBe(1200);
		expect(estimateSentenceMs("a, b, c d e f g h i j", 150)).toBe(4000 + 300);
	});

	it("places sentences back to back with gaps, and sizes the scene to fit", () => {
		const t = timeScene(bullets([2000, 3000, 1500]), fps);
		expect(t.sentences.map((s) => s.from)).toEqual([
			msToFrames(LEAD_IN_MS, fps),
			msToFrames(LEAD_IN_MS + 2000 + SENTENCE_GAP_MS, fps),
			msToFrames(LEAD_IN_MS + 2000 + SENTENCE_GAP_MS + 3000 + SENTENCE_GAP_MS, fps),
		]);
		expect(t.sentences.map((s) => s.duration)).toEqual([60, 90, 45]);
		const endOfLast = LEAD_IN_MS + 2000 + 3000 + 1500 + 2 * SENTENCE_GAP_MS;
		expect(t.durationInFrames).toBe(msToFrames(endOfLast + TAIL_MS, fps));
	});

	it("fires cues exactly at sentence boundaries", () => {
		const t = timeScene(
			bullets(
				[2000, 3000, 1500],
				[
					{ at: 0, action: "reveal", target: 0 },
					{ at: 1, action: "reveal", target: 1 },
					{ at: 2, edge: "end", action: "reveal", target: 2 },
					{ at: 1, edge: "start", offsetMs: 500, action: "highlight", target: 1 },
				],
			),
			fps,
		);
		const s = t.sentences;
		expect(cueFrame(t.cues, 0)).toBe(s[0]!.from);
		expect(cueFrame(t.cues, 1)).toBe(s[1]!.from);
		expect(cueFrame(t.cues, 2)).toBe(s[2]!.from + s[2]!.duration);
		expect(cueFrame(t.cues, 1, ["highlight"])).toBe(s[1]!.from + msToFrames(500, fps));
		// Sorted by frame.
		expect(t.cues.map((c) => c.frame)).toEqual([...t.cues.map((c) => c.frame)].sort((a, b) => a - b));
	});

	it("moves cues when a measured voice length replaces an estimate", () => {
		const est = timeScene(scene({ id: "x", type: "bullets", props: { items: ["a", "b"] }, narration: [{ id: "1", text: "Short one." }, { id: "2", text: "Two." }] }), fps);
		const measured = timeScene(
			scene({ id: "x", type: "bullets", props: { items: ["a", "b"] }, narration: [{ id: "1", text: "Short one.", durationMs: 5000 }, { id: "2", text: "Two." }] }),
			fps,
		);
		expect(est.sentences[0]!.estimated).toBe(true);
		expect(measured.sentences[0]!.estimated).toBe(false);
		expect(cueFrame(measured.cues, 1)! - cueFrame(est.cues, 1)!).toBe(msToFrames(5000 - 1200, fps));
	});

	it("spreads default reveals over the sentences when the plan gives none", () => {
		const s = bullets([1000, 1000, 1000]);
		expect(defaultCues(s).map((c) => c.at)).toEqual([0, 1, 2]);
		const t = timeScene(s, fps);
		expect([0, 1, 2].map((i) => cueFrame(t.cues, i))).toEqual(t.sentences.map((x) => x.from));
		// Explicit reveals switch the defaults off.
		expect(defaultCues(bullets([1000], [{ at: 0, action: "reveal", target: 0 }]))).toEqual([]);
		// More items than sentences: several items share a sentence.
		expect(defaultCues(bullets([1000])).map((c) => c.at)).toEqual([0, 0, 0]);
	});

	it("keeps scenes with no narration on screen for a minimum time", () => {
		const t = timeScene(scene({ id: "t", type: "title", props: { title: "Hi" } }), fps);
		expect(t.durationInFrames).toBe(msToFrames(MIN_SCENE_MS, fps));
		const long = timeScene(scene({ id: "t", type: "title", props: { title: "Hi" }, minDurationMs: 9000 }), fps);
		expect(long.durationInFrames).toBe(270);
	});

	it("lays scenes and chapters end to end across the video", () => {
		const plan = VideoPlan.parse(SAMPLE_PLAN);
		const tl = computeTimeline(plan);
		for (let i = 1; i < tl.scenes.length; i++) expect(tl.scenes[i]!.from).toBe(tl.scenes[i - 1]!.from + tl.scenes[i - 1]!.durationInFrames);
		expect(tl.durationInFrames).toBe(tl.scenes.at(-1)!.from + tl.scenes.at(-1)!.durationInFrames);
		expect(tl.chapters.map((c) => c.id)).toEqual(["intro", "finding", "travel", "wrap"]);
		expect(tl.chapters.reduce((a, c) => a + c.durationInFrames, 0)).toBe(tl.durationInFrames);
		expect(sceneAt(tl, tl.scenes[3]!.from)?.scene.id).toBe(tl.scenes[3]!.scene.id);
		// At 60 fps the same plan has twice the frames (within rounding).
		const tl60 = computeTimeline({ ...plan, meta: { ...plan.meta, fps: 60 } });
		expect(Math.abs(tl60.durationInFrames - 2 * tl.durationInFrames)).toBeLessThanOrEqual(tl.scenes.length * 2);
	});
});
