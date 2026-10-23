import { z } from "zod";
import { BrandKitData, BrandKitView } from "../brand";
import { defineChannel, NoInput, Ok } from "./channels";

const Id = z.uuid();
const Name = z.string().trim().min(1, "Type a name for the kit").max(60);

export const brandChannels = {
	list: defineChannel("brand:list", NoInput, z.array(BrandKitView)),
	create: defineChannel("brand:create", z.object({ name: Name, data: BrandKitData }), BrandKitView),
	update: defineChannel("brand:update", z.object({ id: Id, name: Name, data: BrandKitData }), BrandKitView),
	/** Deletes the kit and its logo. Drafts and series that used it fall back to the default kit. */
	remove: defineChannel("brand:remove", z.object({ id: Id }), Ok),
	setDefault: defineChannel("brand:setDefault", z.object({ id: Id }), BrandKitView),
	/** Opens the OS file dialog and copies the picked image in. null = the user cancelled. */
	pickLogo: defineChannel("brand:logo:pick", z.object({ id: Id }), BrandKitView.nullable()),
	clearLogo: defineChannel("brand:logo:clear", z.object({ id: Id }), BrandKitView),
	/** The kit a draft's renders use (its series' kit or the default), so the Studio shows the same colours. */
	forDraft: defineChannel("brand:forDraft", z.object({ draftId: Id }), BrandKitView.nullable()),
};
