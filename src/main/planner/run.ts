import type { Scene, VideoPlan } from "@shared/plan/schema";
import { computeTimeline } from "@shared/plan/timing";
import type { FactIssue, LevelIssue, QualityReport } from "@shared/planner";
import type { PlannerAi } from "./ai";
import { audienceFor } from "./audience";
import { factCheck, levelCheck, pacingCheck, revise, spokenOf, words } from "./checks";
import { CONCURRENCY } from "./estimate";
import { assemblePlan, chapterSource, hookScene, writeChapter, type ChapterContext } from "./script";

export type ScriptProgress = {
	/** Chapters fully done (written and checked). */
	done: number;
	total: number;
	/** What each chapter is doing now. */
	chapters: ("waiting" | "writing" | "checking" | "fixing" | "done")[];
};

type ChapterResult = { scenes: Scene[]; facts: FactIssue[]; level: LevelIssue[]; checked: number };

/** Write → fact check + level check → one revise round when needed. */
export async function planChapter(ctx: ChapterContext, index: number, ai: PlannerAi, onStep?: (s: ScriptProgress["chapters"][number]) => void, signal?: AbortSignal): Promise<ChapterResult> {
	const a = audienceFor(ctx.settings.level);
	const english = ctx.settings.language === "en";
	const terms = ctx.outline.terms;
	onStep?.("writing");
	let scenes = await writeChapter(ctx, index, ai);
	signal?.throwIfAborted();
	onStep?.("checking");
	const src = chapterSource(ctx, index);
	const facts = await factCheck(scenes, src, ai);
	const firstLevel = levelCheck(scenes, a, { terms, english });
	signal?.throwIfAborted();

	const problems = [
		...facts.map((f) => ({ ref: f.ref, sentence: f.sentence, problem: `${f.problem === "contradicted" ? "Contradicts" : "Not supported by"} the source: ${f.claim}. ${f.note}` })),
		...firstLevel.map((l) => ({ ref: l.ref, sentence: l.sentence, problem: l.detail })),
	];
	let changed = new Map<string, string>();
	if (problems.length) {
		onStep?.("fixing");
		({ scenes, changed } = await revise(scenes, problems, src, ctx.settings, ai));
	}
	const finalLevel = levelCheck(scenes, a, { terms, english });
	const stillOpen = new Set(finalLevel.map((l) => `${l.ref}:${l.kind}`));
	const level = [...firstLevel.filter((l) => changed.has(l.ref) && !stillOpen.has(`${l.ref}:${l.kind}`)).map((l) => ({ ...l, status: "fixed" as const })), ...finalLevel];
	const factsOut = facts.map((f) => (changed.has(f.ref) ? { ...f, status: "fixed" as const, fixed: changed.get(f.ref) || "(sentence removed)" } : f));
	onStep?.("done");
	return { scenes, facts: factsOut, level, checked: spokenOf(scenes).length };
}

/** All chapters (2 at a time), then the plan, the pacing check and the quality report. */
export async function generatePlan(
	ctx: ChapterContext,
	ai: PlannerAi,
	opts: { onProgress?: (p: ScriptProgress) => void; signal?: AbortSignal; concurrency?: number } = {},
): Promise<{ plan: VideoPlan; report: QualityReport }> {
	const n = ctx.outline.chapters.length;
	const state: ScriptProgress = { done: 0, total: n, chapters: Array(n).fill("waiting") };
	const tell = () => opts.onProgress?.({ ...state, chapters: [...state.chapters] });
	tell();
	const results: ChapterResult[] = new Array(n);
	let next = 0;
	const worker = async () => {
		while (next < n) {
			const i = next++;
			opts.signal?.throwIfAborted();
			results[i] = await planChapter(
				ctx,
				i,
				ai,
				(step) => {
					state.chapters[i] = step;
					if (step === "done") state.done++;
					tell();
				},
				opts.signal,
			);
		}
	};
	await Promise.all(Array.from({ length: Math.min(n, opts.concurrency ?? CONCURRENCY) }, worker));

	const plan = assemblePlan(
		ctx.outline,
		ctx.settings,
		results.map((r) => r.scenes),
	);
	const a = audienceFor(ctx.settings.level);
	const hookLevel = levelCheck([hookScene(ctx.outline, ctx.settings)], a, { terms: ctx.outline.terms, english: ctx.settings.language === "en" });
	const all = plan.chapters.flatMap((c) => spokenOf(c.scenes));
	const timeline = computeTimeline(plan);
	const report: QualityReport = {
		fact: { checked: results.reduce((k, r) => k + r.checked, 0), issues: results.flatMap((r) => r.facts) },
		level: {
			maxWords: a.maxSentenceWords,
			avgWords: all.length ? Math.round((all.reduce((k, s) => k + words(s.text).length, 0) / all.length) * 10) / 10 : 0,
			issues: [...hookLevel, ...results.flatMap((r) => r.level)],
		},
		pacing: { issues: pacingCheck(plan, a) },
		estimateMinutes: Math.round((timeline.durationInFrames / timeline.fps / 60) * 10) / 10,
		targetMinutes: ctx.settings.targetMinutes,
		createdAt: new Date().toISOString(),
	};
	return { plan, report };
}
