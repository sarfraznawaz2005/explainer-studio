import { z } from "zod";
import { YoutubePack } from "../render";
import { Level } from "./ingest";
import { defineChannel, NoInput, Ok } from "./channels";

const Id = z.uuid();

/** A finished video as the Library shows it. Paths stay in main; the renderer gets es-media URLs. */
export const VideoView = z.object({
	id: z.string(),
	title: z.string(),
	level: z.string(),
	/** The draft it came from, when it still exists. */
	draftId: z.string().nullable(),
	durationMs: z.number(),
	width: z.number(),
	height: z.number(),
	fps: z.number(),
	sizeBytes: z.number(),
	createdAt: z.string(),
	videoUrl: z.string(),
	thumbnails: z.array(z.string()),
	/** False when the video file was moved or deleted outside the app. */
	fileOk: z.boolean(),
	youtube: YoutubePack.nullable(),
});
export type VideoView = z.infer<typeof VideoView>;

export const DraftBadge = z.enum(["source", "outline", "script", "voice", "ready", "rendering", "failed", "rendered"]);
export type DraftBadge = z.infer<typeof DraftBadge>;

export const DraftSummary = z.object({
	id: z.string(),
	title: z.string(),
	level: z.string(),
	stage: z.string(),
	badge: DraftBadge,
	chapters: z.number(),
	scenes: z.number(),
	durationMs: z.number(),
	sentences: z.number(),
	voiced: z.number(),
	videos: z.number(),
	series: z.object({ id: z.string(), title: z.string(), episode: z.number() }).nullable(),
	createdAt: z.string(),
	updatedAt: z.string(),
});
export type DraftSummary = z.infer<typeof DraftSummary>;

export const libraryChannels = {
	videos: defineChannel("library:videos", NoInput, z.array(VideoView)),
	revealVideo: defineChannel("library:video:reveal", z.object({ videoId: Id }), Ok),
	/** youtube.txt as text, for the clipboard. */
	pack: defineChannel("library:video:pack", z.object({ videoId: Id }), z.object({ text: z.string() })),
	/** Puts youtube.txt on the clipboard (from main, so it works even when the window is not focused). */
	copyPack: defineChannel("library:video:copyPack", z.object({ videoId: Id }), z.object({ chars: z.number() })),
	/** Deletes the video folder (video, thumbnails, captions, pack). The draft is kept. */
	removeVideo: defineChannel("library:video:remove", z.object({ videoId: Id }), Ok),
	/** A new draft from the video's saved plan (with the voice, when the first draft still has it). */
	duplicateVideo: defineChannel("library:video:duplicate", z.object({ videoId: Id }), z.object({ draftId: z.string() })),

	drafts: defineChannel("library:drafts", NoInput, z.array(DraftSummary)),
	duplicateDraft: defineChannel("library:draft:duplicate", z.object({ draftId: Id }), z.object({ draftId: z.string() })),
	/** A new draft from the same material at another level. The outline and script are written again for that level. */
	duplicateForLevel: defineChannel("library:draft:duplicateForLevel", z.object({ draftId: Id, level: Level }), z.object({ draftId: z.string() })),
	/** Deletes a draft and its voice clips. Finished videos are kept. */
	removeDraft: defineChannel("library:draft:remove", z.object({ draftId: Id }), Ok),
};

export const libraryEvents = {
	/** Videos or drafts changed. */
	changed: "library:changed",
} as const;
