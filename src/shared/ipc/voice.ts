import { z } from "zod";
import { NarrationStatus, VoiceSetup } from "../narration";
import { defineChannel, NoInput, Ok } from "./channels";

/** Python versions the pinned packages have wheels for. */
export const PYTHON_MIN = [3, 11] as const;
export const PYTHON_MAX_EXCLUSIVE = [3, 14] as const;

export { SPEED_MAX, SPEED_MIN, Speed, VoiceId } from "../voice-ids";
import { Speed, VoiceId } from "../voice-ids";
export const DEFAULT_VOICE = "af_heart";
export const PREVIEW_MAX_CHARS = 300;
/** Rough download size of the pinned wheels on Windows (onnxruntime, OpenCV, numpy and RapidOCR are most of it). */
export const PACKAGES_BYTES_ESTIMATE = 130_000_000;


export const VoiceState = z.enum(["no-python", "not-installed", "installing", "outdated", "broken", "ready"]);
export type VoiceState = z.infer<typeof VoiceState>;

export const InstallStep = z.enum(["python", "venv", "packages", "models", "verify", "done", "error", "cancelled"]);
export type InstallStep = z.infer<typeof InstallStep>;

/** Progress of the current (or last) install. `progress` is 0..1 for the whole install. */
export const InstallProgress = z.object({
	step: InstallStep,
	progress: z.number().min(0).max(1),
	detail: z.string().optional(),
	error: z.string().optional(),
	startedAt: z.string(),
});
export type InstallProgress = z.infer<typeof InstallProgress>;

export const VoiceStatus = z.object({
	state: VoiceState,
	python: z.object({ exe: z.string(), version: z.string() }).nullable(),
	/** Plain-language reason Python cannot be used, with the fix. */
	pythonProblem: z.string().nullable(),
	/** What is wrong with an existing install (state "broken" or "outdated"). */
	problem: z.string().nullable(),
	folder: z.string(),
	sizeBytes: z.number(),
	installedAt: z.string().nullable(),
	install: InstallProgress.nullable(),
	/** Bytes the install still has to download (packages are estimated). */
	downloadBytes: z.number(),
});
export type VoiceStatus = z.infer<typeof VoiceStatus>;

export const Voice = z.object({
	id: VoiceId,
	name: z.string(),
	accent: z.enum(["American", "British"]),
	gender: z.enum(["female", "male"]),
	recommended: z.boolean(),
});
export type Voice = z.infer<typeof Voice>;

export const VoiceSettings = z.object({ voice: VoiceId, speed: Speed });
export type VoiceSettings = z.infer<typeof VoiceSettings>;

export const voiceChannels = {
	status: defineChannel("voice:status", NoInput, VoiceStatus),
	/** Starts an install in the background. `repair` deletes the venv first. Progress arrives as events. */
	install: defineChannel("voice:install", z.object({ repair: z.boolean() }), Ok),
	cancel: defineChannel("voice:cancel", NoInput, Ok),
	voices: defineChannel("voice:voices", NoInput, z.array(Voice)),
	/** Speaks a short sample. Audio comes back as a data: URL (a few hundred KB). */
	preview: defineChannel(
		"voice:preview",
		z.object({ voice: VoiceId, speed: Speed, text: z.string().trim().min(1).max(PREVIEW_MAX_CHARS).optional() }),
		z.object({ audio: z.string().startsWith("data:audio/wav;base64,"), durationMs: z.number(), cached: z.boolean() }),
	),
	getSettings: defineChannel("voice:settings:get", NoInput, VoiceSettings),
	setSettings: defineChannel("voice:settings:set", VoiceSettings, VoiceSettings),
	/** Opens the voice engine folder in Explorer. */
	reveal: defineChannel("voice:reveal", NoInput, Ok),

	/* Voice for a draft: one clip per sentence, cached. */
	draftStatus: defineChannel("voice:draft:status", z.object({ draftId: z.uuid() }), NarrationStatus),
	draftSetup: defineChannel("voice:draft:setup", z.object({ draftId: z.uuid(), setup: VoiceSetup }), NarrationStatus),
	/** Voices every sentence that has no up-to-date clip. Progress arrives as voice:draft events. */
	draftStart: defineChannel("voice:draft:start", z.object({ draftId: z.uuid() }), z.object({ jobId: z.string() })),
	draftCancel: defineChannel("voice:draft:cancel", z.object({ jobId: z.uuid() }), Ok),
};

export const voiceEvents = {
	progress: "voice:progress",
	draft: "voice:draft",
} as const;
