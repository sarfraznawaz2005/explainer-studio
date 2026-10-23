import { z } from "zod";
import { lengthLabel, type TopicRequest } from "@shared/planner";
import type { Source } from "@shared/source";
import { jsonInstructions } from "../ai/structured";
import type { PlannerAi } from "../planner/ai";
import { audienceFor, audienceRules } from "../planner/audience";
import { CONCURRENCY, tokens, type EstimateCall } from "../planner/estimate";
import { SourceBuilder } from "./builder";
import { readMarkdown } from "./markdown";

/**
 * "Make a video about X": the AI writes the learning material itself, as study
 * notes, and the rest of the app treats them like material the user brought.
 * Two steps: plan the sections, then write each section (2 at a time).
 */

/** Notes hold more than the narration needs, so the planner can choose what to keep. */
const NOTES_PER_NARRATION_WORD = 1.6;
const MAX_SECTIONS = 24;

export const AI_NOTES_WARNING = "This material was written by AI from your topic. AI can be wrong: check the facts before you publish.";

/** Words of notes to write in total, from the length and the level's speaking speed. */
export const notesWords = (req: Pick<TopicRequest, "minutes" | "level">) => Math.round(req.minutes * audienceFor(req.level).wordsPerMinute * NOTES_PER_NARRATION_WORD);

/** About one section per 2.5 minutes, at least 2. */
export const sectionCount = (minutes: number) => Math.max(2, Math.min(MAX_SECTIONS, Math.round(minutes / 2.5)));

const line = (max: number) => z.string().trim().min(1).max(max);

export const NotesPlan = z.object({
	title: line(120),
	sections: z
		.array(
			z.object({
				heading: line(120),
				/** What this section must teach, so the writer stays on its part. */
				summary: line(400),
				points: z.array(line(200)).min(1).max(10),
			}),
		)
		.min(1)
		.max(MAX_SECTIONS),
});
export type NotesPlan = z.infer<typeof NotesPlan>;

export const SectionNotes = z.object({ markdown: z.string().trim().min(20).max(60_000) });

const userBrief = (req: TopicRequest) =>
	[`Topic: ${req.topic}`, `Audience: ${req.level}.`, `Video length: about ${lengthLabel(req.minutes)}.`, req.instructions ? `Instructions from the user (follow them):\n${req.instructions}` : ""].filter(Boolean).join("\n");

export function planSystem(req: TopicRequest): string {
	return [
		"You are a subject expert and teacher. You plan study notes on a topic. Later, the notes are turned into an explainer video for the audience below.",
		"",
		audienceRules(audienceFor(req.level)),
		"",
		"How to plan:",
		`- About ${sectionCount(req.minutes)} sections. Order them so each idea builds on the last: what it is and why it matters, the core ideas one by one, a worked example, common mistakes, a short recap.`,
		"- Each section gets a clear heading, a one-sentence summary of what it teaches, and the key points it must cover.",
		"- Teach what is true and widely accepted. Do not invent names, numbers, dates or quotes. For topics that are disputed or still changing, say so.",
		"- Write in English.",
	].join("\n");
}

export function sectionSystem(req: TopicRequest): string {
	return [
		"You are a subject expert and teacher. You write one section of study notes on a topic. Later, the notes are turned into an explainer video for the audience below.",
		"",
		audienceRules(audienceFor(req.level)),
		"",
		"How to write:",
		"- Write Markdown. Do not repeat the section heading. Use ### for any sub-headings.",
		"- Explain each key point with clear paragraphs. Add a concrete example, and use lists, a small table or a code block where they help.",
		"- Be accurate. Do not invent names, numbers, dates or quotes. If something is uncertain or disputed, say so.",
		"- Stay on this section. Other sections cover the rest of the topic.",
		"- Write in English.",
	].join("\n");
}

export function sectionPrompt(req: TopicRequest, plan: NotesPlan, index: number, words: number): string {
	const s = plan.sections[index]!;
	const others = plan.sections.map((x, i) => `${i + 1}. ${x.heading}${i === index ? "  ← this section" : ""}`).join("\n");
	return [
		userBrief(req),
		"",
		`Notes title: ${plan.title}`,
		`All sections:\n${others}`,
		"",
		`Write section ${index + 1}: ${s.heading}`,
		`It teaches: ${s.summary}`,
		`Key points:\n${s.points.map((p) => `- ${p}`).join("\n")}`,
		`Length: about ${words} words.`,
	].join("\n");
}

export type TopicProgress = { step: "plan" | "write"; done: number; total: number };

/** Plans and writes the notes, then reads them into a Source like typed Markdown. */
export async function writeTopicNotes(req: TopicRequest, ai: PlannerAi, opts: { onProgress?: (p: TopicProgress) => void; signal?: AbortSignal } = {}): Promise<Source> {
	opts.onProgress?.({ step: "plan", done: 0, total: 1 });
	const plan = await ai.structured({ schema: NotesPlan, system: planSystem(req), prompt: userBrief(req) }, { slot: "planner", purpose: "topic.plan", maxOutputTokens: 4000 });
	opts.signal?.throwIfAborted();

	const n = plan.sections.length;
	const words = Math.max(150, Math.round(notesWords(req) / n));
	const bodies: string[] = Array(n).fill("");
	let done = 0;
	let next = 0;
	opts.onProgress?.({ step: "write", done, total: n });
	const worker = async () => {
		while (next < n) {
			const i = next++;
			opts.signal?.throwIfAborted();
			const r = await ai.structured(
				{ schema: SectionNotes, system: sectionSystem(req), prompt: sectionPrompt(req, plan, i, words) },
				{ slot: "planner", purpose: "topic.section", maxOutputTokens: Math.round(words * 2.5 + 800) },
			);
			bodies[i] = r.markdown;
			opts.onProgress?.({ step: "write", done: ++done, total: n });
		}
	};
	await Promise.all(Array.from({ length: Math.min(CONCURRENCY, n) }, worker));

	const b = new SourceBuilder();
	b.beginInput({ kind: "text", name: `AI notes: ${req.topic.slice(0, 80)}`, pageCount: null, pages: null, ocr: [] });
	b.heading(plan.title, 1);
	for (let i = 0; i < n; i++) {
		b.heading(plan.sections[i]!.heading, 2);
		// Sub-headings sit under the section, whatever level the model used.
		await readMarkdown(bodies[i]!.replace(/^#{1,2}(?=\s)/gm, "###"), b, async () => null);
	}
	b.warn(AI_NOTES_WARNING);
	return b.build(plan.title);
}

/** The calls writeTopicNotes makes, for the cost and time estimate. */
export function topicCalls(req: TopicRequest): EstimateCall[] {
	const n = sectionCount(req.minutes);
	const words = Math.max(150, Math.round(notesWords(req) / n));
	const planIn = tokens(planSystem(req).length + jsonInstructions(NotesPlan).length + userBrief(req).length);
	// A stand-in plan of the expected size, for the section prompt length.
	const sample: NotesPlan = { title: req.topic.slice(0, 120), sections: Array.from({ length: n }, (_, i) => ({ heading: `Section ${i + 1} heading here`, summary: "x".repeat(150), points: ["x".repeat(80), "x".repeat(80), "x".repeat(80), "x".repeat(80)] })) };
	const sectionIn = tokens(sectionSystem(req).length + jsonInstructions(SectionNotes).length + sectionPrompt(req, sample, 0, words).length);
	return [{ slot: "planner", input: planIn, output: 150 * n + 200 }, ...Array.from({ length: n }, () => ({ slot: "planner" as const, input: sectionIn, output: Math.round(words * 1.4 + 100) }))];
}
