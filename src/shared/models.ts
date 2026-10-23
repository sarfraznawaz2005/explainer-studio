/**
 * Row shapes for the app database, as main and the renderer see them (camelCase).
 * JSON columns are typed loosely here; their real schemas (VideoPlan, brand kit, ...)
 * arrive with the features that own them.
 */
type Json = unknown;
type Stamps = { createdAt: string; updatedAt: string };

export type Provider = Stamps & {
	id: string;
	kind: string;
	name: string;
	baseUrl: string | null;
	/** Cached model list: { ids: string[], fetchedAt: string }. */
	models: Json;
	/** Sealed with safeStorage. Never sent to the renderer. */
	secret: Uint8Array | null;
	enabled: boolean;
	defaultModel: string | null;
	isDefault: boolean;
	/** Result of the last connection test; null = never tested. */
	testOk: boolean | null;
	testError: string | null;
	testedAt: string | null;
};

/** One model call. Written for every attempt, failed ones included. */
export type AiUsage = Stamps & {
	id: string;
	providerId: string | null;
	providerKind: string;
	providerName: string;
	model: string;
	slot: string | null;
	purpose: string;
	attempt: number;
	draftId: string | null;
	ok: boolean;
	error: string | null;
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	/** null when the price of the model is not known. */
	costUsd: number | null;
	billing: "api" | "free" | "subscription" | "unknown";
	durationMs: number;
};

export type BrandKit = Stamps & { id: string; name: string; data: Json; isDefault: boolean };

export type Series = Stamps & { id: string; title: string; description: string; style: Json; brandKitId: string | null };

export type DraftStage = "source" | "outline" | "script" | "voice" | "preview" | "ready";
export type Draft = Stamps & {
	id: string;
	title: string;
	level: string;
	stage: DraftStage;
	source: Json;
	plan: Json | null;
	/** Wizard settings (PlanSettings), the outline (Outline) and the quality report (QualityReport). */
	settings: Json | null;
	outline: Json | null;
	report: Json | null;
	/** Voice, speed and pronunciation dictionary (VoiceSetup). */
	voice: Json | null;
	/** Music and sound effect choices (SoundSetup). */
	audio: Json | null;
	seriesId: string | null;
	/** Episode number inside the series (null when not in a series). */
	episode: number | null;
	brandKitId: string | null;
};

export type Video = Stamps & {
	id: string;
	draftId: string | null;
	seriesId: string | null;
	episode: number | null;
	title: string;
	filePath: string;
	thumbnailPath: string | null;
	durationMs: number;
	width: number;
	height: number;
	sizeBytes: number;
	youtube: Json;
};

export type AssetKind = "music" | "sfx" | "image" | "font";
export type Asset = Stamps & {
	id: string;
	kind: AssetKind;
	title: string;
	filePath: string;
	durationMs: number | null;
	tags: string[];
	mood: string | null;
	source: string;
	sourceUrl: string | null;
	author: string | null;
	license: string;
	licenseUrl: string | null;
	attribution: string | null;
	sha256: string | null;
	bytes: number;
	favorite: boolean;
	energy: string | null;
	bpm: number | null;
	/** Starter pack or online source the file came with, e.g. "FreePD.com". */
	pack: string | null;
};

export type JobStatus = "queued" | "running" | "done" | "cancelled" | "error";
export type Job = Stamps & {
	id: string;
	kind: string;
	status: JobStatus;
	draftId: string | null;
	progress: number;
	detail: string | null;
	error: string | null;
	payload: Json;
	result: Json | null;
	startedAt: string | null;
	finishedAt: string | null;
};
