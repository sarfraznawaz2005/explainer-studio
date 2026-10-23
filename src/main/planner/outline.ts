import { z } from "zod";
import { languageLabel, Outline, OutlineChapter, type PlanSettings } from "@shared/planner";
import { StyleId } from "@shared/plan/schema";
import type { Source } from "@shared/source";
import type { PlannerAi } from "./ai";
import { audienceFor, audienceRules } from "./audience";
import { buildKnowledgeMap, mapForPrompt, needsMap, sourceForPrompt, type KnowledgeChunk } from "./knowledge";

/** The outline as the model writes it: no ids, no approval flag. */
export const AiOutline = Outline.omit({ approved: true, chapters: true }).extend({
	chapters: z.array(OutlineChapter.omit({ id: true })).min(1).max(40),
	/** "brand" is the user's own choice, never the AI's. */
	style: StyleId.exclude(["brand"]).default("clean"),
});

/** Words of narration the video should have, or null for "as long as needed". */
export const targetWords = (s: PlanSettings) => (s.targetMinutes ? Math.round(s.targetMinutes * audienceFor(s.level).wordsPerMinute) : null);

export function outlineSystem(s: PlanSettings): string {
	const a = audienceFor(s.level);
	return [
		"You plan long-form YouTube explainer videos that teach learning material to a chosen audience. You write the outline: the chapters, their goals and key points, and the hook.",
		"",
		audienceRules(a),
		"",
		"How to build the outline:",
		"- Teach only what the material teaches. Every chapter lists the ids of the source sections it uses (like s3), exactly as written in square brackets.",
		"- Order chapters so each idea builds on the last. One clear goal per chapter, written as what the viewer can say or do afterwards.",
		"- Use the teaching arc: a short opening, the ideas one by one, a worked example from the material, a common mistake or misconception, then a recap chapter.",
		`- Chapter count and depth fit the level: fewer, slower chapters for young viewers; more detail for advanced viewers.`,
		"- The hook is the first 15 seconds: 2 to 3 short sentences with a question, puzzle or surprise that the video answers. Do not start with 'In this video'.",
		"- `minutes` is the speaking time of each chapter.",
		"- `style` (the whole-video look): 'cartoon' for kindergarten and young children; 'chalkboard' for school maths and a hand-drawn classroom feel; 'paper' for notes, writing and humanities; 'blueprint' for engineering, physics and how machines work; 'neon' for computing, technology and modern topics for teens; 'academic' for university and research topics; 'clean' for anything else. Never 'brand' (the user picks that).",
		`- Write every title, goal, point and hook sentence in ${languageLabel(s.language)}. Tone: ${s.tone}.`,
	].join("\n");
}

export function outlinePrompt(source: Pick<Source, "title" | "sections" | "figures">, s: PlanSettings, map: KnowledgeChunk[] | null): string {
	const a = audienceFor(s.level);
	const words = targetWords(s);
	const length = s.targetMinutes
		? `Target length: about ${s.targetMinutes} minutes in total (about ${words} words of narration at ${a.wordsPerMinute} words per minute). Chapter minutes must add up to about ${s.targetMinutes}.`
		: `Target length: as long as the material needs to be taught well at this level, at ${a.wordsPerMinute} words per minute. Do not pad.`;
	const body = map ? `Knowledge map of the material (summarised; section ids in brackets):\n\n${mapForPrompt(map)}` : `The material (section ids in brackets):\n\n${sourceForPrompt(source)}`;
	return [`Material title: ${source.title || "(untitled)"}`, `Level: ${s.level}. Language: ${languageLabel(s.language)}. Tone: ${s.tone}.`, length, "", body].join("\n");
}

/** Gives chapters ids, drops unknown section ids and fits chapter minutes to the target. */
export function finishOutline(raw: z.output<typeof AiOutline>, source: Pick<Source, "sections">, s: PlanSettings): Outline {
	const known = new Set(source.sections.map((x) => x.id));
	let chapters = raw.chapters.map((c, i) => ({ ...c, id: `ch${i + 1}`, sources: [...new Set(c.sources.filter((id) => known.has(id)))] }));
	if (s.targetMinutes) {
		const total = chapters.reduce((n, c) => n + c.minutes, 0);
		const k = total > 0 ? s.targetMinutes / total : 1;
		if (Math.abs(k - 1) > 0.15) chapters = chapters.map((c) => ({ ...c, minutes: Math.max(0.5, Math.round(c.minutes * k * 2) / 2) }));
	}
	return Outline.parse({ ...raw, chapters, approved: false });
}

export type OutlineProgress = { step: "map" | "outline"; done: number; total: number };

/** Source → knowledge map (long sources only) → outline. */
export async function generateOutline(source: Source, s: PlanSettings, ai: PlannerAi, onProgress?: (p: OutlineProgress) => void): Promise<{ outline: Outline; map: KnowledgeChunk[] | null }> {
	const map = needsMap(source) ? await buildKnowledgeMap(source, ai, (done, total) => onProgress?.({ step: "map", done, total })) : null;
	onProgress?.({ step: "outline", done: 0, total: 1 });
	const raw = await ai.structured({ schema: AiOutline, system: outlineSystem(s), prompt: outlinePrompt(source, s, map) }, { slot: "planner", purpose: "plan.outline", maxOutputTokens: 8000 });
	onProgress?.({ step: "outline", done: 1, total: 1 });
	return { outline: finishOutline(raw, source, s), map };
}
