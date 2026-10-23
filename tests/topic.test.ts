import { describe, expect, it } from "vitest";
import { lengthLabel, TARGET_MINUTES, TopicRequest } from "../src/shared/planner";
import { sourceText } from "../src/shared/source";
import { NO_USAGE } from "../src/main/ai/run";
import type { TurnRunner } from "../src/main/ai/structured";
import { plannerAiFromRunner } from "../src/main/planner/ai";
import { AI_NOTES_WARNING, notesWords, sectionCount, topicCalls, writeTopicNotes } from "../src/main/ingest/topic";

const REQ = TopicRequest.parse({ topic: "How vaccines train the immune system", level: "High school", minutes: 5, instructions: "Use the flu shot as the example." });

const PLAN = {
	title: "How Vaccines Train the Immune System",
	sections: [
		{ heading: "What a vaccine is", summary: "A vaccine shows the body a harmless copy of a germ.", points: ["Harmless copy", "Memory cells"] },
		{ heading: "The flu shot", summary: "The flu shot as a worked example.", points: ["Changes each year"] },
	],
};

function fakeAi() {
	const log: { purpose: string; prompt: string }[] = [];
	const ai = plannerAiFromRunner((_slot, purpose): TurnRunner => async ({ messages }) => {
		const prompt = messages[0]!.content;
		log.push({ purpose, prompt });
		if (purpose === "topic.plan") return { text: JSON.stringify(PLAN), usage: NO_USAGE };
		const which = /Write section (\d+)/.exec(prompt)![1];
		const markdown = `## Overview ${which}\n\nParagraph for section ${which}. It explains the idea clearly.\n\n- point one\n- point two`;
		return { text: JSON.stringify({ markdown }), usage: NO_USAGE };
	});
	return { ai, log };
}

describe("material from a topic", () => {
	it("plans, writes every section in order, and builds a Source with an AI warning", async () => {
		const { ai, log } = fakeAi();
		const steps: string[] = [];
		const src = await writeTopicNotes(REQ, ai, { onProgress: (p) => steps.push(`${p.step}:${p.done}/${p.total}`) });

		expect(log.map((l) => l.purpose)).toEqual(["topic.plan", "topic.section", "topic.section"]);
		expect(log[0]!.prompt).toContain("Use the flu shot as the example.");
		expect(src.title).toBe(PLAN.title);
		const headings = src.sections.filter((s) => s.heading).map((s) => [s.heading, s.level]);
		// Section headings at level 2; the model's own "##" sits below them.
		expect(headings).toEqual([
			[PLAN.title, 1],
			["What a vaccine is", 2],
			["Overview 1", 3],
			["The flu shot", 2],
			["Overview 2", 3],
		]);
		expect(sourceText(src)).toContain("Paragraph for section 2.");
		expect(src.stats.words).toBeGreaterThan(10);
		expect(src.warnings).toEqual([AI_NOTES_WARNING]);
		expect(src.inputs[0]!.kind).toBe("text");
		expect(steps.at(-1)).toBe("write:2/2");
	});

	it("stops when cancelled", async () => {
		const { ai } = fakeAi();
		const abort = new AbortController();
		abort.abort(new Error("Cancelled"));
		await expect(writeTopicNotes(REQ, ai, { signal: abort.signal })).rejects.toThrow();
	});

	it("scales sections and the estimate with the length", () => {
		expect(sectionCount(1)).toBe(2);
		expect(sectionCount(10)).toBe(4);
		expect(sectionCount(60)).toBe(24);
		expect(notesWords({ minutes: 10, level: "High school" })).toBeGreaterThan(notesWords({ minutes: 5, level: "High school" }));
		const calls = topicCalls({ ...REQ, minutes: 20 });
		expect(calls).toHaveLength(1 + sectionCount(20));
		expect(calls.every((c) => c.slot === "planner" && c.input > 0 && c.output > 0)).toBe(true);
	});

	it("rejects an empty topic", () => {
		expect(TopicRequest.safeParse({ topic: " ", level: "High school", minutes: 5 }).success).toBe(false);
	});

	it("offers short lengths like 1 min 20 s", () => {
		expect(TARGET_MINUTES.map(lengthLabel).slice(0, 5)).toEqual(["30 seconds", "45 seconds", "1 minute", "1 min 20 s", "1 min 30 s"]);
		expect(lengthLabel(5)).toBe("5 minutes");
		expect(TopicRequest.safeParse({ topic: "Gravity", level: "Primary", minutes: 80 / 60 }).success).toBe(true);
	});
});
