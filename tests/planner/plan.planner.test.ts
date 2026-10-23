import { describe, expect, it } from "vitest";
import type { ModelSlot } from "../../src/shared/ipc/ai";
import { VideoPlan, type Scene } from "../../src/shared/plan/schema";
import { PlanSettings } from "../../src/shared/planner";
import type { Source } from "../../src/shared/source";
import { createProviderAdapter } from "../../src/main/ai/providers";
import { runText } from "../../src/main/ai/run";
import type { TurnRunner } from "../../src/main/ai/structured";
import { plannerAiFromRunner } from "../../src/main/planner/ai";
import { AUDIENCES } from "../../src/main/planner/audience";
import { factCheck, words } from "../../src/main/planner/checks";
import { sourceForPrompt } from "../../src/main/planner/knowledge";
import { generateOutline } from "../../src/main/planner/outline";
import { generatePlan } from "../../src/main/planner/run";

/**
 * The planner with a real model: Claude through the local Claude Code CLI login
 * (claude-subscription provider). Set EXPLAINER_PLANNER_MODEL to try another Claude model.
 */
const MODEL = process.env.EXPLAINER_PLANNER_MODEL ?? "claude-sonnet-5-5";
const adapter = createProviderAdapter({ id: "test", name: "Claude subscription", kind: "claude-subscription", apiKey: "", baseUrl: null, defaultModel: null });
const calls: { slot: ModelSlot; purpose: string; ms: number; ok: boolean }[] = [];
const ai = plannerAiFromRunner(
	(slot, purpose): TurnRunner =>
		async ({ system, messages }) => {
			const t0 = Date.now();
			try {
				const r = await runText(adapter, { modelId: MODEL, system, messages, maxOutputTokens: 16_000 });
				calls.push({ slot, purpose, ms: Date.now() - t0, ok: true });
				return r;
			} catch (err) {
				calls.push({ slot, purpose, ms: Date.now() - t0, ok: false });
				throw err;
			}
		},
);

/** A textbook section on bubble sort (paraphrased from Computer Science XI, 2.3). */
const SOURCE: Source = {
	version: 1,
	title: "Sorting and Bubble Sort",
	inputs: [{ kind: "text", name: "Typed text", pageCount: null, pages: null, ocr: [] }],
	sections: [
		{
			id: "s1",
			heading: "2.3 Sorting",
			level: 2,
			page: 81,
			input: 0,
			blocks: [
				{ type: "paragraph", text: "Sorting is the process of arranging data in a particular order. The order can be ascending (smallest to largest) or descending (largest to smallest)." },
				{ type: "paragraph", text: "Sorted data is easier to search and to read. For example, a dictionary keeps words in alphabetical order so that a word can be found quickly." },
			],
		},
		{
			id: "s2",
			heading: "2.3.1 Bubble Sort",
			level: 3,
			page: 82,
			input: 0,
			blocks: [
				{
					type: "paragraph",
					text: "Bubble sort is a simple sorting algorithm. It compares two neighbouring elements of a list and swaps them if they are in the wrong order. One complete run over the list is called a pass. After each pass, the largest remaining element moves to its correct place at the end, like a bubble rising to the surface. Passes are repeated until a pass makes no swaps.",
				},
				{ type: "paragraph", text: "Example: sort the list 5, 1, 4, 2 in ascending order. Pass 1: compare 5 and 1, swap → 1, 5, 4, 2. Compare 5 and 4, swap → 1, 4, 5, 2. Compare 5 and 2, swap → 1, 4, 2, 5. Pass 2: 1 and 4 stay; compare 4 and 2, swap → 1, 2, 4, 5. Pass 3 makes no swaps, so the list is sorted." },
				{ type: "list", ordered: true, items: ["Step 1: Start with the first element.", "Step 2: Compare it with the next element.", "Step 3: If the first is greater, swap them.", "Step 4: Move to the next pair and repeat until the end of the list.", "Step 5: Repeat the passes until no swaps are made."] },
				{ type: "code", text: "procedure bubbleSort(A, n)\n  repeat\n    swapped = false\n    for i = 1 to n - 1\n      if A[i] > A[i + 1] then\n        swap A[i] and A[i + 1]\n        swapped = true\n  until swapped = false" },
				{ type: "paragraph", text: "Bubble sort is easy to understand but slow for long lists, because it may need many passes. For a list of n elements it can need about n × n comparisons." },
			],
		},
	],
	figures: [],
	stats: { words: 330, chars: 1900 },
	warnings: [],
};

const scene = (id: string, texts: string[]): Scene =>
	({ id, type: "bullets", props: { items: ["Compare", "Swap"] }, narration: texts.map((text, i) => ({ id: `${id}-n${i + 1}`, text })), cues: [], transition: { type: "fade", durationMs: 400 } }) as Scene;

function stats(plan: VideoPlan) {
	const sentences = plan.chapters.flatMap((c) => c.scenes.flatMap((s) => s.narration.map((n) => n.text)));
	const types = plan.chapters.flatMap((c) => c.scenes.map((s) => s.type));
	return {
		wpm: plan.meta.wordsPerMinute,
		chapters: plan.chapters.length,
		scenes: types.length,
		sentences: sentences.length,
		avgWords: sentences.reduce((n, s) => n + words(s).length, 0) / sentences.length,
		maxWords: Math.max(...sentences.map((s) => words(s).length)),
		types: [...new Set(types)].sort(),
		longWords: sentences.flatMap((s) => words(s)).filter((w) => w.length >= 10).length / sentences.length,
	};
}

describe("planner with Claude (Claude Code CLI)", () => {
	it("fact check flags a planted unsupported claim", async () => {
		const scenes = [
			scene("ch2-s1", [
				"Bubble sort compares two neighbouring elements and swaps them if they are in the wrong order.",
				"Bubble sort was invented by Alan Turing in 1936 and is the fastest sorting method ever made.",
				"One complete run over the list is called a pass.",
			]),
			scene("ch2-s2", ["Imagine bubbles rising in a glass of water.", "After each pass, the largest remaining element moves to the end."]),
		];
		const t0 = Date.now();
		const issues = await factCheck(scenes, sourceForPrompt(SOURCE), ai);
		console.log(`fact check (${Math.round((Date.now() - t0) / 1000)} s):`, JSON.stringify(issues, null, 1));
		expect(issues.map((i) => i.ref)).toContain("ch2-s1-n2");
		// Supported sentences and the framed analogy are not flagged.
		expect(issues.map((i) => i.ref)).not.toContain("ch2-s1-n1");
		expect(issues.map((i) => i.ref)).not.toContain("ch2-s1-n3");
		expect(issues.map((i) => i.ref)).not.toContain("ch2-s2-n2");
	});

	it("Kindergarten and University runs of the same topic differ in pace, words and scene choice", async () => {
		const run = async (level: PlanSettings["level"]) => {
			const settings = PlanSettings.parse({ level, targetMinutes: 3 });
			const t0 = Date.now();
			const { outline } = await generateOutline(SOURCE, settings, ai);
			const t1 = Date.now();
			const { plan, report } = await generatePlan({ source: SOURCE, outline: { ...outline, approved: true }, settings, map: null }, ai);
			console.log(
				`\n===== ${level}: outline ${Math.round((t1 - t0) / 1000)} s, script ${Math.round((Date.now() - t1) / 1000)} s\n` +
					`outline: ${outline.title} | style ${outline.style} | hook: ${outline.hook.join(" ")}\n` +
					`chapters: ${outline.chapters.map((c) => `${c.title} (${c.minutes} min)`).join(" | ")}\n` +
					`report: facts ${report.fact.issues.length} (${report.fact.issues.filter((i) => i.status === "fixed").length} fixed), level ${report.level.issues.length} (open ${report.level.issues.filter((i) => i.status === "open").length}), pacing ${report.pacing.issues.length}, est ${report.estimateMinutes} min\n` +
					`sample narration: ${plan.chapters[1]?.scenes[1]?.narration.map((n) => n.text).join(" ") ?? ""}`,
			);
			expect(VideoPlan.safeParse(plan).success).toBe(true);
			return { plan, report, s: stats(plan) };
		};
		const [kg, uni] = await Promise.all([run("Kindergarten"), run("University")]);
		console.log("\nKindergarten:", JSON.stringify(kg.s), "\nUniversity:", JSON.stringify(uni.s));
		console.log(`calls: ${calls.length}, failed ${calls.filter((c) => !c.ok).length}, by purpose ${JSON.stringify(calls.reduce<Record<string, number>>((m, c) => ({ ...m, [c.purpose]: (m[c.purpose] ?? 0) + 1 }), {}))}`);

		// Pace
		expect(kg.s.wpm).toBeLessThan(uni.s.wpm);
		// Vocabulary and sentence length
		expect(kg.s.avgWords).toBeLessThan(uni.s.avgWords);
		expect(kg.s.avgWords).toBeLessThanOrEqual(AUDIENCES.Kindergarten.maxSentenceWords);
		expect(kg.s.longWords).toBeLessThan(uni.s.longWords);
		// Scene choice: never code or charts for kindergarten; the two runs use different scene types.
		expect(kg.s.types).not.toContain("code");
		expect(kg.s.types).not.toContain("chart");
		expect(uni.s.types.join()).not.toBe(kg.s.types.join());
		// The hook stays short.
		expect(kg.report.pacing.issues.some((i) => i.kind === "hook")).toBe(false);
	});
});
