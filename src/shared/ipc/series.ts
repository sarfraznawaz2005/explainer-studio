import { z } from "zod";
import { VoiceSetup } from "../narration";
import { LookRecipe } from "../plan/look";
import { VideoCode } from "../plan/code";
import { StyleId } from "../plan/schema";
import { defineChannel, NoInput, Ok } from "./channels";
import { DraftBadge } from "./library";

const Id = z.uuid();

/** The look every episode shares. Taken from the first episode when not set. */
export const SeriesLook = z.object({
	style: StyleId.optional(),
	/** The AI free-form look recipe, when the style is "free". */
	look: LookRecipe.optional(),
	/** The AI design code, when the style is "code". It reads every text from the plan, so it fits each episode. */
	code: VideoCode.optional(),
	voice: VoiceSetup.optional(),
});
export type SeriesLook = z.infer<typeof SeriesLook>;

export const SeriesForm = z.object({
	title: z.string().trim().min(1, "Type a name for the series").max(120),
	description: z.string().trim().max(500).default(""),
	/** null = the default brand kit. */
	brandKitId: Id.nullable().default(null),
});
export type SeriesForm = z.infer<typeof SeriesForm>;

export const Episode = z.object({
	draftId: z.string(),
	episode: z.number(),
	title: z.string(),
	level: z.string(),
	badge: DraftBadge,
	durationMs: z.number(),
	/** The newest video rendered from this episode. */
	video: z.object({ id: z.string(), thumbnail: z.string().nullable(), createdAt: z.string() }).nullable(),
});
export type Episode = z.infer<typeof Episode>;

export const SeriesView = z.object({
	id: z.string(),
	title: z.string(),
	description: z.string(),
	brandKitId: z.string().nullable(),
	look: SeriesLook,
	episodes: z.array(Episode),
	/** Videos of this series whose draft was deleted. */
	videosWithoutDraft: z.number(),
	updatedAt: z.string(),
});
export type SeriesView = z.infer<typeof SeriesView>;

export const seriesChannels = {
	list: defineChannel("series:list", NoInput, z.array(SeriesView)),
	create: defineChannel("series:create", SeriesForm, SeriesView),
	update: defineChannel("series:update", z.object({ id: Id, form: SeriesForm }), SeriesView),
	/** Deletes the series only. Its drafts and videos stay, outside any series. */
	remove: defineChannel("series:remove", z.object({ id: Id }), Ok),
	/** Adds a draft as the next episode. `applyLook` gives it the series style and voice. */
	addDraft: defineChannel("series:addDraft", z.object({ seriesId: Id, draftId: Id, applyLook: z.boolean().default(true) }), SeriesView),
	removeDraft: defineChannel("series:removeDraft", z.object({ draftId: Id }), Ok),
	/** Moves an episode one place up or down (the numbers follow). */
	move: defineChannel("series:move", z.object({ draftId: Id, by: z.union([z.literal(-1), z.literal(1)]) }), SeriesView),
};
