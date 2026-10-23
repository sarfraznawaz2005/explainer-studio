import { z } from "zod";
import { Level } from "./ipc/ingest";
import { StyleId } from "./plan/schema";

/**
 * Planner data shared by main and the renderer: the video settings chosen in
 * the wizard, the outline the user approves, the quality report and the cost
 * estimate. See PLAN.md sections 5 and 7.
 */

export const TONES = ["Friendly", "Calm", "Enthusiastic", "Storyteller", "Neutral", "Academic"] as const;
export const Tone = z.enum(TONES);
export type Tone = z.infer<typeof Tone>;

/** Narration languages. The voice reads English only for now; other languages get script and captions. */
export const LANGUAGES = [
	{ code: "en", label: "English" },
	{ code: "es", label: "Spanish" },
	{ code: "fr", label: "French" },
	{ code: "de", label: "German" },
	{ code: "pt", label: "Portuguese" },
	{ code: "hi", label: "Hindi" },
	{ code: "ur", label: "Urdu" },
	{ code: "ar", label: "Arabic" },
	{ code: "zh", label: "Chinese" },
] as const;
export const LanguageCode = z.enum(LANGUAGES.map((l) => l.code) as [string, ...string[]]);
export const languageLabel = (code: string) => LANGUAGES.find((l) => l.code === code)?.label ?? code;

/** Target lengths offered in the wizard, in minutes. null = as long as the material needs. */
export const TARGET_MINUTES = [3, 5, 8, 10, 15, 20, 30, 45, 60] as const;

export const PlanSettings = z.object({
	level: Level,
	language: LanguageCode.default("en"),
	tone: Tone.default("Friendly"),
	targetMinutes: z.number().int().min(1).max(180).nullable().default(null),
	voice: z.string().regex(/^[a-z]{2}_[a-z0-9]{1,24}$/).optional(),
	style: z.union([StyleId, z.literal("auto")]).default("auto"),
});
export type PlanSettings = z.infer<typeof PlanSettings>;
export type PlanSettingsInput = z.input<typeof PlanSettings>;

const line = (max: number) => z.string().trim().min(1).max(max);

export const OutlineChapter = z.object({
	id: z.string().min(1).max(32),
	title: line(120),
	/** The learning goal: what the viewer can say or do after this chapter. */
	goal: line(300),
	keyPoints: z.array(line(200)).min(1).max(10),
	/** Source section ids this chapter is built from ("s3"). */
	sources: z.array(z.string().max(16)).max(60).default([]),
	minutes: z.number().min(0.5).max(60),
});
export type OutlineChapter = z.infer<typeof OutlineChapter>;

export const Outline = z.object({
	title: line(120),
	subtitle: z.string().trim().max(200).default(""),
	subject: z.string().trim().max(60).default(""),
	/** Visual style the AI suggests for this topic and level. Used when the user picked "Let AI decide". */
	style: StyleId.default("clean"),
	/** The first 15 seconds: a question or surprise that makes the viewer stay. */
	hook: z.array(line(300)).min(1).max(4),
	chapters: z.array(OutlineChapter).min(1).max(40),
	/** Key terms to define, and wrong ideas viewers often bring. */
	terms: z.array(line(80)).max(20).default([]),
	misconceptions: z.array(line(200)).max(6).default([]),
	approved: z.boolean().default(false),
});
export type Outline = z.infer<typeof Outline>;
export type OutlineInput = z.input<typeof Outline>;

/* ---------- Quality report ---------- */

export const FactIssue = z.object({
	ref: z.string(),
	sceneId: z.string(),
	sentence: z.string(),
	claim: z.string(),
	problem: z.enum(["unsupported", "contradicted"]),
	note: z.string(),
	status: z.enum(["fixed", "open"]),
	/** The sentence after the fix. */
	fixed: z.string().optional(),
});
export type FactIssue = z.infer<typeof FactIssue>;

export const LevelIssue = z.object({
	ref: z.string(),
	sceneId: z.string(),
	kind: z.enum(["long", "banned", "hard"]),
	sentence: z.string(),
	detail: z.string(),
	status: z.enum(["fixed", "open"]),
});
export type LevelIssue = z.infer<typeof LevelIssue>;

export const PacingIssue = z.object({
	sceneId: z.string(),
	kind: z.enum(["dense", "empty", "hook"]),
	detail: z.string(),
});
export type PacingIssue = z.infer<typeof PacingIssue>;

export const QualityReport = z.object({
	fact: z.object({ checked: z.number().int(), issues: z.array(FactIssue) }),
	level: z.object({ maxWords: z.number().int(), avgWords: z.number(), issues: z.array(LevelIssue) }),
	pacing: z.object({ issues: z.array(PacingIssue) }),
	estimateMinutes: z.number(),
	targetMinutes: z.number().nullable(),
	createdAt: z.string(),
});
export type QualityReport = z.infer<typeof QualityReport>;

/* ---------- Cost and time estimate ---------- */

/** outline and script run from the wizard; scene and chapter are Studio rewrites of one part. */
export const PlanStep = z.enum(["outline", "script", "scene", "chapter"]);
export type PlanStep = z.infer<typeof PlanStep>;

export const Estimate = z.object({
	step: PlanStep,
	calls: z.number().int(),
	inputTokens: z.number().int(),
	outputTokens: z.number().int(),
	provider: z.string(),
	model: z.string(),
	billing: z.enum(["api", "free", "subscription", "unknown"]),
	/** USD range; null when the model price is not known. */
	costUsd: z.object({ low: z.number(), high: z.number() }).nullable(),
	seconds: z.object({ low: z.number(), high: z.number() }),
	/** Paid runs (API billing or unknown price) need a confirmation first. */
	needsConfirm: z.boolean(),
});
export type Estimate = z.infer<typeof Estimate>;
