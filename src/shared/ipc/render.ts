import { z } from "zod";
import { RenderSettings } from "../render";
import { defineChannel, NoInput, Ok } from "./channels";

export const RenderStage = z.enum(["queued", "browser", "bundling", "rendering", "encoding", "done", "cancelled", "error"]);
export type RenderStage = z.infer<typeof RenderStage>;

/** One progress update for the engine-test render. `progress` is 0..1 for the current stage. */
export const RenderUpdate = z.object({
	jobId: z.string(),
	stage: RenderStage,
	progress: z.number().min(0).max(1),
	detail: z.string().optional(),
	outputPath: z.string().optional(),
	error: z.string().optional(),
});
export type RenderUpdate = z.infer<typeof RenderUpdate>;

const JobRef = z.object({ jobId: z.uuid() });

/* ---------- Video render jobs ---------- */

export const JobStatus = z.enum(["queued", "running", "done", "cancelled", "error"]);
export type JobStatus = z.infer<typeof JobStatus>;
export const JobStep = z.enum(["waiting", "browser", "bundling", "chapters", "joining", "thumbnails", "finishing", "done"]);
export type JobStep = z.infer<typeof JobStep>;
export const ChapterState = z.enum(["waiting", "rendering", "done", "error"]);

export const RenderJobView = z.object({
	id: z.string(),
	draftId: z.string().nullable(),
	videoId: z.string(),
	title: z.string(),
	status: JobStatus,
	step: JobStep,
	/** 0..1 for the whole job. */
	progress: z.number().min(0).max(1),
	detail: z.string().nullable(),
	error: z.string().nullable(),
	settings: RenderSettings,
	width: z.number(),
	height: z.number(),
	durationMs: z.number(),
	chapters: z.array(z.object({ title: z.string(), frames: z.number(), state: ChapterState, progress: z.number() })),
	/** Time left, when it can be guessed. */
	etaMs: z.number().nullable(),
	/** How many times the job was resumed after a crash or a retry. */
	resumes: z.number(),
	createdAt: z.string(),
	startedAt: z.string().nullable(),
	finishedAt: z.string().nullable(),
});
export type RenderJobView = z.infer<typeof RenderJobView>;

/** What the render dialog shows before a render starts. */
export const RenderCheck = z.object({
	title: z.string(),
	durationMs: z.number(),
	chapters: z.number(),
	scenes: z.number(),
	voiced: z.number(),
	sentences: z.number(),
	musicBeds: z.number(),
	effects: z.number(),
	/** Credit lines the YouTube description will carry. */
	credits: z.array(z.string()),
	/** A render of this draft is already waiting or running. */
	activeJobId: z.string().nullable(),
	defaults: RenderSettings,
	/** The brand kit a render adds (intro and outro seconds), or null when there is no kit. */
	brand: z.object({ name: z.string(), channel: z.string(), intro: z.number(), outro: z.number(), watermark: z.boolean() }).nullable(),
	/** The series and episode, when the draft is in one. */
	series: z.object({ title: z.string(), episode: z.number() }).nullable(),
});
export type RenderCheck = z.infer<typeof RenderCheck>;

export const renderChannels = {
	/** Renders the built-in 10-second test composition. */
	startTest: defineChannel("render:startTest", NoInput, z.object({ jobId: z.string() })),
	cancel: defineChannel("render:cancel", JobRef, Ok),
	/** Shows a finished job's file in Explorer. The path comes from main, never from the renderer. */
	reveal: defineChannel("render:reveal", JobRef, Ok),

	check: defineChannel("render:check", z.object({ draftId: z.uuid() }), RenderCheck),
	/** Adds a draft to the render queue. `settings` are also saved as the new defaults when `remember` is true. */
	queue: defineChannel("render:queue", z.object({ draftId: z.uuid(), settings: RenderSettings, remember: z.boolean().default(false) }), z.object({ jobId: z.string() })),
	jobs: defineChannel("render:jobs", NoInput, z.array(RenderJobView)),
	cancelJob: defineChannel("render:job:cancel", JobRef, Ok),
	/** Starts a failed or cancelled job again. Chapters that finished are kept. */
	retryJob: defineChannel("render:job:retry", JobRef, Ok),
	/** Removes a finished, failed or cancelled job from the list. */
	clearJob: defineChannel("render:job:clear", JobRef, Ok),
	getDefaults: defineChannel("render:defaults:get", NoInput, RenderSettings),
	setDefaults: defineChannel("render:defaults:set", RenderSettings, RenderSettings),
};

export const renderEvents = {
	update: "render:update",
	/** A video render job changed (RenderJobView). */
	job: "render:job",
} as const;
