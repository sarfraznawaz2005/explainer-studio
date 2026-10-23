import { readFile } from "node:fs/promises";
import type { ImageInput } from "../ai/providers/types";
import { headingLevel } from "./text";

/**
 * Reading text from page pictures.
 *
 * Vision: the page image goes to the Vision model, which answers in Markdown.
 * Markdown is used instead of JSON because free vision models follow it far
 * more reliably. Figures come back as ![caption](figure:x0,y0,x1,y1) lines with
 * a box in 0..1000 page units, so they can be cropped out of the page.
 *
 * Local: RapidOCR lines (text + box) are grouped into headings and paragraphs here.
 */

export type VisionAsk = (req: { system: string; prompt: string; images: ImageInput[] }, signal?: AbortSignal) => Promise<string>;

export const VISION_SYSTEM = [
	"You transcribe one page of learning material (a textbook, notes or a worksheet) into clean Markdown.",
	"Rules:",
	"- Copy the text exactly as printed, in reading order. Do not summarise, explain, translate or add anything.",
	"- Use # for the chapter or unit title, ## for section titles (like 2.3), ### for sub-sections (like 2.3.1).",
	"- Keep lists as Markdown lists, tables as Markdown pipe tables, and code, pseudocode or algorithms inside ``` fences.",
	"- Write maths in plain text (x^2, sqrt(x), a/b).",
	"- Leave out running headers, footers, page numbers, watermarks and decorative borders.",
	"- For every diagram, chart, photo or drawing, write one line: ![short caption](figure:x0,y0,x1,y1)",
	"  where x0,y0 is the top-left and x1,y1 the bottom-right corner of the picture on the page, each from 0 to 1000",
	"  (0,0 = top-left of the page; 1000,1000 = bottom-right). Use the printed caption if there is one.",
	"- If the page has no readable text, reply with exactly: (empty page)",
	"Reply with the Markdown only, without a code fence around the whole answer.",
].join("\n");

const MEDIA: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", png: "image/png" };
const mediaTypeOf = (path: string) => MEDIA[path.toLowerCase().split(".").pop() ?? ""] ?? "image/png";

/** Reads one page image with the vision model. Returns Markdown. */
export async function visionPage(ask: VisionAsk, image: string, pageLabel: string, signal?: AbortSignal): Promise<string> {
	const data = await readFile(image);
	const text = await ask({ system: VISION_SYSTEM, prompt: `Transcribe ${pageLabel}.`, images: [{ data, mediaType: mediaTypeOf(image) }] }, signal);
	const md = text
		.trim()
		.replace(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i, "$1")
		.trim();
	if (!md) throw new Error("The vision model returned an empty answer.");
	return /^\(empty page\)$/i.test(md) ? "" : md;
}

/** A figure reference written by the vision model, or null. */
export function parseFigureRef(src: string): [number, number, number, number] | null {
	const m = /^figure:\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)$/i.exec(src.trim());
	if (!m) return null;
	const [x0, y0, x1, y1] = m.slice(1).map((v) => Math.max(0, Math.min(1000, Number(v)))) as [number, number, number, number];
	return x1 - x0 >= 20 && y1 - y0 >= 20 ? [x0, y0, x1, y1] : null;
}

/**
 * Scans often carry a watermark that is also in the PDF's text layer (e.g. "SIDNH TEXTBOOK BOARD").
 * OCR returns broken pieces of it ("OOKBOARD", "SIDI"). Short all-caps lines that are a piece of
 * the watermark, or start like one of its words, are dropped.
 */
export function watermarkFilter(watermark: string): (text: string) => boolean {
	const words = watermark.toUpperCase().match(/[A-Z]{4,}/g) ?? [];
	if (!words.length) return () => false;
	const joined = words.join("");
	return (text) => {
		const t = text.trim();
		if (!/^[A-Z\s.:'-]{2,24}$/.test(t)) return false;
		const squeezed = t.replace(/[^A-Z]/g, "");
		if (squeezed.length < 2) return false;
		if (joined.includes(squeezed)) return true;
		return squeezed.length <= 5 && words.some((w) => w.startsWith(squeezed.slice(0, 3)));
	};
}

/**
 * Lines that repeat on most of the pages read as pictures (running heads, footers) are dropped.
 * Needs 3 or more pages to tell.
 */
export function dropRepeatedLines(pages: Map<number, string>): Map<number, string> {
	if (pages.size < 3) return pages;
	const norm = (l: string) => l.replace(/^#+\s*/, "").toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ").trim();
	// Running heads and footers sit at the top or bottom of a page; lines in the body are never touched.
	const edgeIdx = (lines: string[]) => {
		const filled = lines.map((l, i) => (norm(l) ? i : -1)).filter((i) => i >= 0);
		return new Set([...filled.slice(0, 2), ...filled.slice(-2)]);
	};
	const counts = new Map<string, number>();
	for (const md of pages.values()) {
		const lines = md.split("\n");
		for (const k of new Set([...edgeIdx(lines)].map((i) => norm(lines[i]!)).filter((k) => k.length <= 80))) counts.set(k, (counts.get(k) ?? 0) + 1);
	}
	const min = Math.max(3, Math.ceil(pages.size * 0.5));
	const out = new Map<number, string>();
	for (const [p, md] of pages) {
		const lines = md.split("\n");
		const edge = edgeIdx(lines);
		out.set(p, lines.filter((l, i) => !edge.has(i) || (counts.get(norm(l)) ?? 0) < min).join("\n").trim());
	}
	return out;
}

export type OcrLine = { text: string; box: [number, number, number, number]; score: number };

/**
 * Local OCR lines → Markdown. Lines on the same row are joined, a bigger gap
 * starts a new paragraph, and clearly taller short lines become headings.
 */
export function ocrToMarkdown(lines: OcrLine[], opts: { minScore?: number; watermark?: string } = {}): string {
	const junk = watermarkFilter(opts.watermark ?? "");
	const good = lines.filter((l) => l.score >= (opts.minScore ?? 0.6) && l.text.trim() && !junk(l.text));
	if (!good.length) return "";
	const height = (l: OcrLine) => l.box[3] - l.box[1];
	const median = [...good].map(height).sort((a, b) => a - b)[Math.floor((good.length - 1) / 2)]!;
	// Rows: lines whose vertical centres are close.
	const rows: OcrLine[][] = [];
	for (const l of [...good].sort((a, b) => a.box[1] - b.box[1] || a.box[0] - b.box[0])) {
		const cy = (l.box[1] + l.box[3]) / 2;
		const row = rows.find((r) => Math.abs((r[0]!.box[1] + r[0]!.box[3]) / 2 - cy) < median * 0.5);
		if (row) row.push(l);
		else rows.push([l]);
	}
	const out: string[] = [];
	let para: string[] = [];
	let lastBottom: number | null = null;
	const flush = () => {
		if (para.length) out.push(para.join(" ").replace(/(\w)- (\w)/g, "$1$2"));
		para = [];
	};
	for (const row of rows) {
		row.sort((a, b) => a.box[0] - b.box[0]);
		const text = row.map((l) => l.text.trim()).join("  ");
		const top = Math.min(...row.map((l) => l.box[1]));
		const bottom = Math.max(...row.map((l) => l.box[3]));
		const h = Math.max(...row.map(height));
		if (lastBottom !== null && top - lastBottom > median * 0.9) flush();
		// Only a lone line can be a heading: rows of several boxes are table cells or diagram labels.
		// "2.3" and its title are often two boxes on one row.
		const numberAndTitle = row.length === 2 && /^\d+(\.\d+)+\.?$/.test(row[0]!.text.trim());
		const numbered = row.length === 1 || numberAndTitle ? headingLevel(row.map((l) => l.text.trim()).join(" ").replace(/:$/, "")) : null;
		if (numbered && /^(\d+\.\d+(\.\d+)*\.?|chapter|unit|part|lesson|module)\s/i.test(text)) {
			flush();
			out.push(`${"#".repeat(Math.min(numbered, 4))} ${text}`);
		} else if (row.length === 1 && h >= median * 1.3 && text.length <= 80 && /\p{L}{3}/u.test(text)) {
			flush();
			out.push(`${h >= median * 1.7 ? "#" : "##"} ${text}`);
		} else if (/^\s*(?:[•▪●■➢►✓-]|\d{1,2}[.)])\s+/.test(text)) {
			flush();
			out.push(/^\s*\d/.test(text) ? text.replace(/^\s*(\d{1,2})[.)]\s+/, "$1. ") : `- ${text.replace(/^\s*\S\s+/, "")}`);
		} else para.push(text);
		lastBottom = bottom;
	}
	flush();
	// Consecutive list items stay in one list.
	const isItem = (t: string) => /^(- |\d+\. )/.test(t);
	return out.reduce((acc, t, i) => acc + (i === 0 ? "" : isItem(t) && isItem(out[i - 1]!) ? "\n" : "\n\n") + t, "");
}
