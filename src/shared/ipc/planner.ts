import { z } from "zod";
import { LookRecipe } from "../plan/look";
import { SCENE_TYPES, VideoPlan, type SceneType } from "../plan/schema";
import { Estimate, Outline, PlanSettings, PlanStep, QualityReport, TopicRequest } from "../planner";
import { defineChannel, Ok } from "./channels";

const Id = z.uuid();

/** Live state of a planner run. */
export const PlannerUpdate = z.object({
	jobId: z.string(),
	draftId: z.string(),
	step: PlanStep,
	state: z.enum(["running", "done", "error", "cancelled"]),
	/** 0..1 for the whole step. */
	progress: z.number().min(0).max(1),
	detail: z.string(),
	/** Script step: what each chapter is doing. */
	chapters: z.array(z.enum(["waiting", "writing", "checking", "fixing", "done"])).optional(),
	error: z.string().optional(),
});
export type PlannerUpdate = z.infer<typeof PlannerUpdate>;

/** Everything the wizard and the Studio need about one draft. */
export const PlanDraft = z.object({
	id: z.string(),
	title: z.string(),
	level: z.string(),
	stage: z.string(),
	settings: PlanSettings.nullable(),
	outline: Outline.nullable(),
	plan: VideoPlan.nullable(),
	report: QualityReport.nullable(),
	/** A planner run that is still going for this draft. */
	running: PlannerUpdate.nullable(),
	updatedAt: z.string(),
});
export type PlanDraft = z.infer<typeof PlanDraft>;

/** What a Studio rewrite works on: one scene (optionally as a new type) or one chapter. */
export const RegenerateTarget = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("scene"), sceneId: z.string().min(1).max(64), type: z.enum(SCENE_TYPES as [SceneType, ...SceneType[]]).optional() }),
	z.object({ kind: z.literal("chapter"), chapterId: z.string().min(1).max(64) }),
]);
export type RegenerateTarget = z.infer<typeof RegenerateTarget>;
const Instructions = z.string().trim().max(500).optional();

export const plannerChannels = {
	get: defineChannel("planner:get", z.object({ draftId: Id }), PlanDraft),
	/** Cost and time of the next step, before it runs. The script estimate uses the outline given (it may have unsaved edits). */
	estimate: defineChannel("planner:estimate", z.object({ draftId: Id, step: PlanStep, settings: PlanSettings, outline: Outline.optional() }), Estimate),
	/** Starts the outline. `confirmedCost` must be true when the estimate needed a confirmation. */
	outline: defineChannel("planner:outline", z.object({ draftId: Id, settings: PlanSettings, confirmedCost: z.boolean() }), z.object({ jobId: z.string() })),
	/** Saves user edits to the outline (and approval). */
	saveOutline: defineChannel("planner:outline:save", z.object({ draftId: Id, outline: Outline }), Ok),
	/** Writes the script and scenes from the approved outline. */
	script: defineChannel("planner:script", z.object({ draftId: Id, settings: PlanSettings, confirmedCost: z.boolean() }), z.object({ jobId: z.string() })),
	cancel: defineChannel("planner:cancel", z.object({ jobId: Id }), Ok),
	/** Changes the words of one narration sentence. Its old voice clip no longer applies. */
	saveSentence: defineChannel("planner:sentence:save", z.object({ draftId: Id, sentenceId: z.string().min(1).max(64), text: z.string().trim().min(1).max(600) }), Ok),
	/** Saves a Studio edit of the whole plan (autosave, undo and redo). Returns the stored plan; voice clips are kept only for unchanged sentences. */
	savePlan: defineChannel("planner:plan:save", z.object({ draftId: Id, plan: VideoPlan }), z.object({ plan: VideoPlan })),
	/** Cost and time of rewriting one scene or chapter. */
	regenerateEstimate: defineChannel("planner:regenerate:estimate", z.object({ draftId: Id, target: RegenerateTarget }), Estimate),
	/** Rewrites one scene or one chapter with the AI. The rest of the plan is not touched. */
	regenerate: defineChannel("planner:regenerate", z.object({ draftId: Id, target: RegenerateTarget, instructions: Instructions, confirmedCost: z.boolean() }), z.object({ jobId: z.string() })),
	/** Cost and time of a new AI free-form look. */
	lookEstimate: defineChannel("planner:look:estimate", z.object({ draftId: Id, wish: z.string().trim().max(300).optional() }), Estimate),
	/** Designs a new AI free-form look and returns it (the Studio saves it as an edit, so it can be undone). */
	newLook: defineChannel("planner:look:new", z.object({ draftId: Id, wish: z.string().trim().max(300).optional(), confirmedCost: z.boolean() }), z.object({ look: LookRecipe })),
	/** Cost and time of writing the material from a topic. */
	topicEstimate: defineChannel("planner:topic:estimate", TopicRequest, Estimate),
	/** Writes the material from a topic in the background. Progress and the new draft come as ingest updates, like reading files. */
	topicStart: defineChannel("planner:topic:start", TopicRequest.extend({ confirmedCost: z.boolean() }), z.object({ jobId: z.string() })),
};

export const plannerEvents = {
	update: "planner:update",
} as const;
