import { z } from "zod";
import type { Scene, VideoPlan } from "@shared/plan/schema";
import { revealCount, timeScene } from "@shared/plan/timing";
import { languageLabel, type FactIssue, type LevelIssue, type PacingIssue, type PlanSettings } from "@shared/planner";
import type { PlannerAi } from "./ai";
import { audienceFor, audienceRules, type Audience } from "./audience";

/**
 * Quality passes on a written chapter (PLAN.md section 5):
 *  1. Fact check (AI): narration claims the source does not support.
 *  2. Level check (rules): sentence length, banned words, hard words for young viewers.
 *  3. Pacing check (rules): scenes too dense or too empty, a hook longer than 15 s.
 * Fact and level issues are sent back to the model once to be rewritten.
 */

export const HOOK_MAX_MS = 15_000;
export const BANNED = ["obviously", "simply", "just", "clearly", "of course", "trivially"];

export const words = (t: string) => t.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? [];

/** Rough English syllable count, good enough to spot long words. */
export function syllables(word: string): number {
	const w = word.toLowerCase().replace(/[^a-z]/g, "");
	if (w.length <= 3) return 1;
	const groups = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "").match(/[aeiouy]{1,2}/g);
	return Math.max(1, groups?.length ?? 1);
}

export type Spoken = { ref: string; sceneId: string; text: string };

export const spokenOf = (scenes: Scene[]): Spoken[] => scenes.flatMap((sc) => sc.narration.map((n) => ({ ref: n.id, sceneId: sc.id, text: n.text })));

/** Level check by rules. `terms` (key terms of the video) are never "hard words". */
export function levelCheck(scenes: Scene[], a: Audience, opts: { terms?: string[]; english?: boolean } = {}): LevelIssue[] {
	const terms = new Set((opts.terms ?? []).flatMap((t) => words(t.toLowerCase())));
	const issues: LevelIssue[] = [];
	for (const s of spokenOf(scenes)) {
		const w = words(s.text);
		if (w.length > a.maxSentenceWords) issues.push({ ref: s.ref, sceneId: s.sceneId, kind: "long", sentence: s.text, detail: `${w.length} words; the limit for ${a.level} is ${a.maxSentenceWords}.`, status: "open" });
		const lower = ` ${s.text.toLowerCase().replace(/[^\p{L}\s']/gu, " ")} `;
		const banned = BANNED.filter((b) => lower.includes(` ${b} `));
		if (banned.length) issues.push({ ref: s.ref, sceneId: s.sceneId, kind: "banned", sentence: s.text, detail: `Avoid "${banned.join('", "')}": it can make a confused viewer feel slow.`, status: "open" });
		if (a.maxSyllables && opts.english !== false) {
			const hard = [...new Set(w.filter((x) => !/\d/.test(x) && !terms.has(x.toLowerCase()) && syllables(x) > a.maxSyllables!))];
			if (hard.length) issues.push({ ref: s.ref, sceneId: s.sceneId, kind: "hard", sentence: s.text, detail: `Hard words for ${a.level}: ${hard.join(", ")}.`, status: "open" });
		}
	}
	return issues;
}

/** Pacing check by rules, on the estimated timing at the level's speaking speed. */
export function pacingCheck(plan: VideoPlan, a: Audience): PacingIssue[] {
	const issues: PacingIssue[] = [];
	const fps = plan.meta.fps;
	plan.chapters.forEach((ch) =>
		ch.scenes.forEach((sc) => {
			const t = timeScene(sc, fps, plan.meta.wordsPerMinute);
			const sec = t.durationInFrames / fps;
			const items = revealCount(sc);
			const card = sc.type === "title" || sc.type === "chapter";
			// The hook counts speech only: first word to last word.
			const spoken = t.sentences.length ? (t.sentences.at(-1)!.from + t.sentences.at(-1)!.duration - t.sentences[0]!.from) / fps : 0;
			if (sc.id === "hook" && spoken * 1000 > HOOK_MAX_MS)
				issues.push({ sceneId: sc.id, kind: "hook", detail: `The hook takes about ${Math.round(spoken)} s to say. Keep the opening under 15 s.` });
			else if (!card && sec > a.maxSceneSeconds) issues.push({ sceneId: sc.id, kind: "dense", detail: `About ${Math.round(sec)} s on one screen; for ${a.level} aim for under ${a.maxSceneSeconds} s. Split it.` });
			else if (!card && sc.narration.length > a.sentencesPerScene[1] + 2)
				issues.push({ sceneId: sc.id, kind: "dense", detail: `${sc.narration.length} sentences on one screen; aim for ${a.sentencesPerScene[1]} or fewer.` });
			else if (items > 0 && sc.narration.length * 3 < items) issues.push({ sceneId: sc.id, kind: "dense", detail: `${items} items appear during only ${sc.narration.length} sentence(s).` });
			else if (!card && (sc.narration.length < 2 || sec < 6)) issues.push({ sceneId: sc.id, kind: "empty", detail: `Only ${sc.narration.length} sentence(s), about ${Math.round(sec)} s. Add a sentence or merge it with the next scene.` });
		}),
	);
	return issues;
}

/* ---------- Fact check (AI) ---------- */

export const FactCheckResult = z.object({
	issues: z
		.array(
			z.object({
				ref: z.string().max(40),
				claim: z.string().trim().min(1).max(300),
				problem: z.enum(["unsupported", "contradicted"]),
				note: z.string().trim().max(400),
			}),
		)
		.max(40),
});

export const FACT_SYSTEM = [
	"You are a careful fact checker for educational videos. You compare a narration script with the source material it must be based on.",
	"Flag every factual claim in the narration that the source does not support, or that the source contradicts:",
	"- names, dates, numbers, places, inventors, records, definitions, how something works, cause and effect, steps of a procedure, and results of code.",
	"Do not flag: questions to the viewer, transitions, encouragement, analogies that are clearly presented as analogies, simple examples that only restate the source, and plain everyday common sense.",
	"Use `unsupported` when the source does not say it, `contradicted` when the source says something different. In `note`, say what the source says, briefly.",
	"`ref` is the sentence id in square brackets, copied exactly. Return an empty list when everything is supported.",
].join("\n");

export function factPrompt(spoken: Spoken[], sourceText: string): string {
	return ["Source material:", sourceText, "", "Narration to check (sentence id in brackets):", ...spoken.map((s) => `[${s.ref}] ${s.text}`)].join("\n");
}

/** Fact check of one chapter's narration against its source text. Unknown refs are dropped. */
export async function factCheck(scenes: Scene[], sourceText: string, ai: PlannerAi): Promise<FactIssue[]> {
	const spoken = spokenOf(scenes);
	if (!spoken.length) return [];
	const byRef = new Map(spoken.map((s) => [s.ref, s]));
	const r = await ai.structured({ schema: FactCheckResult, system: FACT_SYSTEM, prompt: factPrompt(spoken, sourceText) }, { slot: "planner", purpose: "plan.fact-check", maxOutputTokens: 4000 });
	const seen = new Set<string>();
	return r.issues.flatMap((i) => {
		const ref = i.ref.replace(/^\[|\]$/g, "").trim();
		const s = byRef.get(ref);
		if (!s || seen.has(ref)) return [];
		seen.add(ref);
		return [{ ref, sceneId: s.sceneId, sentence: s.text, claim: i.claim, problem: i.problem, note: i.note, status: "open" as const }];
	});
}

/* ---------- Revise (AI) ---------- */

/** "One. Two!" → ["One.", "Two!"]. Keeps "e.g." and decimals together. */
export function splitSentences(text: string): string[] {
	return text
		.split(/(?<!\b(?:e\.g|i\.e|etc|Mr|Mrs|Dr|vs)\.)(?<=[.!?])\s+(?=["“'(]?\p{Lu})/u)
		.map((t) => t.trim())
		.filter(Boolean);
}

export const ReviseResult = z.object({
	edits: z.array(z.object({ ref: z.string().max(40), text: z.string().trim().max(600) })).max(80),
});

export function reviseSystem(s: PlanSettings): string {
	return [
		"You fix sentences in the narration of an educational video. You get the source material, the sentences with problems and what is wrong with each.",
		audienceRules(audienceFor(s.level)),
		"Rules:",
		"- Rewrite each listed sentence so the problem is gone. Keep its place and job in the scene.",
		"- A claim the source does not support: change it to what the source says, or remove the claim.",
		"- A sentence that is too long: say it in fewer words, or as two short sentences in the same `text`.",
		"- An empty `text` removes the sentence. Only remove a sentence when it cannot be fixed.",
		`- Write in ${languageLabel(s.language)}. Return only the listed sentences, by their id.`,
	].join("\n");
}

/** Sends fact and level problems back to the model once. Returns new scenes and the refs that changed. */
export async function revise(
	scenes: Scene[],
	problems: { ref: string; sentence: string; problem: string }[],
	sourceText: string,
	s: PlanSettings,
	ai: PlannerAi,
): Promise<{ scenes: Scene[]; changed: Map<string, string> }> {
	if (!problems.length) return { scenes, changed: new Map() };
	const byRef = new Map<string, { sentence: string; problems: string[] }>();
	for (const p of problems) {
		const cur = byRef.get(p.ref) ?? { sentence: p.sentence, problems: [] };
		cur.problems.push(p.problem);
		byRef.set(p.ref, cur);
	}
	const prompt = [
		"Source material:",
		sourceText,
		"",
		"Sentences to fix:",
		...[...byRef].map(([ref, v]) => `[${ref}] ${v.sentence}\n  Problem: ${v.problems.join(" Also: ")}`),
	].join("\n");
	const r = await ai.structured({ schema: ReviseResult, system: reviseSystem(s), prompt }, { slot: "planner", purpose: "plan.revise", maxOutputTokens: 4000 });
	const changed = new Map<string, string>();
	for (const e of r.edits) {
		const ref = e.ref.replace(/^\[|\]$/g, "").trim();
		if (byRef.has(ref)) changed.set(ref, e.text);
	}
	const next = scenes.map((sc) => {
		const narration = sc.narration.flatMap((n) => {
			const t = changed.get(n.id);
			if (t === undefined) return [n];
			// "Two short sentences" come back in one text: each becomes its own narration line (own voice clip and timing).
			return splitSentences(t).map((text, k) => ({ id: k ? `${n.id}-r${k}` : n.id, text }));
		});
		// A scene keeps at least one sentence.
		return { ...sc, narration: narration.length ? narration : sc.narration };
	});
	return { scenes: next, changed };
}
