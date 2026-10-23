import { describe, expect, it } from "vitest";
import type { ModelSlot } from "../src/shared/ipc/ai";
import { VideoPlan, type Scene } from "../src/shared/plan/schema";
import { PlanSettings, type Outline } from "../src/shared/planner";
import type { Source } from "../src/shared/source";
import { NO_USAGE } from "../src/main/ai/run";
import type { TurnRunner } from "../src/main/ai/structured";
import { plannerAiFromRunner } from "../src/main/planner/ai";
import { AUDIENCES } from "../src/main/planner/audience";
import { factCheck, levelCheck, pacingCheck, splitSentences, syllables } from "../src/main/planner/checks";
import { billingOf, outlineCalls, priceEstimate, scriptCalls, type SlotTarget } from "../src/main/planner/estimate";
import { chunkSections, needsMap, sourceForPrompt } from "../src/main/planner/knowledge";
import { finishOutline, generateOutline } from "../src/main/planner/outline";
import { generatePlan, planChapter } from "../src/main/planner/run";
import { aiSceneSchema, assemblePlan, contentTypes, scriptPrompt, scriptSystem, toScenes, writeChapter, type ChapterContext } from "../src/main/planner/script";

/* ---------- fixtures ---------- */

const SOURCE: Source = {
	version: 1,
	title: "Sorting",
	inputs: [{ kind: "text", name: "Typed text", pageCount: null, pages: null, ocr: [] }],
	sections: [
		{ id: "s1", heading: "2.3 Sorting", level: 2, page: 81, input: 0, blocks: [{ type: "paragraph", text: "Sorting puts data in order, such as ascending or descending." }] },
		{
			id: "s2",
			heading: "2.3.1 Bubble Sort",
			level: 3,
			page: 82,
			input: 0,
			blocks: [
				{ type: "paragraph", text: "Bubble sort compares neighbouring elements and swaps them when they are in the wrong order. It repeats passes until no swaps happen." },
				{ type: "code", text: "for i in range(n):\n  for j in range(n-1):\n    if a[j] > a[j+1]: swap" },
			],
		},
	],
	figures: [],
	stats: { words: 45, chars: 260 },
	warnings: [],
};

const settings = (level: PlanSettings["level"], extra: Partial<PlanSettings> = {}) => PlanSettings.parse({ level, ...extra });

const OUTLINE: Outline = {
	title: "How Bubble Sort Works",
	subtitle: "Putting data in order, one swap at a time",
	subject: "Computer Science",
	style: "chalkboard",
	hook: ["Your music app sorts a thousand songs in a blink.", "How does a computer put things in order?"],
	chapters: [
		{ id: "ch1", title: "What is sorting?", goal: "Say what sorting means.", keyPoints: ["Order", "Ascending and descending"], sources: ["s1"], minutes: 1 },
		{ id: "ch2", title: "Bubble sort", goal: "Explain how bubble sort swaps neighbours.", keyPoints: ["Compare neighbours", "Swap", "Repeat passes"], sources: ["s2"], minutes: 2 },
	],
	terms: ["sorting", "bubble sort"],
	misconceptions: [],
	approved: true,
};

const ctxFor = (level: PlanSettings["level"]): ChapterContext => ({ source: SOURCE, outline: OUTLINE, settings: settings(level), map: null });

/** A turn runner that answers per purpose; `log` records every call. */
function fakeAi(answers: Record<string, (prompt: string, attempt: number) => unknown>) {
	const log: { slot: ModelSlot; purpose: string; attempt: number; prompt: string }[] = [];
	const ai = plannerAiFromRunner((slot, purpose): TurnRunner => async ({ messages, attempt }) => {
		const prompt = messages[0]!.content;
		log.push({ slot, purpose, attempt, prompt });
		const a = answers[purpose];
		if (!a) throw new Error(`no fake answer for ${purpose}`);
		const v = a(prompt, attempt);
		return { text: typeof v === "string" ? v : JSON.stringify(v), usage: NO_USAGE };
	});
	return { ai, log };
}

const goodChapter = (n: number) => ({
	intro: `Chapter ${n} shows one idea.`,
	scenes: [
		{ type: "bullets", props: { heading: "Order", items: ["Small to big", "Big to small"] }, narration: ["Sorting puts things in order.", "Small to big is one way.", "Big to small is another."] },
		{ type: "definition", props: { term: "Swap", definition: "Two items change places." }, narration: ["A swap means two items change places.", "Bubble sort swaps neighbours."] },
	],
});

/* ---------- audience and scene choice ---------- */

describe("audience levels", () => {
	it("young levels never get code or charts; advanced levels can", () => {
		expect(contentTypes(AUDIENCES.Kindergarten)).not.toContain("code");
		expect(contentTypes(AUDIENCES.Kindergarten)).not.toContain("chart");
		expect(contentTypes(AUDIENCES.University)).toEqual(expect.arrayContaining(["code", "chart", "flow"]));
		const kg = aiSceneSchema(AUDIENCES.Kindergarten);
		expect(kg.safeParse({ type: "code", props: { code: "x = 1" }, narration: ["Hi."] }).success).toBe(false);
		expect(aiSceneSchema(AUDIENCES.University).safeParse({ type: "code", props: { code: "x = 1" }, narration: ["Hi."] }).success).toBe(true);
	});

	it("limits items on one screen by level", () => {
		const bullets = (n: number) => ({ type: "bullets", props: { items: Array.from({ length: n }, (_, i) => `Item ${i}`) }, narration: ["One."] });
		expect(aiSceneSchema(AUDIENCES.Kindergarten).safeParse(bullets(4)).success).toBe(false);
		expect(aiSceneSchema(AUDIENCES.Kindergarten).safeParse(bullets(3)).success).toBe(true);
		expect(aiSceneSchema(AUDIENCES.PhD).safeParse(bullets(8)).success).toBe(true);
	});

	it("pace and sentence length grow with the level", () => {
		const order = ["Kindergarten", "Primary", "Middle school", "High school", "College", "University", "PhD"] as const;
		for (let i = 1; i < order.length; i++) {
			expect(AUDIENCES[order[i]!].wordsPerMinute).toBeGreaterThan(AUDIENCES[order[i - 1]!].wordsPerMinute);
			expect(AUDIENCES[order[i]!].maxSentenceWords).toBeGreaterThan(AUDIENCES[order[i - 1]!].maxSentenceWords);
		}
	});
});

/* ---------- outline ---------- */

describe("outline", () => {
	it("gives chapters ids, drops unknown section ids and fits minutes to the target", () => {
		const raw = { ...OUTLINE, style: "clean" as const, chapters: OUTLINE.chapters.map(({ id: _id, ...c }) => ({ ...c, sources: [...c.sources, "s99"], minutes: 10 })) };
		const o = finishOutline(raw, SOURCE, settings("High school", { targetMinutes: 5 }));
		expect(o.chapters.map((c) => c.id)).toEqual(["ch1", "ch2"]);
		expect(o.chapters.flatMap((c) => c.sources)).toEqual(["s1", "s2"]);
		expect(o.chapters.reduce((n, c) => n + c.minutes, 0)).toBeCloseTo(5, 0);
		expect(o.approved).toBe(false);
	});

	it("plans short sources from the full text, long ones from a knowledge map", async () => {
		const { ai, log } = fakeAi({ "plan.outline": () => ({ ...OUTLINE, chapters: OUTLINE.chapters.map(({ id: _id, ...c }) => c) }) });
		await generateOutline(SOURCE, settings("Primary"), ai);
		expect(log.map((l) => l.purpose)).toEqual(["plan.outline"]);
		expect(log[0]!.prompt).toContain("[s2] ### 2.3.1 Bubble Sort (page 82)");

		const para = "Bubble sort compares neighbours and swaps them. ".repeat(60);
		const big: Source = {
			...SOURCE,
			sections: Array.from({ length: 30 }, (_, i) => ({ id: `s${i + 1}`, heading: `Part ${i + 1}`, level: 2, page: null, input: 0, blocks: [{ type: "paragraph" as const, text: para }] })),
			stats: { words: 30 * 480, chars: 30 * para.length },
		};
		expect(needsMap(big)).toBe(true);
		const chunks = chunkSections(big);
		expect(chunks.length).toBeGreaterThan(2);
		const fake = fakeAi({
			"plan.map": () => ({ points: [{ section: "s1", text: "Bubble sort swaps neighbours." }] }),
			"plan.outline": () => ({ ...OUTLINE, chapters: OUTLINE.chapters.map(({ id: _id, ...c }) => c) }),
		});
		const progress: string[] = [];
		const r = await generateOutline(big, settings("Primary"), fake.ai, (p) => progress.push(`${p.step}:${p.done}/${p.total}`));
		expect(fake.log.filter((l) => l.purpose === "plan.map")).toHaveLength(chunks.length);
		expect(fake.log.filter((l) => l.purpose === "plan.map").every((l) => l.slot === "cheap")).toBe(true);
		expect(fake.log.at(-1)!.prompt).toContain("Knowledge map");
		expect(r.map).toHaveLength(chunks.length);
		expect(progress[0]).toBe(`map:0/${chunks.length}`);
	});
});

/* ---------- script, repair and plan ---------- */

describe("chapter script", () => {
	it("repairs an invalid reply: a scene type the level does not allow", async () => {
		const bad = { ...goodChapter(1), scenes: [{ type: "code", props: { code: "x = 1" }, narration: ["Look at the code."] }] };
		const { ai, log } = fakeAi({ "plan.script": (_p, attempt) => (attempt === 1 ? bad : goodChapter(1)) });
		const scenes = await writeChapter(ctxFor("Kindergarten"), 0, ai);
		expect(log.map((l) => l.attempt)).toEqual([1, 2]);
		expect(scenes.map((s) => s.type)).toEqual(["chapter", "bullets", "definition"]);
	});

	it("repairs a reply that is not JSON at all", async () => {
		const { ai, log } = fakeAi({ "plan.script": (_p, attempt) => (attempt === 1 ? "Sure! Here is the chapter: scenes coming soon" : goodChapter(1)) });
		await writeChapter(ctxFor("High school"), 0, ai);
		expect(log).toHaveLength(2);
	});

	it("reports clearly when the reply stays invalid after 2 repairs", async () => {
		const { ai, log } = fakeAi({ "plan.script": () => ({ intro: "Hi.", scenes: [] }) });
		const err = (await writeChapter(ctxFor("High school"), 1, ai).catch((e: unknown) => e)) as Error;
		expect(log).toHaveLength(3);
		expect(err.name).toBe("PlannerError");
		expect(err.message).toMatch(/^Chapter 2 \("Bubble sort"\): The AI reply did not match the expected format after 3 tries\. First problem: scenes/);
	});

	it("adds ids and chapter cards, fixes code line ranges and builds a valid plan with the hook first", () => {
		const script = {
			intro: "Now the code.",
			scenes: [{ type: "code" as const, props: { language: "python", code: "a = 1\nb = 2", steps: [{ lines: [2, 9] as [number, number] }, { lines: [5, 1] as [number, number] }] }, narration: ["One.", "Two."] }],
		};
		const ch1 = toScenes(0, goodChapter(1) as never, OUTLINE);
		const ch2 = toScenes(1, script as never, OUTLINE);
		expect(ch2[1]!.type === "code" && ch2[1]!.props.steps.map((s) => s.lines)).toEqual([
			[2, 2],
			[2, 2],
		]);
		const plan = assemblePlan(OUTLINE, settings("Kindergarten"), [ch1, ch2]);
		expect(VideoPlan.safeParse(plan).success).toBe(true);
		const first = plan.chapters[0]!.scenes;
		expect(first[0]).toMatchObject({ id: "hook", type: "title", props: { title: "How Bubble Sort Works", kicker: "Computer Science · Kindergarten" } });
		expect(first[0]!.narration.map((n) => n.text)).toEqual(OUTLINE.hook);
		expect(first[1]).toMatchObject({ id: "ch1-card", type: "chapter", props: { number: 1 } });
		expect(plan.meta).toMatchObject({ level: "Kindergarten", style: "chalkboard", wordsPerMinute: AUDIENCES.Kindergarten.wordsPerMinute });
		expect(assemblePlan(OUTLINE, settings("PhD", { style: "clean" }), [ch1, ch2]).meta).toMatchObject({ style: "clean", wordsPerMinute: 170 });
	});

	it("tells the model the level's scene types, sentence limit and word budget", () => {
		const kg = scriptSystem(settings("Kindergarten"));
		expect(kg).toContain("at most 8 words each");
		expect(kg).not.toMatch(/^- code /m);
		expect(scriptSystem(settings("University"))).toMatch(/^- code /m);
		const p = scriptPrompt(ctxFor("Kindergarten"), 1);
		expect(p).toContain(`about ${Math.round(2 * AUDIENCES.Kindergarten.wordsPerMinute * 0.8)} words`);
		expect(p).toContain("[s2] ### 2.3.1 Bubble Sort");
		expect(p).not.toContain("[s1]");
		expect(p).toContain("last chapter");
	});
});

/* ---------- quality passes ---------- */

const scene = (id: string, texts: string[], extra: Partial<Scene> = {}): Scene =>
	({
		id,
		type: "bullets",
		props: { items: ["A", "B"] },
		narration: texts.map((text, i) => ({ id: `${id}-n${i + 1}`, text })),
		cues: [],
		transition: { type: "fade", durationMs: 400 },
		...extra,
	}) as Scene;

describe("level check", () => {
	it("flags long sentences, banned words and hard words for young viewers", () => {
		const scenes = [scene("a", ["Obviously the computer simply compares every neighbouring element repeatedly until finished.", "Big comes first."])];
		const kg = levelCheck(scenes, AUDIENCES.Kindergarten);
		expect(kg.map((i) => i.kind).sort()).toEqual(["banned", "hard", "long"]);
		expect(kg.find((i) => i.kind === "hard")!.detail).toMatch(/repeatedly/);
		const uni = levelCheck(scenes, AUDIENCES.University);
		expect(uni.map((i) => i.kind)).toEqual(["banned"]);
		expect(syllables("computer")).toBe(3);
		expect(syllables("cat")).toBe(1);
	});

	it("never calls a key term a hard word", () => {
		const scenes = [scene("a", ["Photosynthesis makes food for the plant."])];
		expect(levelCheck(scenes, AUDIENCES.Primary).some((i) => i.kind === "hard")).toBe(true);
		expect(levelCheck(scenes, AUDIENCES.Primary, { terms: ["photosynthesis"] }).some((i) => i.kind === "hard")).toBe(false);
	});
});

describe("pacing check", () => {
	it("flags a long hook, a dense scene and an empty scene", () => {
		const long = Array.from({ length: 14 }, () => "This sentence has quite a few words in it so it takes a while to say out loud.");
		const plan = VideoPlan.parse({
			version: 1,
			meta: { title: "T", level: "Kindergarten", wordsPerMinute: 115 },
			chapters: [
				{
					id: "c1",
					title: "C",
					scenes: [
						scene("hook", ["One two three four five six seven eight nine ten eleven twelve.", "One two three four five six seven eight nine ten eleven twelve.", "One two three four five six seven eight nine ten."], {
							type: "title",
							props: { title: "T" },
						} as Partial<Scene>),
						scene("dense", long),
						scene("empty", ["Hi."]),
						scene("ok", ["Sorting puts things in order.", "Small numbers go first.", "Big numbers go last."]),
					],
				},
			],
		});
		const issues = pacingCheck(plan, AUDIENCES.Kindergarten);
		expect(issues.map((i) => `${i.sceneId}:${i.kind}`)).toEqual(["hook:hook", "dense:dense", "empty:empty"]);
	});
});

describe("fact check", () => {
	const planted = [scene("ch2-s1", ["Bubble sort swaps neighbours that are in the wrong order.", "Bubble sort was invented by Alan Turing in 1936."])];

	it("keeps issues on real sentence ids and drops made-up ones", async () => {
		const { ai, log } = fakeAi({
			"plan.fact-check": () => ({
				issues: [
					{ ref: "[ch2-s1-n2]", claim: "Invented by Alan Turing in 1936", problem: "unsupported", note: "The source does not say who invented it." },
					{ ref: "ch9-s9-n9", claim: "x", problem: "unsupported", note: "" },
				],
			}),
		});
		const issues = await factCheck(planted, sourceForPrompt(SOURCE), ai);
		expect(log[0]!.prompt).toContain("[ch2-s1-n2] Bubble sort was invented by Alan Turing in 1936.");
		expect(log[0]!.slot).toBe("planner");
		expect(issues).toEqual([expect.objectContaining({ ref: "ch2-s1-n2", sceneId: "ch2-s1", problem: "unsupported", status: "open" })]);
	});

	it("sends flagged sentences back once and marks them fixed", async () => {
		const { ai, log } = fakeAi({
			"plan.script": () => ({
				intro: "Now bubble sort.",
				scenes: [{ type: "bullets", props: { items: ["Compare", "Swap"] }, narration: ["Bubble sort compares neighbours.", "Bubble sort was invented by Alan Turing in 1936.", "It repeats passes."] }],
			}),
			"plan.fact-check": (p) => ({ issues: p.includes("Alan Turing") ? [{ ref: "ch2-s1-n2", claim: "Alan Turing invented it in 1936", problem: "unsupported", note: "Not in the source." }] : [] }),
			"plan.revise": () => ({ edits: [{ ref: "ch2-s1-n2", text: "It swaps them when they are in the wrong order." }] }),
		});
		const r = await planChapter(ctxFor("High school"), 1, ai);
		expect(log.map((l) => l.purpose)).toEqual(["plan.script", "plan.fact-check", "plan.revise"]);
		expect(r.facts).toEqual([expect.objectContaining({ status: "fixed", fixed: "It swaps them when they are in the wrong order." })]);
		expect(r.scenes[1]!.narration.map((n) => n.text)).not.toContain("Bubble sort was invented by Alan Turing in 1936.");
	});

	it("splits a fixed sentence that came back as two into two narration lines", async () => {
		expect(splitSentences("Swap them. Then go on! e.g. 3.5 stays.")).toEqual(["Swap them.", "Then go on! e.g. 3.5 stays."]);
		const { ai } = fakeAi({
			"plan.script": () => ({ intro: "Now bubble sort.", scenes: [{ type: "bullets", props: { items: ["Compare", "Swap"] }, narration: ["Bubble sort compares every neighbouring pair of numbers and then swaps them when the order is wrong.", "It repeats."] }] }),
			"plan.fact-check": () => ({ issues: [] }),
			"plan.revise": () => ({ edits: [{ ref: "ch2-s1-n1", text: "Bubble sort compares neighbours. It swaps them when the order is wrong." }] }),
		});
		const r = await planChapter(ctxFor("Primary"), 1, ai);
		expect(r.scenes[1]!.narration).toEqual([
			{ id: "ch2-s1-n1", text: "Bubble sort compares neighbours." },
			{ id: "ch2-s1-n1-r1", text: "It swaps them when the order is wrong." },
			{ id: "ch2-s1-n2", text: "It repeats." },
		]);
		expect(r.level.find((l) => l.ref === "ch2-s1-n1" && l.kind === "long")?.status).toBe("fixed");
	});
});

/* ---------- whole run ---------- */

describe("generatePlan", () => {
	it("writes every chapter, checks it and returns a valid plan and a report", async () => {
		const { ai, log } = fakeAi({
			"plan.script": (p) => goodChapter(p.includes("Write chapter 2") ? 2 : 1),
			"plan.fact-check": () => ({ issues: [] }),
		});
		const progress: string[] = [];
		const { plan, report } = await generatePlan(ctxFor("Primary"), ai, { onProgress: (p) => progress.push(p.chapters.join(",")) });
		expect(VideoPlan.safeParse(plan).success).toBe(true);
		expect(plan.chapters).toHaveLength(2);
		expect(log.filter((l) => l.purpose === "plan.script")).toHaveLength(2);
		expect(report.fact.checked).toBe(12);
		expect(report.fact.issues).toEqual([]);
		expect(report.level.maxWords).toBe(10);
		expect(report.estimateMinutes).toBeGreaterThan(0);
		expect(progress.at(-1)).toBe("done,done");
	});
});

/* ---------- estimate ---------- */

describe("cost estimate", () => {
	const t = (kind: SlotTarget["kind"], price: SlotTarget["price"]): SlotTarget => ({ provider: "P", kind, model: "m", price });

	it("knows how each provider is paid", () => {
		expect(billingOf(t("ollama", null))).toBe("free");
		expect(billingOf(t("claude-subscription", { input: 3, output: 15 }))).toBe("subscription");
		expect(billingOf(t("opencode", { input: 0, output: 0 }))).toBe("free");
		expect(billingOf(t("anthropic", { input: 3, output: 15 }))).toBe("api");
		expect(billingOf(t("custom", null))).toBe("unknown");
	});

	it("prices the real prompts and asks for confirmation only for paid runs", () => {
		const calls = outlineCalls(SOURCE, settings("High school"));
		expect(calls).toHaveLength(1);
		expect(calls[0]!.input).toBeGreaterThan(500);
		const paid = priceEstimate("outline", calls, () => t("anthropic", { input: 3, output: 15 }));
		expect(paid.needsConfirm).toBe(true);
		expect(paid.costUsd!.low).toBeCloseTo((calls[0]!.input * 3 + calls[0]!.output * 15) / 1e6, 6);
		expect(paid.costUsd!.high).toBeGreaterThan(paid.costUsd!.low);
		expect(priceEstimate("outline", calls, () => t("claude-subscription", { input: 3, output: 15 })).needsConfirm).toBe(false);
		expect(priceEstimate("outline", calls, () => t("ollama", null))).toMatchObject({ needsConfirm: false, costUsd: { low: 0, high: 0 } });
		expect(priceEstimate("outline", calls, () => t("custom", null))).toMatchObject({ needsConfirm: true, costUsd: null, billing: "unknown" });
	});

	it("counts a write and a fact check per chapter, with revise calls only in the high end", () => {
		const calls = scriptCalls(ctxFor("University"));
		expect(calls).toHaveLength(6);
		const e = priceEstimate("script", calls, () => t("anthropic", { input: 3, output: 15 }));
		expect(e.calls).toBe(4);
		expect(e.seconds.high).toBeGreaterThan(e.seconds.low);
		// Chapter 2 is twice as long, so it asks for more output.
		expect(calls[3]!.output).toBeGreaterThan(calls[0]!.output);
	});
});
