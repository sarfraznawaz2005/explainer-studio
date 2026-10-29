import { z } from "zod";
import { AssetKind, AssetPatch, AssetView, FreesoundResults, ImportLicense, SoundSetup, StarterStatus, SfxRole } from "../assets";
import { defineChannel, NoInput, Ok } from "./channels";

const Id = z.uuid();
const MixKind = z.enum(["music", "sfx"]);

export const LibraryItemSchema = z.object({ id: z.string(), kind: z.string(), url: z.string(), mood: z.string().nullable(), durationMs: z.number().nullable() });

/** What the Studio needs to mix a draft: its setup plus the library, built into a soundtrack in the renderer. */
export const DraftSound = z.object({
	setup: SoundSetup,
	library: z.array(LibraryItemSchema),
	/** Titles for the pickers (music and effects only). */
	titles: z.record(z.string(), z.string()),
	roleDefaults: z.partialRecord(SfxRole, z.string()),
	seed: z.string(),
});
export type DraftSound = z.infer<typeof DraftSound>;

export const assetChannels = {
	list: defineChannel("assets:list", z.object({ kind: AssetKind.optional() }).optional(), z.array(AssetView)),
	update: defineChannel("assets:update", z.object({ id: Id, patch: AssetPatch }), AssetView),
	/** Drafts that use an asset, for the delete confirmation. */
	usage: defineChannel("assets:usage", z.object({ id: Id }), z.object({ drafts: z.array(z.string()) })),
	remove: defineChannel("assets:remove", z.object({ id: Id }), Ok),
	/** Opens a file dialog and imports the chosen files with the declared license. */
	import: defineChannel(
		"assets:import",
		z.object({ kind: AssetKind, license: ImportLicense }),
		z.object({ added: z.array(AssetView), existing: z.number(), failed: z.array(z.object({ name: z.string(), error: z.string() })) }),
	),
	/** Opens the license files folder in Explorer. */
	revealLicenses: defineChannel("assets:licenses:reveal", NoInput, Ok),

	starterStatus: defineChannel("assets:starter:status", NoInput, StarterStatus),
	starterInstall: defineChannel("assets:starter:install", NoInput, Ok),
	starterCancel: defineChannel("assets:starter:cancel", NoInput, Ok),

	freesoundKey: defineChannel("assets:freesound:key", NoInput, z.object({ set: z.boolean() })),
	/** Gives the saved key in plain text, only when the user clicks the eye button. "" when no key is saved. */
	freesoundRevealKey: defineChannel("assets:freesound:key:reveal", NoInput, z.object({ key: z.string() })),
	/** Saves (after testing) or removes the key. */
	freesoundSetKey: defineChannel("assets:freesound:key:set", z.object({ key: z.string().trim().min(8).max(200).regex(/^[A-Za-z0-9]+$/).nullable() }), z.object({ set: z.boolean() })),
	freesoundSearch: defineChannel(
		"assets:freesound:search",
		z.object({ query: z.string().trim().min(1).max(100), kind: MixKind, page: z.number().int().min(1).max(500).default(1) }),
		FreesoundResults,
	),
	freesoundImport: defineChannel("assets:freesound:import", z.object({ id: z.number().int().positive(), kind: MixKind }), z.object({ asset: AssetView, existed: z.boolean() })),

	draftSound: defineChannel("assets:draft:sound", z.object({ draftId: Id }), DraftSound),
	setDraftSound: defineChannel("assets:draft:sound:set", z.object({ draftId: Id, setup: SoundSetup }), DraftSound),
};

export const assetEvents = {
	starter: "assets:starter",
	/** The library changed (added, edited, deleted). */
	changed: "assets:changed",
} as const;
