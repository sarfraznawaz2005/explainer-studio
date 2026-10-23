import { z } from "zod";
import { defineChannel, NoInput } from "./channels";

export const STORAGE_AREAS = ["drafts", "videos", "assets", "cache", "python", "engine", "data", "backups", "logs"] as const;
export const StorageArea = z.enum(STORAGE_AREAS);

/** Things the Storage page can clean. Nothing here is a draft, video or asset the app still lists. */
export const CLEANUPS = ["cache", "leftovers", "web"] as const;
export const Cleanup = z.enum(CLEANUPS);
export type Cleanup = z.infer<typeof Cleanup>;


export const StorageReport = z.object({
	root: z.string(),
	areas: z.array(z.object({ area: StorageArea, bytes: z.number(), files: z.number() })),
	cleanups: z.array(
		z.object({
			id: Cleanup,
			bytes: z.number(),
			files: z.number(),
			/** Why it cannot be cleaned right now (something is using it), or null. */
			blocked: z.string().nullable(),
		}),
	),
});
export type StorageReport = z.infer<typeof StorageReport>;

export const CleanResult = z.object({ freedBytes: z.number(), removedFiles: z.number(), skipped: z.array(z.string()) });
export type CleanResult = z.infer<typeof CleanResult>;

export const storageChannels = {
	report: defineChannel("storage:report", NoInput, StorageReport),
	/** Deletes the chosen items. The renderer asks the user to confirm first. */
	clean: defineChannel("storage:clean", z.object({ items: z.array(Cleanup).min(1).max(CLEANUPS.length) }), CleanResult),
	reveal: defineChannel("storage:reveal", NoInput, z.object({ ok: z.literal(true) })),
};

