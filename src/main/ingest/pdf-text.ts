import { readFile } from "node:fs/promises";

export type TextItem = { str: string; x: number; y: number; size: number; width: number };
export type Line = { text: string; x: number; y: number; size: number };
export type PageText = { page: number; lines: Line[]; chars: number };

/** pdfjs is ESM-only and large; it loads on first use. */
async function pdfjs() {
	return import("pdfjs-dist/legacy/build/pdf.mjs");
}

export async function pdfPageCount(file: string): Promise<number> {
	const { getDocument } = await pdfjs();
	const task = getDocument({ data: new Uint8Array(await readFile(file)), verbosity: 0, useSystemFonts: false });
	const doc = await task.promise;
	try {
		return doc.numPages;
	} finally {
		await task.destroy();
	}
}

/** Text lines of the chosen pages, top to bottom. Calls onPage after each page. */
export async function readPdfText(file: string, pages: number[], opts: { signal?: AbortSignal; onPage?: (page: number, i: number) => void } = {}): Promise<PageText[]> {
	const { getDocument } = await pdfjs();
	const task = getDocument({ data: new Uint8Array(await readFile(file)), verbosity: 0, useSystemFonts: false });
	const doc = await task.promise;
	const out: PageText[] = [];
	try {
		for (let i = 0; i < pages.length; i++) {
			opts.signal?.throwIfAborted();
			const page = await doc.getPage(pages[i]!);
			const tc = await page.getTextContent();
			const items: TextItem[] = [];
			for (const it of tc.items) {
				if (!("str" in it) || !it.str.trim()) continue;
				const [a, b, , , x, y] = it.transform as number[];
				items.push({ str: it.str, x: x!, y: y!, size: Math.hypot(a!, b!) || it.height, width: it.width });
			}
			const lines = toLines(items);
			out.push({ page: pages[i]!, lines, chars: lines.reduce((n, l) => n + l.text.replace(/\s/g, "").length, 0) });
			page.cleanup();
			opts.onPage?.(pages[i]!, i);
		}
	} finally {
		await task.destroy();
	}
	return out;
}

/** Groups text pieces into lines: same baseline (within half a font size), left to right. */
export function toLines(items: TextItem[]): Line[] {
	const sorted = [...items].sort((p, q) => q.y - p.y || p.x - q.x);
	const lines: { items: TextItem[]; y: number; size: number }[] = [];
	for (const it of sorted) {
		const line = lines.find((l) => Math.abs(l.y - it.y) < Math.max(l.size, it.size) * 0.5);
		if (line) {
			line.items.push(it);
			line.size = Math.max(line.size, it.size);
		} else lines.push({ items: [it], y: it.y, size: it.size });
	}
	return lines
		.sort((p, q) => q.y - p.y)
		.map((l) => {
			const its = l.items.sort((p, q) => p.x - q.x);
			let text = "";
			let end = -Infinity;
			for (const it of its) {
				const gap = it.x - end;
				text += text && gap > it.size * 0.15 && !/\s$/.test(text) && !/^\s/.test(it.str) ? ` ${it.str}` : it.str;
				end = it.x + it.width;
			}
			return { text: text.replace(/\s+/g, " ").trim(), x: its[0]!.x, y: l.y, size: Math.round(l.size * 2) / 2 };
		})
		.filter((l) => l.text);
}

/** Text that repeats on many pages (running heads, footers, watermarks) or is just a page number. */
export function furniture(pages: PageText[]): Set<string> {
	const key = (t: string) => t.toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ").trim();
	const counts = new Map<string, number>();
	for (const p of pages) for (const k of new Set(p.lines.map((l) => key(l.text)))) counts.set(k, (counts.get(k) ?? 0) + 1);
	const out = new Set<string>();
	const min = Math.max(3, Math.ceil(pages.length * 0.5));
	for (const [k, n] of counts) if (pages.length >= 3 && n >= min) out.add(k);
	return out;
}

export const isFurniture = (set: Set<string>, text: string) =>
	/^(page\s*)?\d{1,4}(\s*(of|\/)\s*\d{1,4})?$/i.test(text.trim()) || set.has(text.toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ").trim());

/** The most common font size, weighted by characters: the body text size. */
export function bodySize(pages: PageText[]): number {
	const w = new Map<number, number>();
	for (const p of pages) for (const l of p.lines) w.set(l.size, (w.get(l.size) ?? 0) + l.text.length);
	let best = 10;
	let max = -1;
	for (const [s, n] of w) if (n > max) [best, max] = [s, n];
	return best;
}

/** Heading level for each size clearly bigger than the body (largest = 1, up to 3). */
export function headingSizes(pages: PageText[], body: number): Map<number, number> {
	const sizes = [...new Set(pages.flatMap((p) => p.lines.filter((l) => l.size >= body * 1.18 && l.text.length <= 120).map((l) => l.size)))].sort((a, b) => b - a);
	return new Map(sizes.slice(0, 3).map((s, i) => [s, i + 1]));
}

const BULLET = /^\s*(?:[•▪◦●○■□➢►✓·-]|\(?[a-z0-9]{1,3}[.)])\s+/i;

export type PdfEmit = { heading: (text: string, level: number) => void; paragraph: (text: string) => void; list: (items: string[], ordered: boolean) => void };

/** Turns one page's lines into headings, paragraphs and lists. */
export function emitPage(lines: Line[], body: number, levels: Map<number, number>, skip: (t: string) => boolean, out: PdfEmit): void {
	let para: string[] = [];
	let list: string[] = [];
	let ordered = false;
	let lastY: number | null = null;
	let lastSize = body;
	const flushPara = () => {
		if (para.length) out.paragraph(para.join(" ").replace(/(\w)- (\w)/g, "$1$2"));
		para = [];
	};
	const flushList = () => {
		if (list.length) out.list(list, ordered);
		list = [];
	};
	for (const l of lines) {
		if (skip(l.text)) continue;
		const level = levels.get(l.size);
		if (level) {
			flushPara();
			flushList();
			out.heading(l.text, level);
			lastY = l.y;
			lastSize = l.size;
			continue;
		}
		const gap = lastY === null ? 0 : lastY - l.y;
		const newBlock = gap > Math.max(l.size, lastSize) * 1.75;
		if (BULLET.test(l.text)) {
			flushPara();
			if (!list.length) ordered = /^\s*\(?\d/.test(l.text);
			list.push(l.text.replace(BULLET, ""));
		} else if (list.length && !newBlock) {
			list[list.length - 1] += ` ${l.text}`;
		} else {
			flushList();
			if (newBlock) flushPara();
			para.push(l.text);
		}
		lastY = l.y;
		lastSize = l.size;
	}
	flushPara();
	flushList();
}
