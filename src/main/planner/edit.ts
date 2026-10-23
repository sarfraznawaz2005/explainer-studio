import { z } from "zod";
import { SCENE_LABELS } from "@shared/plan/describe";
import { VideoPlan, type Scene, type SceneType } from "@shared/plan/schema";
import type { PlannerAi } from "./ai";
import { audienceFor } from "./audience";
import { planChapter } from "./run";
import { aiSceneSchema, chapterSource, contentTypes, figureRefs, PlannerError, scriptSystem, tidyProps, type ChapterContext } from "./script";

/**
 * Studio edits on a whole plan. Pure functions (no database), so the rules are
 * unit tested:
 *  - a saved plan keeps a sentence's voice clip only when the same sentence id
 *    already had that clip for the same words; the client cannot invent clips;
 *  - regenerating one scene or one chapter replaces exactly that part. Every other
 *    scene stays exactly as it was (deep equal).
 */

/** Voice clips and measured lengths come from the stored plan (same id, same words); anything else is dropped. */
export function mergeVoice(stored: VideoPlan | null, next: VideoPlan): VideoPlan {
	const voiced = new Map<string, { text: string; audio?: string; durationMs?: number }>();
	for (const ch of stored?.chapters ?? []) for (const sc of ch.scenes) for (const n of sc.narration) voiced.set(n.id, n);
	return {
		...next,
		chapters: next.chapters.map((ch) => ({
			...ch,
			scenes: ch.scenes.map((sc) => ({
				...sc,
				narration: sc.narration.map((n) => {
					const old = voiced.get(n.id);
					const keep = old && old.text === n.text && old.audio && old.durationMs;
					return keep ? { id: n.id, text: n.text, audio: old.audio, durationMs: old.durationMs } : { id: n.id, text: n.text };
				}),
			})),
		})),
	};
}

export function findScene(plan: VideoPlan, sceneId: string): { chapterIndex: number; sceneIndex: number; scene: Scene } | null {
	for (let ci = 0; ci < plan.chapters.length; ci++) {
		const si = plan.chapters[ci]!.scenes.findIndex((s) => s.id === sceneId);
		if (si >= 0) return { chapterIndex: ci, sceneIndex: si, scene: plan.chapters[ci]!.scenes[si]! };
	}
	return null;
}

/** The plan with one scene swapped; all other chapters and scenes are unchanged. */
export function replaceScene(plan: VideoPlan, sceneId: string, scene: Scene): VideoPlan {
	const at = findScene(plan, sceneId);
	if (!at) throw new PlannerError("This scene is no longer in the script.");
	const chapters = plan.chapters.slice();
	const scenes = chapters[at.chapterIndex]!.scenes.slice();
	scenes[at.sceneIndex] = scene;
	chapters[at.chapterIndex] = { ...chapters[at.chapterIndex]!, scenes };
	return VideoPlan.parse({ ...plan, chapters });
}

/** The plan with one chapter's scenes replaced. The opening title card (hook) of chapter 1 is kept. */
export function replaceChapter(plan: VideoPlan, chapterId: string, scenes: Scene[]): VideoPlan {
	const ci = plan.chapters.findIndex((c) => c.id === chapterId);
	if (ci < 0) throw new PlannerError("This chapter is no longer in the script.");
	const hook = plan.chapters[ci]!.scenes.filter((s) => s.id === "hook");
	const chapters = plan.chapters.slice();
	chapters[ci] = { ...chapters[ci]!, scenes: [...hook, ...scenes] };
	return VideoPlan.parse({ ...plan, chapters });
}

/** Scenes the AI may rewrite: content scenes, not the title and chapter cards built from the outline. */
export const canRegenerate = (scene: Scene) => scene.type !== "title" && scene.type !== "chapter";

const sceneText = (s: Scene) => s.narration.map((n) => n.text).join(" ");

export function scenePrompt(ctx: ChapterContext, plan: VideoPlan, sceneId: string, opts: { type?: SceneType; instructions?: string }): string {
	const at = findScene(plan, sceneId)!;
	const chapter = plan.chapters[at.chapterIndex]!;
	const oi = ctx.outline.chapters.findIndex((c) => c.id === chapter.id);
	const before = chapter.scenes[at.sceneIndex - 1];
	const after = chapter.scenes[at.sceneIndex + 1];
	return [
		`Video: "${plan.meta.title}" for ${ctx.settings.level}.`,
		`Chapter: ${chapter.title}${chapter.goal ? ` (goal: ${chapter.goal})` : ""}`,
		before ? `The scene before says: ${sceneText(before)}` : "This is the first scene of the chapter.",
		after ? `The scene after says: ${sceneText(after)}` : "This is the last scene of the chapter.",
		"",
		"Rewrite this one scene (same teaching job, better on screen):",
		JSON.stringify({ type: at.scene.type, props: at.scene.props, narration: at.scene.narration.map((n) => n.text) }),
		opts.type ? `Use the scene type "${opts.type}" (${SCENE_LABELS[opts.type]}).` : "Pick the scene type that shows this idea best; it may stay the same.",
		opts.instructions ? `Extra instructions from the creator (follow them): ${opts.instructions}` : "",
		"Keep about the same amount of narration so the chapter keeps its length. It must still fit between the scenes before and after.",
		"",
		"Source material for this chapter (section ids in brackets):",
		chapterSource(ctx, oi >= 0 ? oi : 0),
	]
		.filter((l) => l !== "")
		.join("\n");
}

type AiScene = { type: SceneType; props: Record<string, unknown>; narration: string[] };

/** One new scene from the AI, with the old scene's id and transition. */
export async function regenerateScene(ctx: ChapterContext, plan: VideoPlan, sceneId: string, ai: PlannerAi, opts: { type?: SceneType; instructions?: string } = {}): Promise<VideoPlan> {
	const at = findScene(plan, sceneId);
	if (!at) throw new PlannerError("This scene is no longer in the script.");
	if (!canRegenerate(at.scene)) throw new PlannerError("Title and chapter cards come from the outline. Change the outline to change them.");
	const a = audienceFor(ctx.settings.level);
	const figures = figureRefs(ctx.source);
	if (opts.type && !contentTypes(a, figures).includes(opts.type)) throw new PlannerError(`A ${SCENE_LABELS[opts.type].toLowerCase()} does not fit this level or this material.`);
	const system = [scriptSystem(ctx.settings, figures), "", "This time you write only ONE scene. Reply with that scene object (type, props, narration)."].join("\n");
	let reply: AiScene;
	try {
		reply = (await ai.structured(
			{ schema: aiSceneSchema(a, figures, opts.type) as z.ZodType, system, prompt: scenePrompt(ctx, plan, sceneId, opts) },
			{ slot: "planner", purpose: "plan.scene", maxOutputTokens: 8000 },
		)) as AiScene;
	} catch (err) {
		if ((err as Error).name === "StructuredOutputError") throw new PlannerError(`The new scene was not valid: ${(err as Error).message}`);
		throw err;
	}
	const scene = {
		id: at.scene.id,
		type: reply.type,
		props: tidyProps(reply.type, reply.props, figures),
		narration: reply.narration.map((text, j) => ({ id: `${at.scene.id}-n${j + 1}`, text })),
		cues: [],
		transition: at.scene.transition,
		...(at.scene.minDurationMs !== undefined ? { minDurationMs: at.scene.minDurationMs } : {}),
	} as unknown as Scene;
	return replaceScene(plan, sceneId, scene);
}

/** One chapter written again (with the usual fact, level and revise checks). */
export async function regenerateChapter(ctx: ChapterContext, plan: VideoPlan, chapterId: string, ai: PlannerAi, onStep?: (s: string) => void, signal?: AbortSignal): Promise<VideoPlan> {
	const oi = ctx.outline.chapters.findIndex((c) => c.id === chapterId);
	if (oi < 0 || !plan.chapters.some((c) => c.id === chapterId)) throw new PlannerError("This chapter is not in the outline any more. Write the whole script again instead.");
	const { scenes } = await planChapter(ctx, oi, ai, onStep, signal);
	return replaceChapter(plan, chapterId, scenes);
}
