import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { kindOfFile, parsePageRange, type InputKind, type ReadMethod, type Source } from "@shared/source";
import { SourceBuilder } from "./builder";
import type { DocsRunner } from "./docs-runner";
import { readHtml } from "./html";
import { createImageSaver, type ImageSaver } from "./images";
import { readMarkdown } from "./markdown";
import { dropRepeatedLines, ocrToMarkdown, parseFigureRef, visionPage, type OcrLine, type VisionAsk } from "./ocr";
import { bodySize, emitPage, furniture, headingSizes, isFurniture, pdfPageCount, readPdfText, type PageText } from "./pdf-text";
import { readPlainText } from "./text";
import { IngestUserError, readDoc, readDocx } from "./word";

export type IngestItem = { kind: "file"; path: string; pages?: string } | { kind: "text"; text: string; title?: string };
export type OcrMode = "auto" | "vision" | "local";

export type IngestProgress = {
	fileIndex: number;
	fileCount: number;
	fileName: string;
	stage: "text" | "pages" | "ocr" | "figures" | "saving";
	/** 0..1 for the whole job. */
	progress: number;
	page?: number;
	pageIndex?: number;
	pageCount?: number;
	method?: ReadMethod;
	detail: string;
};

export type IngestDeps = {
	/** docs.py runner; null when the local engine is not installed. */
	docs: DocsRunner | null;
	/** Vision model; null when no AI provider is set up. */
	vision: VisionAsk | null;
	soffice?: string | null;
	log?: (msg: string) => void;
};

export type IngestRequest = {
	items: IngestItem[];
	ocr: OcrMode;
	/** Output folder; figures go to <draftDir>/source/figures. */
	draftDir: string;
	/** Scratch folder for page renders and conversions. The caller deletes it. */
	tmpDir: string;
	signal?: AbortSignal;
	onProgress?: (p: IngestProgress) => void;
};

/** Pages with fewer real characters than this are read as pictures. */
const OCR_BELOW_CHARS = 40;
const MAX_FILE_BYTES: Partial<Record<InputKind, number>> = { pdf: 500 * 1024 * 1024 };
const DEFAULT_MAX_BYTES = 60 * 1024 * 1024;
export const MAX_TEXT_CHARS = 2_000_000;

const NO_LOCAL_ENGINE = "Install the local engine in Settings → Voice to read scanned pages and save figures.";

/** Reads every item into one Source. Throws IngestUserError for problems the user can fix. */
export async function ingest(req: IngestRequest, deps: IngestDeps): Promise<Source> {
	const b = new SourceBuilder();
	const count = req.items.length;
	if (!count) throw new IngestUserError("Add at least one file or some text.");
	await mkdir(req.tmpDir, { recursive: true });
	let fallbackTitle = "Untitled";

	for (let i = 0; i < count; i++) {
		req.signal?.throwIfAborted();
		const item = req.items[i]!;
		const name = item.kind === "file" ? basename(item.path) : (item.title?.trim() || "Typed text");
		if (i === 0) fallbackTitle = item.kind === "file" ? basename(item.path, extname(item.path)) : name;
		const share = (f: number) => (i + Math.max(0, Math.min(1, f))) / count;
		const report = (stage: IngestProgress["stage"], f: number, detail: string, extra: Partial<IngestProgress> = {}) =>
			req.onProgress?.({ fileIndex: i, fileCount: count, fileName: name, stage, progress: share(f), detail, ...extra });
		const images = createImageSaver({ draftDir: req.draftDir, prefix: `in${i + 1}`, onSkip: (why) => b.warn(why) });

		if (item.kind === "text") {
			if (item.text.length > MAX_TEXT_CHARS) throw new IngestUserError("The typed text is too long (over 2 million characters).");
			b.beginInput({ kind: "text", name, pageCount: null, pages: null, ocr: [] });
			report("text", 0, "Reading the text");
			if (/^#{1,6}\s/m.test(item.text)) await readMarkdown(item.text, b, async () => null);
			else readPlainText(item.text, b);
			report("text", 1, "Done");
			continue;
		}

		const kind = kindOfFile(item.path);
		if (!kind) throw new IngestUserError(`${name} is not a supported file type.`);
		const st = await stat(item.path).catch(() => null);
		if (!st?.isFile()) throw new IngestUserError(`${name} could not be found. It may have been moved or deleted.`);
		if (st.size > (MAX_FILE_BYTES[kind] ?? DEFAULT_MAX_BYTES)) throw new IngestUserError(`${name} is too large to read.`);
		report("text", 0, `Opening ${name}`);

		switch (kind) {
			case "txt": {
				b.beginInput({ kind, name, pageCount: null, pages: null, ocr: [] });
				readPlainText(stripBom(await readFile(item.path, "utf8")), b);
				break;
			}
			case "md": {
				b.beginInput({ kind, name, pageCount: null, pages: null, ocr: [] });
				await readMarkdown(stripBom(await readFile(item.path, "utf8")), b, images.resolverFor(item.path));
				break;
			}
			case "html": {
				b.beginInput({ kind, name, pageCount: null, pages: null, ocr: [] });
				const r = await readHtml(stripBom(await readFile(item.path, "utf8")), b, images.resolverFor(item.path));
				if (i === 0 && r.title) fallbackTitle = r.title;
				break;
			}
			case "docx": {
				b.beginInput({ kind, name, pageCount: null, pages: null, ocr: [] });
				await readDocx(item.path, b, images);
				break;
			}
			case "doc": {
				b.beginInput({ kind, name, pageCount: null, pages: null, ocr: [] });
				report("text", 0.2, `Converting ${name} with LibreOffice`);
				await readDoc(item.path, b, images, join(req.tmpDir, `doc-${i}`), req.signal, deps.soffice === undefined ? undefined : deps.soffice);
				break;
			}
			case "image":
				await readImage(item.path, name, b, images, req, deps, report);
				break;
			case "pdf":
				await readPdf(item.path, item.pages ?? "", name, b, images, req, deps, report, i);
				break;
		}
		report("saving", 1, "Done");
	}
	const source = b.build(fallbackTitle);
	if (!source.sections.length) throw new IngestUserError("No text was found in the material. If it is a scan, install the local engine or set up an AI provider with vision.");
	return source;
}

const stripBom = (s: string) => s.replace(/^﻿/, "");

type Report = (stage: IngestProgress["stage"], f: number, detail: string, extra?: Partial<IngestProgress>) => void;

/** Reads page pictures: vision first (unless local only), then local OCR for what is left. */
async function readPictures(
	pics: { page: number; image: string; label: string; watermark?: string }[],
	req: IngestRequest,
	deps: IngestDeps,
	report: (f: number, detail: string, extra: Partial<IngestProgress>) => void,
	warn: (w: string) => void,
): Promise<Map<number, { md: string; method: ReadMethod }>> {
	const out = new Map<number, { md: string; method: ReadMethod }>();
	if (!pics.length) return out;
	const useVision = req.ocr !== "local" && !!deps.vision;
	const left: typeof pics = [];
	if (req.ocr === "vision" && !deps.vision) warn("AI vision was chosen, but no AI provider is set up. Add one in Settings → AI providers.");
	let visionError: string | null = null;
	for (let k = 0; k < pics.length; k++) {
		const p = pics[k]!;
		req.signal?.throwIfAborted();
		if (!useVision || visionError) {
			left.push(p);
			continue;
		}
		report(k / pics.length, `Reading ${p.label} with AI vision`, { page: p.page, pageIndex: k, pageCount: pics.length, method: "vision" });
		try {
			out.set(p.page, { md: await visionPage(deps.vision!, p.image, p.label, req.signal), method: "vision" });
		} catch (err) {
			if (req.signal?.aborted) throw err;
			deps.log?.(`vision failed on ${p.label}: ${(err as Error).message}`);
			left.push(p);
			// One failure is often the model, not the page: stop asking and read the rest locally.
			if (req.ocr === "auto") visionError = (err as Error).message;
		}
	}
	if (visionError) warn(`AI vision stopped working (${visionError.slice(0, 160)}). The other pages were read on this PC.`);
	const local = req.ocr === "vision" ? [] : left;
	if (req.ocr === "vision" && left.length) warn(`${left.length} page(s) could not be read with AI vision.`);
	if (local.length && !deps.docs) {
		warn(`${local.length} page(s) are pictures and were not read. ${NO_LOCAL_ENGINE}`);
		return out;
	}
	if (local.length) {
		let done = 0;
		const byImage = new Map(local.map((p) => [p.image, p]));
		report(0.5, `Reading ${local[0]!.label} on this PC`, { page: local[0]!.page, pageIndex: 0, pageCount: local.length, method: "local-ocr" });
		await deps.docs!(
			["ocr", "--images", ...local.map((p) => p.image)],
			(m) => {
				if (m.type !== "ocr") return;
				const p = byImage.get(String(m.image));
				if (!p) return;
				done++;
				if (m.error) warn(`${p.label} could not be read: ${String(m.error).slice(0, 120)}`);
				else out.set(p.page, { md: ocrToMarkdown(m.lines as OcrLine[], { watermark: p.watermark }), method: "local-ocr" });
				const next = local[done];
				report(0.5 + (0.5 * done) / local.length, next ? `Reading ${next.label} on this PC` : "Pages read", { page: next?.page ?? p.page, pageIndex: done, pageCount: local.length, method: "local-ocr" });
			},
			req.signal,
		);
	}
	return out;
}

/** Figure refs in vision Markdown: crops them out of the page image in one helper run. */
async function cropFigures(mds: { page: number; md: string; image: string }[], req: IngestRequest, deps: IngestDeps, warn: (w: string) => void) {
	const jobs: { image: string; box: number[]; out: string; key: string }[] = [];
	for (const { page, md, image } of mds) {
		for (const m of md.matchAll(/!\[[^\]]*\]\((figure:[^)]+)\)/g)) {
			const box = parseFigureRef(m[1]!);
			if (box) jobs.push({ image, box, out: join(req.tmpDir, `crop-p${page}-${jobs.length + 1}.png`), key: `${page}|${m[1]!.replace(/\s/g, "")}` });
		}
	}
	const done = new Map<string, string>();
	if (!jobs.length) return done;
	if (!deps.docs) {
		warn(`Figures on scanned pages were not saved. ${NO_LOCAL_ENGINE}`);
		return done;
	}
	const file = join(req.tmpDir, `crops-${Date.now()}.json`);
	await writeFile(file, JSON.stringify(jobs.map(({ image, box, out }) => ({ image, box, out }))));
	const byOut = new Map(jobs.map((j) => [j.out, j.key]));
	await deps.docs(["crop", "--jobs", file], (m) => {
		if (m.type === "crop" && !m.error && byOut.has(String(m.out))) done.set(byOut.get(String(m.out))!, String(m.out));
	}, req.signal);
	return done;
}

async function readImage(path: string, name: string, b: SourceBuilder, images: ImageSaver, req: IngestRequest, deps: IngestDeps, report: Report) {
	b.beginInput({ kind: "image", name, pageCount: null, pages: null, ocr: [] });
	const input = b.inputs[b.inputIndex]!;
	const warn = (w: string) => b.warn(`${name}: ${w}`);
	const saved = await images.saveFile(path);
	// Formats the helper cannot open directly are still kept as figures.
	const read = await readPictures([{ page: 1, image: path, label: name }], req, deps, (f, detail, extra) => report("ocr", 0.1 + f * 0.8, detail, extra), warn);
	const r = read.get(1);
	if (r) {
		input.ocr.push({ page: 1, method: r.method });
		const crops = r.method === "vision" ? await cropFigures([{ page: 1, md: r.md, image: path }], req, deps, warn) : new Map<string, string>();
		await readMarkdown(r.md, b, async (src) => {
			const c = crops.get(`1|${src.replace(/\s/g, "")}`);
			return c ? images.saveFile(c).then((f) => (f ? { ...f, page: null } : null)) : null;
		});
	}
	if (saved) b.figure({ ...saved, caption: name, page: null });
}

async function readPdf(path: string, range: string, name: string, b: SourceBuilder, images: ImageSaver, req: IngestRequest, deps: IngestDeps, report: Report, fileIndex: number) {
	let total: number;
	try {
		total = await pdfPageCount(path);
	} catch (err) {
		throw new IngestUserError(/password/i.test((err as Error).message) ? `${name} is protected with a password. Remove the password and try again.` : `${name} could not be opened as a PDF.`);
	}
	let pages: number[];
	try {
		pages = parsePageRange(range, total);
	} catch (err) {
		throw new IngestUserError(`${name}: ${(err as Error).message}`);
	}
	b.beginInput({ kind: "pdf", name, pageCount: total, pages, ocr: [] });
	const input = b.inputs[b.inputIndex]!;
	const warn = (w: string) => b.warn(`${name}: ${w}`);

	// 1. Text layer (fast, no Python needed).
	const text = await readPdfText(path, pages, {
		signal: req.signal,
		onPage: (page, k) => report("text", (0.15 * (k + 1)) / pages.length, `Reading text of page ${page}`, { page, pageIndex: k, pageCount: pages.length, method: "text" }),
	});
	// Running heads only show up across pages, so a short selection borrows a few neighbours to spot them.
	const extra: number[] = [];
	for (let d = 1; pages.length + extra.length < 6 && d < total; d++) {
		for (const p of [pages[0]! - d, pages.at(-1)! + d]) if (p >= 1 && p <= total && !pages.includes(p) && extra.length + pages.length < 6) extra.push(p);
	}
	const junk = furniture(extra.length ? [...text, ...(await readPdfText(path, extra, { signal: req.signal }))] : text);
	const realChars = (p: PageText) => p.lines.filter((l) => !isFurniture(junk, l.text)).reduce((n, l) => n + l.text.replace(/\s/g, "").length, 0);
	const textByPage = new Map(text.map((p) => [p.page, p]));

	// 2. Page pictures and embedded figures (Python helper).
	type PageInfo = { render: string | null; figures: { path: string; width: number; height: number; bbox: number[] }[] };
	const info = new Map<number, PageInfo>();
	if (deps.docs) {
		const out = join(req.tmpDir, `pdf-${fileIndex}`);
		await deps.docs(
			["pdf", "--file", path, "--pages", pages.join(","), "--out", out, "--render", "auto"],
			(m) => {
				if (m.type !== "page" || m.error) return;
				const page = Number(m.page);
				info.set(page, { render: (m.render as string | null) ?? null, figures: (m.figures as PageInfo["figures"]) ?? [] });
				const k = Number(m.index ?? 0);
				report("figures", 0.15 + (0.2 * (k + 1)) / pages.length, `Looking at page ${page}`, { page, pageIndex: k, pageCount: pages.length });
			},
			req.signal,
		);
	}

	// 3. Pages without a real text layer are read as pictures.
	const needOcr = pages.filter((p) => realChars(textByPage.get(p) ?? { page: p, lines: [], chars: 0 }) < OCR_BELOW_CHARS);
	// On a scanned page the text layer holds only furniture (a watermark, running head): OCR drops pieces of it.
	const pics = needOcr
		.filter((p) => info.get(p)?.render)
		.map((p) => ({ page: p, image: info.get(p)!.render!, label: `page ${p}`, watermark: (textByPage.get(p)?.lines ?? []).map((l) => l.text).join(" ") }));
	if (needOcr.length && !deps.docs) warn(`${needOcr.length} page(s) have no text layer (scanned) and were not read. ${NO_LOCAL_ENGINE}`);
	if (!deps.docs && pages.length) warn(`Figures were not saved. ${NO_LOCAL_ENGINE}`);
	const raw = await readPictures(pics, req, deps, (f, detail, extra) => report("ocr", 0.35 + 0.6 * f, detail, extra), warn);
	const cleaned = dropRepeatedLines(new Map([...raw].map(([p, r]) => [p, r.md])));
	const read = new Map([...raw].map(([p, r]) => [p, { ...r, md: cleaned.get(p) ?? r.md }]));
	const visionMds = [...read].filter(([, r]) => r.method === "vision").map(([page, r]) => ({ page, md: r.md, image: info.get(page)!.render! }));
	const crops = await cropFigures(visionMds, req, deps, warn);

	// 4. Everything in page order.
	report("saving", 0.96, "Putting the pages together");
	const body = bodySize(text);
	const levels = headingSizes(text, body);
	for (const page of pages) {
		const figs = info.get(page)?.figures ?? [];
		const used = new Set<string>();
		const r = read.get(page);
		if (r) {
			input.ocr.push({ page, method: r.method });
			await readMarkdown(r.md, wrapPage(b, page), async (src) => {
				const box = parseFigureRef(src);
				if (!box) return null;
				// Prefer the PDF's own picture when the model's box overlaps one: it is sharper.
				const own = figs.find((f) => !used.has(f.path) && overlap(f.bbox, box) > 0.3);
				if (own) {
					used.add(own.path);
					const f = await images.saveFile(own.path);
					return f ? { ...f, page } : null;
				}
				const c = crops.get(`${page}|${src.replace(/\s/g, "")}`);
				const f = c ? await images.saveFile(c) : null;
				return f ? { ...f, page } : null;
			});
		} else if (!needOcr.includes(page)) {
			const t = textByPage.get(page);
			if (t)
				emitPage(t.lines, body, levels, (s) => isFurniture(junk, s), {
					heading: (s, level) => b.heading(s, level, page),
					paragraph: (s) => b.paragraph(s, page),
					list: (items, ordered) => b.add({ type: "list", ordered, items }, page),
				});
		}
		for (const f of figs) {
			if (used.has(f.path)) continue;
			const saved = await images.saveFile(f.path);
			if (saved) b.figure({ ...saved, caption: null, page }, page);
		}
	}
	const unread = needOcr.filter((p) => !read.has(p));
	if (unread.length && deps.docs) warn(`Page(s) ${compactPages(unread)} could not be read.`);
}

/** A builder view that stamps headings with the page number. */
function wrapPage(b: SourceBuilder, page: number): SourceBuilder {
	return new Proxy(b, {
		get(target, prop, receiver) {
			if (prop === "heading") return (text: string, level: number) => target.heading(text, level, page);
			if (prop === "figure") return (f: Parameters<SourceBuilder["figure"]>[0]) => target.figure({ ...f, page }, page);
			if (prop === "add") return (block: Parameters<SourceBuilder["add"]>[0]) => target.add(block, page);
			if (prop === "paragraph") return (text: string) => target.paragraph(text, page);
			return Reflect.get(target, prop, receiver);
		},
	});
}

/** Share of box a covered by box b (both x0,y0,x1,y1). */
function overlap(a: number[], b: number[]): number {
	const w = Math.max(0, Math.min(a[2]!, b[2]!) - Math.max(a[0]!, b[0]!));
	const h = Math.max(0, Math.min(a[3]!, b[3]!) - Math.max(a[1]!, b[1]!));
	const area = (a[2]! - a[0]!) * (a[3]! - a[1]!);
	return area > 0 ? (w * h) / area : 0;
}

/** [3,4,5,9] → "3-5, 9" */
export function compactPages(pages: number[]): string {
	const out: string[] = [];
	for (let i = 0; i < pages.length; i++) {
		let j = i;
		while (j + 1 < pages.length && pages[j + 1] === pages[j]! + 1) j++;
		out.push(i === j ? String(pages[i]) : `${pages[i]}-${pages[j]}`);
		i = j;
	}
	return out.join(", ");
}
