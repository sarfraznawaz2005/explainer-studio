import { z } from "zod";

/**
 * A Source is the learning material in one normalised shape, whatever it came
 * from (PDF, scan, Word, HTML, Markdown, text). The planner reads only this.
 * Figure files live in the draft folder; `file` is relative to it.
 */
export const INPUT_KINDS = ["pdf", "image", "docx", "doc", "html", "md", "txt", "text"] as const;
export const InputKind = z.enum(INPUT_KINDS);
export type InputKind = z.infer<typeof InputKind>;

export const Block = z.discriminatedUnion("type", [
	z.object({ type: z.literal("paragraph"), text: z.string() }),
	z.object({ type: z.literal("list"), ordered: z.boolean(), items: z.array(z.string()) }),
	z.object({ type: z.literal("table"), rows: z.array(z.array(z.string())), caption: z.string().nullable() }),
	z.object({ type: z.literal("code"), text: z.string() }),
	z.object({ type: z.literal("quote"), text: z.string() }),
	z.object({ type: z.literal("figure"), figureId: z.string() }),
]);
export type Block = z.infer<typeof Block>;

export const Section = z.object({
	id: z.string(),
	heading: z.string().nullable(),
	/** 1 = chapter, 2 = section, ... */
	level: z.number().int().min(1).max(6),
	/** First page of the section (PDF and scans). */
	page: z.number().int().positive().nullable(),
	/** Which input file the section came from (index into `inputs`). */
	input: z.number().int().min(0),
	blocks: z.array(Block),
});
export type Section = z.infer<typeof Section>;

export const Figure = z.object({
	id: z.string(),
	/** Path relative to the draft folder, e.g. "source/figures/f3.png". */
	file: z.string(),
	caption: z.string().nullable(),
	page: z.number().int().positive().nullable(),
	input: z.number().int().min(0),
	width: z.number().int().nonnegative(),
	height: z.number().int().nonnegative(),
	mediaType: z.string(),
});
export type Figure = z.infer<typeof Figure>;

export const ReadMethod = z.enum(["text", "vision", "local-ocr"]);
export type ReadMethod = z.infer<typeof ReadMethod>;

export const SourceInput = z.object({
	kind: InputKind,
	name: z.string(),
	/** Pages in the file (PDF) and the pages that were read. */
	pageCount: z.number().int().nullable(),
	pages: z.array(z.number().int()).nullable(),
	/** How each read page was read; only pages that needed OCR are listed. */
	ocr: z.array(z.object({ page: z.number().int(), method: ReadMethod })),
});
export type SourceInput = z.infer<typeof SourceInput>;

export const Source = z.object({
	version: z.literal(1),
	title: z.string(),
	inputs: z.array(SourceInput),
	sections: z.array(Section),
	figures: z.array(Figure),
	stats: z.object({ words: z.number().int(), chars: z.number().int() }),
	/** Things the user should know (a page could not be read, LibreOffice missing for one file, ...). */
	warnings: z.array(z.string()),
});
export type Source = z.infer<typeof Source>;

export const EMPTY_SOURCE: Source = { version: 1, title: "", inputs: [], sections: [], figures: [], stats: { words: 0, chars: 0 }, warnings: [] };

/** File extension → input kind. */
export function kindOfFile(name: string): InputKind | null {
	const ext = name.toLowerCase().split(".").pop() ?? "";
	if (ext === "pdf") return "pdf";
	if (["png", "jpg", "jpeg", "webp", "bmp", "gif", "tif", "tiff"].includes(ext)) return "image";
	if (ext === "docx") return "docx";
	if (ext === "doc") return "doc";
	if (["html", "htm", "xhtml"].includes(ext)) return "html";
	if (["md", "markdown"].includes(ext)) return "md";
	if (ext === "txt") return "txt";
	return null;
}

export const ACCEPTED_EXTENSIONS = ["pdf", "png", "jpg", "jpeg", "webp", "bmp", "gif", "tif", "tiff", "docx", "doc", "html", "htm", "xhtml", "md", "markdown", "txt"];

/** All plain text of a Source, in reading order (for word counts and the planner). */
export function sourceText(s: Pick<Source, "sections">): string {
	const out: string[] = [];
	for (const sec of s.sections) {
		if (sec.heading) out.push(sec.heading);
		for (const b of sec.blocks) {
			if (b.type === "paragraph" || b.type === "code" || b.type === "quote") out.push(b.text);
			else if (b.type === "list") out.push(...b.items);
			else if (b.type === "table") out.push(...b.rows.map((r) => r.join(" | ")));
		}
	}
	return out.join("\n");
}

export const countWords = (text: string) => (text.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? []).length;

/**
 * "1-3, 7, 10-12" → [1,2,3,7,10,11,12]. Pages outside 1..max are an error.
 * An empty string means all pages.
 */
export function parsePageRange(input: string, max: number): number[] {
	const text = input.trim();
	if (!text) return Array.from({ length: max }, (_, i) => i + 1);
	const pages = new Set<number>();
	for (const part of text.split(/[,\s]+/).filter(Boolean)) {
		const m = /^(\d+)(?:\s*[-–]\s*(\d+))?$/.exec(part);
		if (!m) throw new Error(`"${part}" is not a page or a range like 3-7.`);
		const a = Number(m[1]);
		const b = m[2] ? Number(m[2]) : a;
		if (a < 1 || b < a) throw new Error(`"${part}" is not a valid range.`);
		if (b > max) throw new Error(`The file has ${max} pages, so "${part}" is out of range.`);
		for (let p = a; p <= b; p++) pages.add(p);
	}
	return [...pages].sort((x, y) => x - y);
}
