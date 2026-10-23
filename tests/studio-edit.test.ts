import { describe, expect, it } from "vitest";
import type { ModelSlot } from "../src/shared/ipc/ai";
import { convertScene, extractContent, SWAP_TYPES } from "../src/shared/plan/convert";
import { historyOf, pushEdit, redo, redoLabel, undo, undoLabel, type History } from "../src/shared/plan/history";
import { Scene, VideoPlan, type SceneType } from "../src/shared/plan/schema";
import { PlanSettings, type Outline } from "../src/shared/planner";
import type { Source } from "../src/shared/source";
import { mediaPath } from "../src/main/app/media-url";
import { NO_USAGE } from "../src/main/ai/run";
import type { TurnRunner } from "../src/main/ai/structured";
import { plannerAiFromRunner } from "../src/main/planner/ai";
import { canRegenerate, findScene, mergeVoice, regenerateChapter, regenerateScene } from "../src/main/planner/edit";
import { assemblePlan, toScenes, type ChapterContext } from "../src/main/planner/script";
import { GALLERY_SCENES } from "../video/src/samples/gallery";

/* ---------- fixtures ---------- */

const SOURCE: Source = {
	version: 1,
	title: "Sorting",
	inputs: [{ kind: "text", name: "Typed text", pageCount: null, pages: null, ocr: [] }],
	sections: [
		{ id: "s1", heading: "Sorting", level: 2, page: 1, input: 0, blocks: [{ type: "paragraph", text: "Sorting puts data in order, such as ascending or descending." }] },
		{ id: "s2", heading: "Bubble sort", level: 3, page: 2, input: 0, blocks: [{ type: "paragraph", text: "Bubble sort compares neighbours and swaps them when they are in the wrong order." }] },
	],
	figures: [{ id: "f1", file: "source/figures/in1-001.png", caption: "Bars before sorting", page: 2, input: 0, width: 800, height: 600, mediaType: "image/png" }],
	stats: { words: 30, chars: 160 },
	warnings: [],
};
const OUTLINE: Outline = {
	title: "How Bubble Sort Works",
	subtitle: "",
	subject: "Computer Science",
	style: "clean",
	hook: ["How does a computer put things in order?"],
	chapters: [
		{ id: "ch1", title: "What is sorting?", goal: "Say what sorting means.", keyPoints: ["Order"], sources: ["s1"], minutes: 1 },
		{ id: "ch2", title: "Bubble sort", goal: "Explain bubble sort.", keyPoints: ["Swap neighbours"], sources: ["s2"], minutes: 1 },
	],
	terms: [],
	misconceptions: [],
	approved: true,
};
const settings = PlanSettings.parse({ level: "High school" });
const ctx: ChapterContext = { source: SOURCE, outline: OUTLINE, settings, map: null };
const chapter = (n: number) => ({
	intro: `Chapter ${n} shows one idea.`,
	scenes: [
		{ type: "bullets", props: { heading: "Order", items: ["Small to big", "Big to small"] }, narration: ["Sorting puts things in order.", "Small to big is one way."] },
		{ type: "definition", props: { term: "Swap", definition: "Two items change places." }, narration: ["A swap means two items change places."] },
	],
});
const basePlan = () => assemblePlan(OUTLINE, settings, [toScenes(0, chapter(1) as never, OUTLINE), toScenes(1, chapter(2) as never, OUTLINE)]);

/** The plan as voiced: every sentence has a clip and a length. */
function voiced(plan: VideoPlan): VideoPlan {
	return VideoPlan.parse({
		...plan,
		chapters: plan.chapters.map((c) => ({ ...c, scenes: c.scenes.map((s) => ({ ...s, narration: s.narration.map((n, i) => ({ ...n, audio: `${String(i).padStart(32, "a")}.wav`, durationMs: 1500 })) })) })),
	});
}

function fakeAi(answers: Record<string, (prompt: string, attempt: number) => unknown>) {
	const log: { slot: ModelSlot; purpose: string; prompt: string }[] = [];
	const ai = plannerAiFromRunner((slot, purpose): TurnRunner => async ({ messages, attempt }) => {
		const prompt = messages[0]!.content;
		log.push({ slot, purpose, prompt });
		const a = answers[purpose];
		if (!a) throw new Error(`no fake answer for ${purpose}`);
		const v = a(prompt, attempt);
		return { text: typeof v === "string" ? v : JSON.stringify(v), usage: NO_USAGE };
	});
	return { ai, log };
}

const allScenes = (p: VideoPlan) => p.chapters.flatMap((c) => c.scenes);

/* ---------- regenerate ---------- */

describe("regenerate one scene", () => {
	it("replaces only that scene; every other scene stays exactly the same", async () => {
		const plan = voiced(basePlan());
		const before = structuredClone(plan);
		const { ai, log } = fakeAi({
			"plan.scene": () => ({ type: "cycle", props: { heading: "Passes", steps: [{ label: "Compare" }, { label: "Swap" }, { label: "Repeat" }] }, narration: ["Each pass compares.", "Then it swaps.", "And it repeats."] }),
		});
		const next = await regenerateScene(ctx, plan, "ch2-s1", ai, { instructions: "Make it a loop" });
		const target = findScene(next, "ch2-s1")!.scene;
		expect(target.type).toBe("cycle");
		expect(target.narration.map((n) => n.text)).toEqual(["Each pass compares.", "Then it swaps.", "And it repeats."]);
		expect(target.narration.every((n) => !n.audio)).toBe(true);
		for (const s of allScenes(before)) if (s.id !== "ch2-s1") expect(findScene(next, s.id)!.scene).toEqual(s);
		expect(allScenes(next).map((s) => s.id)).toEqual(allScenes(before).map((s) => s.id));
		expect(plan).toEqual(before);
		expect(log[0]!.prompt).toMatch(/Make it a loop/);
		expect(log[0]!.prompt).toMatch(/Bubble sort compares neighbours/);
	});

	it("can ask for a given type, refuses cards and types that do not fit", async () => {
		const plan = basePlan();
		const { ai } = fakeAi({ "plan.scene": () => ({ type: "quiz", props: { questions: [{ question: "Which goes first?", options: ["1", "9"], answer: 0 }] }, narration: ["Which number goes first?", "One does."] }) });
		const next = await regenerateScene(ctx, plan, "ch1-s2", ai, { type: "quiz" });
		expect(findScene(next, "ch1-s2")!.scene.type).toBe("quiz");
		await expect(regenerateScene(ctx, plan, "hook", ai)).rejects.toThrow(/outline/);
		expect(canRegenerate(findScene(plan, "ch1-card")!.scene)).toBe(false);
		const kid: ChapterContext = { ...ctx, settings: PlanSettings.parse({ level: "Kindergarten" }) };
		await expect(regenerateScene(kid, plan, "ch1-s2", ai, { type: "code" })).rejects.toThrow(/does not fit/);
	});

	it("turns a figure id from the AI into the figure file", async () => {
		const plan = basePlan();
		const { ai } = fakeAi({ "plan.scene": () => ({ type: "figure", props: { figure: "f1", callouts: [{ x: 20, y: 30, text: "Tallest bar" }] }, narration: ["Look at the bars."] }) });
		const next = await regenerateScene(ctx, plan, "ch1-s1", ai, { type: "figure" });
		expect(findScene(next, "ch1-s1")!.scene.props).toMatchObject({ figure: "in1-001.png" });
	});
});

describe("regenerate one chapter", () => {
	it("rewrites only that chapter and keeps the hook", async () => {
		const plan = voiced(basePlan());
		const { ai } = fakeAi({
			"plan.script": () => ({ intro: "A new start.", scenes: [{ type: "kinetic", props: { lines: ["Order matters."] }, narration: ["Order matters a lot."] }] }),
			"plan.fact-check": () => ({ issues: [] }),
		});
		const next = await regenerateChapter(ctx, plan, "ch1", ai);
		expect(next.chapters[0]!.scenes.map((s) => s.id)).toEqual(["hook", "ch1-card", "ch1-s1"]);
		expect(next.chapters[0]!.scenes[0]).toEqual(plan.chapters[0]!.scenes[0]);
		expect(next.chapters[1]).toEqual(plan.chapters[1]);
	});
});

/* ---------- save rules ---------- */

describe("saving a Studio edit", () => {
	it("keeps voice clips only for unchanged sentences and never takes clips from the client", () => {
		const stored = voiced(basePlan());
		const edited = structuredClone(stored);
		edited.chapters[0]!.scenes[2]!.narration[0]!.text = "Sorting puts items in a row.";
		// A client that tries to point an unchanged sentence at another clip.
		edited.chapters[1]!.scenes[1]!.narration[0]!.audio = `${"f".repeat(32)}.wav`;
		const merged = mergeVoice(stored, edited);
		const changed = merged.chapters[0]!.scenes[2]!.narration[0]!;
		expect(changed.audio).toBeUndefined();
		expect(changed.durationMs).toBeUndefined();
		expect(merged.chapters[1]!.scenes[1]!.narration[0]!.audio).toBe(stored.chapters[1]!.scenes[1]!.narration[0]!.audio);
		expect(merged.chapters[0]!.scenes[2]!.narration[1]).toEqual(stored.chapters[0]!.scenes[2]!.narration[1]);
	});
});

/* ---------- swap type ---------- */

describe("swap scene type", () => {
	it("converts every gallery scene to every other type and stays valid", () => {
		for (const input of GALLERY_SCENES) {
			const scene = Scene.parse(input);
			for (const type of SWAP_TYPES) {
				const out = convertScene(scene, type);
				expect(Scene.safeParse(out).success, `${scene.type} → ${type}`).toBe(true);
				expect(out.id).toBe(scene.id);
				expect(out.narration).toEqual(scene.narration);
				if (type !== scene.type) expect(out.cues).toEqual([]);
			}
		}
	});

	it("carries the words over", () => {
		const flow = Scene.parse(GALLERY_SCENES.find((s) => s.type === "flow"));
		const bullets = convertScene(flow, "bullets") as Extract<Scene, { type: "bullets" }>;
		expect(bullets.props.items).toEqual(["Light hits", "Water splits", "Sugar forms"]);
		expect(bullets.props.heading).toBe("Inside the leaf");
		const chart = Scene.parse(GALLERY_SCENES.find((s) => s.type === "chart"));
		expect(extractContent(chart).numbers.map((n) => n.value)).toEqual([55, 30, 15]);
		const counter = convertScene(chart, "counter") as Extract<Scene, { type: "counter" }>;
		expect(counter.props.counters.map((c) => c.value)).toEqual([55, 30, 15]);
	});
});

/* ---------- undo / redo ---------- */

describe("undo and redo", () => {
	it("works for 25 edits in a row, and a new edit clears redo", () => {
		let h: History<number> = historyOf(0);
		for (let i = 1; i <= 25; i++) h = pushEdit(h, i, `edit ${i}`);
		expect(h.present).toBe(25);
		expect(undoLabel(h)).toBe("edit 25");
		for (let i = 24; i >= 0; i--) {
			h = undo(h);
			expect(h.present).toBe(i);
		}
		expect(undo(h)).toBe(h);
		for (let i = 1; i <= 25; i++) {
			h = redo(h);
			expect(h.present).toBe(i);
		}
		expect(redoLabel(h)).toBeNull();
		h = undo(undo(h));
		expect(redoLabel(h)).toBe("edit 24");
		h = pushEdit(h, 99, "other");
		expect(h.future).toEqual([]);
		expect(h.present).toBe(99);
	});

	it("keeps the last 100 steps", () => {
		let h: History<number> = historyOf(0);
		for (let i = 1; i <= 130; i++) h = pushEdit(h, i, "e");
		expect(h.past).toHaveLength(100);
		expect(h.past[0]!.state).toBe(30);
	});
});

describe("figure media URLs", () => {
	it("serve only figure files of a draft", () => {
		const roots = { drafts: "C:/d", assets: "C:/a" };
		const id = "0f8fad5b-d9cb-469f-a165-70867728950e";
		expect(mediaPath(`es-media://figure/${id}/in1-003.png`, roots)?.replace(/\\/g, "/")).toBe(`C:/d/${id}/source/figures/in1-003.png`);
		for (const bad of [`es-media://figure/${id}/..%2F..%2Fsecret.png`, `es-media://figure/${id}/a/in1-003.png`, "es-media://figure/x/in1-003.png", `es-media://figure/${id}/notes.txt`, `es-media://figure/${id}/in1-003.png?x=1`]) {
			expect(mediaPath(bad, roots), bad).toBeNull();
		}
	});
});

const _types: SceneType[] = SWAP_TYPES;
void _types;
