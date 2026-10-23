import { z } from "zod";
import { Estimate, PlanSettings } from "../planner";
import { FigureOrigin, PictureCredit } from "../source";
import { defineChannel } from "./channels";

const Id = z.uuid();

/** Most pictures a draft can hold (own, web and from the material together). */
export const PICTURES_MAX = 80;

/** One picture of a draft, as the wizard and the Studio show it. */
export const PictureView = z.object({
	id: z.string(),
	/** File name in source/figures ("my-001.jpg"); this is what figure scenes store. */
	file: z.string(),
	url: z.string(),
	caption: z.string().nullable(),
	origin: FigureOrigin,
	mustUse: z.boolean(),
	credit: PictureCredit.nullable(),
	width: z.number(),
	height: z.number(),
	focus: z.object({ x: z.number(), y: z.number() }).nullable(),
	/** Scenes that show it. */
	usedIn: z.number().int(),
	/** Web pictures: what was searched for. */
	subject: z.string().nullable(),
});
export type PictureView = z.infer<typeof PictureView>;

export const PicturesState = z.object({
	pictures: z.array(PictureView),
	/** A vision model is set up (checks web pictures and describes the user's own). */
	vision: z.boolean(),
	/** The last web search, if any. */
	searched: z.object({ at: z.string(), found: z.number() }).nullable(),
});
export type PicturesState = z.infer<typeof PicturesState>;

export const pictureChannels = {
	list: defineChannel("pictures:list", z.object({ draftId: Id }), PicturesState),
	/** Opens the file dialog and adds the chosen pictures as the user's own. */
	add: defineChannel("pictures:add", z.object({ draftId: Id }), PicturesState),
	update: defineChannel(
		"pictures:update",
		z.object({ draftId: Id, id: z.string().max(40), caption: z.string().trim().max(500).nullable().optional(), mustUse: z.boolean().optional() }),
		PicturesState,
	),
	/** Removes a picture that no scene shows (its file too). */
	remove: defineChannel("pictures:remove", z.object({ draftId: Id, id: z.string().max(40) }), PicturesState),
	estimate: defineChannel("pictures:estimate", z.object({ draftId: Id, settings: PlanSettings }), Estimate),
	/** Searches the web for the outline's photos. Progress arrives as planner events (step "pictures"). */
	find: defineChannel("pictures:find", z.object({ draftId: Id, settings: PlanSettings, confirmedCost: z.boolean() }), z.object({ jobId: z.string() })),
	/** Replaces one web picture with another search result (same subject). */
	another: defineChannel("pictures:another", z.object({ draftId: Id, id: z.string().max(40) }), PicturesState),
};
