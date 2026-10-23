import { z } from "zod";
import { InputKind, ReadMethod, Source } from "../source";
import { defineChannel, NoInput, Ok } from "./channels";

export const LEVELS = ["Kindergarten", "Primary", "Middle school", "High school", "College", "University", "PhD"] as const;
export const Level = z.enum(LEVELS);
export type Level = z.infer<typeof Level>;

export const OcrMode = z.enum(["auto", "vision", "local"]);
export type OcrMode = z.infer<typeof OcrMode>;

/** A file the user picked or dropped, checked by main. */
export const PickedFile = z.object({
	path: z.string(),
	name: z.string(),
	kind: InputKind,
	bytes: z.number(),
	/** PDFs only. */
	pageCount: z.number().int().nullable(),
});
export type PickedFile = z.infer<typeof PickedFile>;

const PageRange = z.string().trim().max(200).regex(/^[\d\s,–-]*$/, "Use page numbers like 1-5, 8");

export const IngestItemInput = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("file"), path: z.string().min(3).max(4096), pages: PageRange.optional() }),
	z.object({ kind: z.literal("text"), text: z.string().min(1).max(2_000_000), title: z.string().trim().max(200).optional() }),
]);
export type IngestItemInput = z.infer<typeof IngestItemInput>;

export const IngestProgress = z.object({
	fileIndex: z.number(),
	fileCount: z.number(),
	fileName: z.string(),
	stage: z.enum(["text", "pages", "ocr", "figures", "saving"]),
	progress: z.number().min(0).max(1),
	page: z.number().optional(),
	pageIndex: z.number().optional(),
	pageCount: z.number().optional(),
	method: ReadMethod.optional(),
	detail: z.string(),
});
export type IngestProgress = z.infer<typeof IngestProgress>;

export const IngestUpdate = z.object({
	jobId: z.string(),
	state: z.enum(["running", "done", "error", "cancelled"]),
	progress: IngestProgress.nullable(),
	error: z.string().optional(),
	draftId: z.string().optional(),
});
export type IngestUpdate = z.infer<typeof IngestUpdate>;

export const Capabilities = z.object({
	localEngine: z.boolean(),
	/** The Vision slot's provider and model, or null when no AI provider is set up. */
	vision: z.object({ providerName: z.string(), modelId: z.string() }).nullable(),
	libreOffice: z.boolean(),
});
export type Capabilities = z.infer<typeof Capabilities>;

export const DraftView = z.object({
	id: z.string(),
	title: z.string(),
	level: z.string(),
	stage: z.string(),
	source: Source,
	createdAt: z.string(),
	updatedAt: z.string(),
});
export type DraftView = z.infer<typeof DraftView>;

const Id = z.uuid();

export const ingestChannels = {
	/** Opens the system file picker. Only files chosen here (or dropped and inspected) can be read. */
	pick: defineChannel("ingest:pick", NoInput, z.array(PickedFile)),
	/** Checks files dropped on the window. Unsupported or missing files are left out. */
	inspect: defineChannel("ingest:inspect", z.object({ paths: z.array(z.string().max(4096)).min(1).max(50) }), z.array(PickedFile)),
	capabilities: defineChannel("ingest:capabilities", NoInput, Capabilities),
	start: defineChannel("ingest:start", z.object({ items: z.array(IngestItemInput).min(1).max(50), ocr: OcrMode, level: Level }), z.object({ jobId: z.string() })),
	cancel: defineChannel("ingest:cancel", z.object({ jobId: Id }), Ok),
	draft: defineChannel("drafts:get", z.object({ id: Id }), DraftView),
	/** One figure of a draft as a data: URL, for previews. */
	figure: defineChannel("drafts:figure", z.object({ draftId: Id, figureId: z.string().regex(/^f\d{1,5}$/) }), z.object({ url: z.string() })),
};

export const ingestEvents = {
	update: "ingest:update",
} as const;
