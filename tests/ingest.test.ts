import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parsePageRange, Source, sourceText, type Block } from "../src/shared/source";
import type { DocsMessage, DocsRunner } from "../src/main/ingest/docs-runner";
import { imageSize } from "../src/main/ingest/images";
import { compactPages, ingest, type IngestDeps, type IngestItem, type IngestProgress } from "../src/main/ingest/ingest";
import { dropRepeatedLines, ocrToMarkdown, parseFigureRef, type VisionAsk } from "../src/main/ingest/ocr";
import { furniture, toLines } from "../src/main/ingest/pdf-text";
import { headingLevel } from "../src/main/ingest/text";
import { DOC_NEEDS_LIBREOFFICE, findSoffice, IngestUserError } from "../src/main/ingest/word";
import { makeDocx, makePdf, makePng, type PdfPage } from "./fixtures";
import { tempDir } from "./helpers";

const NONE: IngestDeps = { docs: null, vision: null, soffice: null };

async function run(items: IngestItem[], deps: IngestDeps = NONE, ocr: "auto" | "vision" | "local" = "auto", progress?: IngestProgress[]) {
	const root = tempDir("es-ingest-");
	const draftDir = join(root, "draft");
	const source = await ingest({ items, ocr, draftDir, tmpDir: join(root, "tmp"), onProgress: (p) => progress?.push(p) }, deps);
	Source.parse(source); // always matches the schema
	return { source, draftDir, root };
}

const blocks = (s: Source, type: Block["type"]) => s.sections.flatMap((x) => x.blocks).filter((b) => b.type === type);
const headings = (s: Source) => s.sections.filter((x) => x.heading).map((x) => `${x.level}:${x.heading}`);

describe("helpers", () => {
	it("parses page ranges and compacts them back", () => {
		expect(parsePageRange("", 3)).toEqual([1, 2, 3]);
		expect(parsePageRange("81-85, 90 2", 240)).toEqual([2, 81, 82, 83, 84, 85, 90]);
		expect(() => parsePageRange("5-3", 10)).toThrow(/not a valid range/);
		expect(() => parsePageRange("9-12", 10)).toThrow(/10 pages/);
		expect(() => parsePageRange("abc", 10)).toThrow(/not a page/);
		expect(compactPages([3, 4, 5, 9, 11, 12])).toBe("3-5, 9, 11-12");
	});

	it("knows heading-like lines", () => {
		expect(headingLevel("Unit 2: Computational Thinking")).toBe(1);
		expect(headingLevel("2.3.1 Bubble Sort")).toBe(4);
		expect(headingLevel("PHOTOSYNTHESIS")).toBe(2);
		expect(headingLevel("This is a normal sentence that ends with a full stop.")).toBeNull();
	});

	it("reads image sizes from headers", () => {
		expect(imageSize(makePng(37, 21))).toEqual({ width: 37, height: 21 });
		expect(imageSize(Buffer.from("not an image"))).toEqual({ width: 0, height: 0 });
	});

	it("groups OCR lines into headings, paragraphs and lists", () => {
		const L = (text: string, y: number, h = 20, x = 50, score = 0.95) => ({ text, box: [x, y, x + 400, y + h] as [number, number, number, number], score });
		const md = ocrToMarkdown([
			L("Bubble Sort", 10, 40),
			L("Bubble sort compares adjacent", 70),
			L("elements and swaps them.", 92),
			L("• Simple to write", 150),
			L("• Slow on big lists", 172),
			L("OOKBOARD", 200, 20, 50, 0.3),
		]);
		expect(md).toBe("# Bubble Sort\n\nBubble sort compares adjacent elements and swaps them.\n\n- Simple to write\n- Slow on big lists");
	});

	it("drops watermark pieces and keeps diagram rows out of headings", () => {
		const L = (text: string, y: number, h = 20, x = 50) => ({ text, box: [x, y, x + 200, y + h] as [number, number, number, number], score: 0.95 });
		const md = ocrToMarkdown([L("Step 7: End", 10), L("OOKBOARD", 12, 60, 400), L("SIDI", 40, 60, 600), L("DATA = {8, 4}", 80), L("8", 120, 40, 50), L("4", 120, 40, 120)], { watermark: "SIDNH TEXTBOOK BOARD" });
		expect(md).not.toMatch(/OOKBOARD|SIDI/);
		expect(md).toMatch(/DATA = \{8, 4\}/);
		expect(md).not.toMatch(/^#/m);
	});

	it("drops running heads repeated on most OCR pages, keeps numbered steps as text", () => {
		const topics = ["Bubble sort swaps", "Selection sort picks", "Searching looks"];
		const pages = new Map([1, 2, 3].map((p) => [p, `# Unit 2: Algorithms\n\n${topics[p - 1]} items.\n\n1. Set temp := DATA[${"KLM"[p - 1]}]`] as [number, string]));
		pages.set(4, "## 2.3 Sorting\n\nOther.");
		const out = dropRepeatedLines(pages);
		expect(out.get(1)).toBe("Bubble sort swaps items.\n\n1. Set temp := DATA[K]");
		expect(out.get(4)).toBe("## 2.3 Sorting\n\nOther.");
		expect(ocrToMarkdown([{ text: "1. Set temp := DATA[K]", box: [0, 0, 300, 20], score: 0.99 }])).toBe("1. Set temp := DATA[K]");
	});

	it("parses figure boxes and drops tiny or broken ones", () => {
		expect(parseFigureRef("figure:100, 200, 900, 600")).toEqual([100, 200, 900, 600]);
		expect(parseFigureRef("figure:0,0,5,5")).toBeNull();
		expect(parseFigureRef("https://x/y.png")).toBeNull();
	});

	it("joins PDF text pieces into lines and finds running heads", () => {
		const lines = toLines([
			{ str: "World", x: 130, y: 700, size: 12, width: 30 },
			{ str: "Hello", x: 72, y: 700.5, size: 12, width: 50 },
			{ str: "Next line", x: 72, y: 680, size: 12, width: 60 },
		]);
		expect(lines.map((l) => l.text)).toEqual(["Hello World", "Next line"]);
		const page = (n: number) => ({ page: n, chars: 10, lines: [{ text: `Science Book ${n}`, x: 0, y: 10, size: 9 }, { text: `Unique ${n}`, x: 0, y: 500, size: 11 }] });
		const f = furniture([page(1), page(2), page(3)]);
		expect(f.has("science book #")).toBe(true);
		expect(f.has("unique #")).toBe(true); // same shape once digits are masked
	});
});

describe("plain text and typed text", () => {
	it("splits paragraphs, finds headings and bullet lists", async () => {
		const { source } = await run([{ kind: "text", title: "Notes", text: "PLANTS\n\nPlants make food from light.\nThey need water.\n\n- roots\n- leaves\n\n2.1 Roots\nRoots take in water." }]);
		expect(headings(source)).toEqual(["2:PLANTS", "3:2.1 Roots"]);
		expect(blocks(source, "paragraph")[0]).toEqual({ type: "paragraph", text: "Plants make food from light. They need water." });
		expect(blocks(source, "list")[0]).toEqual({ type: "list", ordered: false, items: ["roots", "leaves"] });
		expect(source.inputs[0]).toMatchObject({ kind: "text", name: "Notes" });
		expect(source.title).toBe("PLANTS");
		expect(source.stats.words).toBeGreaterThan(10);
	});

	it("reads typed Markdown as Markdown", async () => {
		const { source } = await run([{ kind: "text", text: "# Cells\n\nA cell is the smallest unit of life." }]);
		expect(headings(source)).toEqual(["1:Cells"]);
	});

	it("reads a .txt file and strips a BOM", async () => {
		const dir = tempDir();
		writeFileSync(join(dir, "a.txt"), "﻿Chapter 1 Light\n\nLight travels in straight lines.");
		const { source } = await run([{ kind: "file", path: join(dir, "a.txt") }]);
		expect(headings(source)).toEqual(["1:Chapter 1 Light"]);
		expect(source.inputs[0]!.kind).toBe("txt");
	});
});

describe("markdown", () => {
	it("reads headings, lists, tables, code, quotes and local images only", async () => {
		const dir = tempDir();
		mkdirSync(join(dir, "img"));
		writeFileSync(join(dir, "img", "leaf.png"), makePng(80, 60));
		writeFileSync(join(tempDir(), "outside.png"), makePng(10, 10));
		const md = [
			"---",
			"title: front matter is ignored",
			"---",
			"# Photosynthesis",
			"Plants **make** food in [leaves](https://x).",
			"",
			"## Inputs",
			"1. Light",
			"2. Water",
			"",
			"| Input | Source |",
			"|---|---|",
			"| Light | Sun |",
			"| CO2 | Air |",
			"",
			"```",
			"glucose = light + water + co2",
			"```",
			"",
			"> Leaves are green because of chlorophyll.",
			"",
			'![A leaf](img/leaf.png "Leaf cross-section")',
			"![Escape](../outside.png)",
			"![Remote](https://example.com/a.png)",
		].join("\n");
		writeFileSync(join(dir, "notes.md"), md);
		const { source, draftDir } = await run([{ kind: "file", path: join(dir, "notes.md") }]);
		expect(headings(source)).toEqual(["1:Photosynthesis", "2:Inputs"]);
		expect(blocks(source, "paragraph")[0]).toEqual({ type: "paragraph", text: "Plants make food in leaves." });
		expect(blocks(source, "list")[0]).toEqual({ type: "list", ordered: true, items: ["Light", "Water"] });
		expect(blocks(source, "table")[0]).toEqual({ type: "table", rows: [["Input", "Source"], ["Light", "Sun"], ["CO2", "Air"]], caption: null });
		expect(blocks(source, "code")[0]).toEqual({ type: "code", text: "glucose = light + water + co2" });
		expect(blocks(source, "quote")).toHaveLength(1);
		expect(source.figures).toHaveLength(1);
		expect(source.figures[0]).toMatchObject({ caption: "Leaf cross-section", width: 80, height: 60, mediaType: "image/png" });
		expect(existsSync(join(draftDir, source.figures[0]!.file))).toBe(true);
		expect(source.warnings.join(" ")).toMatch(/outside the document's folder/);
		expect(source.warnings.join(" ")).toMatch(/Images on the web were not downloaded/);
	});
});

describe("html", () => {
	it("keeps the main content and drops page furniture", async () => {
		const dir = tempDir();
		const png = makePng(64, 64).toString("base64");
		writeFileSync(
			join(dir, "page.html"),
			`<!doctype html><html><head><title>Water Cycle</title><script>alert(1)</script></head><body>
			<nav><a href="/">Home</a> Menu</nav>
			<main>
				<h1>The Water Cycle</h1>
				<p>Water moves between the sea, the air and the land.</p>
				<ul><li>Evaporation</li><li>Condensation <ul><li>clouds</li></ul></li></ul>
				<table><caption>Stages</caption><tr><th>Stage</th><th>Where</th></tr><tr><td>Rain</td><td>Sky</td></tr></table>
				<figure><img src="data:image/png;base64,${png}" alt="alt text"><figcaption>Figure 1: The cycle</figcaption></figure>
				<pre>def evaporate(): pass</pre>
				<form><input value="secret"></form>
			</main>
			<footer>Copyright</footer></body></html>`,
		);
		const { source } = await run([{ kind: "file", path: join(dir, "page.html") }]);
		const text = sourceText(source);
		expect(headings(source)).toEqual(["1:The Water Cycle"]);
		expect(text).not.toMatch(/Menu|Copyright|alert|secret/);
		expect(blocks(source, "list")[0]).toEqual({ type: "list", ordered: false, items: ["Evaporation", "Condensation – clouds"] });
		expect(blocks(source, "table")[0]).toEqual({ type: "table", rows: [["Stage", "Where"], ["Rain", "Sky"]], caption: "Stages" });
		expect(blocks(source, "code")[0]).toEqual({ type: "code", text: "def evaporate(): pass" });
		expect(source.figures[0]).toMatchObject({ caption: "Figure 1: The cycle", width: 64 });
	});
});

describe("word", () => {
	it("reads a .docx with headings, a picture and its caption", async () => {
		const dir = tempDir();
		const file = join(dir, "lesson.docx");
		writeFileSync(
			file,
			await makeDocx(
				[
					{ style: "Heading1", text: "Forces" },
					{ text: "A force is a push or a pull." },
					{ style: "Heading2", text: "Friction" },
					{ image: true },
					{ style: "Caption", text: "Figure 2: Friction slows a box" },
					{ text: "Friction acts against motion." },
				],
				makePng(120, 80),
			),
		);
		const { source, draftDir } = await run([{ kind: "file", path: file }]);
		expect(headings(source)).toEqual(["1:Forces", "2:Friction"]);
		expect(source.figures).toHaveLength(1);
		expect(source.figures[0]).toMatchObject({ caption: "Figure 2: Friction slows a box", width: 120, height: 80 });
		expect(existsSync(join(draftDir, source.figures[0]!.file))).toBe(true);
		// The caption is not repeated as a paragraph.
		expect(blocks(source, "paragraph").map((b) => (b as { text: string }).text)).toEqual(["A force is a push or a pull.", "Friction acts against motion."]);
	});

	it("explains what to do with a .doc when LibreOffice is missing", async () => {
		const dir = tempDir();
		writeFileSync(join(dir, "old.doc"), Buffer.from([0xd0, 0xcf, 0x11, 0xe0]));
		const err = await run([{ kind: "file", path: join(dir, "old.doc") }], { ...NONE, soffice: null }).catch((e) => e);
		expect(err).toBeInstanceOf(IngestUserError);
		expect(err.message).toBe(DOC_NEEDS_LIBREOFFICE);
		expect(err.message).toMatch(/Save As/);
		expect(findSoffice({ EXPLAINER_SOFFICE: "" })).toBeNull();
	});
});

const SAMPLE_PAGES: PdfPage[] = [
	{
		lines: [
			{ text: "Light and Colour", size: 24, y: 720 },
			{ text: "Light travels in straight lines from a source.", size: 11, y: 690 },
			{ text: "It moves very fast.", size: 11, y: 676 },
			{ text: "How a Prism Works", size: 16, y: 640 },
			{ text: "A prism splits white light into colours.", size: 11, y: 620 },
			{ text: "Science Book 1", size: 9, y: 30 },
		],
		image: { x: 150, y: 300, w: 220, h: 140, px: [110, 70] },
	},
	{
		lines: [
			{ text: "Each colour bends by a different amount.", size: 11, y: 720 },
			{ text: "Red bends the least and violet the most.", size: 11, y: 706 },
			{ text: "Science Book 2", size: 9, y: 30 },
		],
	},
	{ lines: [{ text: "Science Book 3", size: 9, y: 30 }] }, // a scanned page: only the running footer
];

describe("pdf", () => {
	it("reads the text layer with headings and drops running footers (no local engine)", async () => {
		const dir = tempDir();
		writeFileSync(join(dir, "light.pdf"), makePdf(SAMPLE_PAGES));
		const progress: IngestProgress[] = [];
		const { source } = await run([{ kind: "file", path: join(dir, "light.pdf") }], NONE, "auto", progress);
		expect(headings(source)).toEqual(["1:Light and Colour", "2:How a Prism Works"]);
		expect(source.sections[0]!.page).toBe(1);
		expect(sourceText(source)).not.toMatch(/Science Book/);
		expect(blocks(source, "paragraph")[0]).toEqual({ type: "paragraph", text: "Light travels in straight lines from a source. It moves very fast." });
		expect(source.inputs[0]).toMatchObject({ kind: "pdf", pageCount: 3, pages: [1, 2, 3] });
		expect(source.warnings.join(" ")).toMatch(/1 page\(s\) have no text layer/);
		expect(source.warnings.join(" ")).toMatch(/Figures were not saved/);
		expect(progress.some((p) => p.stage === "text" && p.page === 2 && p.pageCount === 3)).toBe(true);
		expect(progress.at(-1)!.progress).toBe(1);
	});

	it("only reads the chosen pages and rejects a bad range", async () => {
		const dir = tempDir();
		writeFileSync(join(dir, "light.pdf"), makePdf(SAMPLE_PAGES));
		const { source } = await run([{ kind: "file", path: join(dir, "light.pdf"), pages: "2" }]);
		expect(source.inputs[0]!.pages).toEqual([2]);
		expect(sourceText(source)).toBe("Each colour bends by a different amount. Red bends the least and violet the most.");
		await expect(run([{ kind: "file", path: join(dir, "light.pdf"), pages: "2-9" }])).rejects.toThrow(/3 pages/);
	});

	/** Stand-in for docs.py: page 1 has a figure, page 3 is a picture of a page. */
	function fakeDocs(dir: string, calls: string[][], opts: { ocrFails?: boolean } = {}): DocsRunner {
		const fig = join(dir, "pdf-fig.png");
		const render = join(dir, "p0003.png");
		writeFileSync(fig, makePng(110, 70));
		writeFileSync(render, makePng(300, 400, [250, 250, 250]));
		return async (args, onMessage) => {
			calls.push(args);
			const send = (m: DocsMessage) => onMessage(m);
			if (args[0] === "pdf") {
				const pages = args[args.indexOf("--pages") + 1]!.split(",").map(Number);
				pages.forEach((p, index) =>
					send({
						type: "page",
						page: p,
						index,
						total: pages.length,
						render: p === 3 ? render : null,
						figures: p === 1 ? [{ path: fig, width: 110, height: 70, bbox: [245, 455, 605, 620] }] : [],
					}),
				);
			} else if (args[0] === "ocr") {
				for (const image of args.slice(2))
					send(
						opts.ocrFails
							? { type: "ocr", image, error: "boom" }
							: { type: "ocr", image, lines: [{ text: "Rainbows", box: [10, 10, 300, 60], score: 0.99 }, { text: "A rainbow is a circle of colours.", box: [10, 80, 300, 100], score: 0.97 }] },
					);
			} else if (args[0] === "crop") {
				const jobs = JSON.parse(readFileSync(args[2]!, "utf8")) as { out: string }[];
				for (const j of jobs) {
					copyFileSync(fig, j.out);
					send({ type: "crop", out: j.out, width: 110, height: 70 });
				}
			}
		};
	}

	it("saves embedded figures and reads a scanned page with AI vision (figure cropped)", async () => {
		const dir = tempDir();
		writeFileSync(join(dir, "light.pdf"), makePdf(SAMPLE_PAGES));
		const calls: string[][] = [];
		const asked: string[] = [];
		const vision: VisionAsk = async (req) => {
			asked.push(req.prompt);
			expect(req.images[0]!.mediaType).toBe("image/png");
			return "```markdown\n## Rainbows\n\nA rainbow is a circle of colours.\n\n![The colours of a rainbow](figure:100,500,900,800)\n```";
		};
		const { source, draftDir } = await run([{ kind: "file", path: join(dir, "light.pdf") }], { docs: fakeDocs(dir, calls), vision, soffice: null });
		expect(asked).toEqual(["Transcribe page 3."]);
		expect(headings(source)).toEqual(["1:Light and Colour", "2:How a Prism Works", "2:Rainbows"]);
		expect(source.sections.at(-1)!.page).toBe(3);
		expect(source.figures).toHaveLength(2);
		expect(source.figures[0]).toMatchObject({ page: 1, width: 110, caption: null });
		expect(source.figures[1]).toMatchObject({ page: 3, caption: "The colours of a rainbow" });
		for (const f of source.figures) expect(existsSync(join(draftDir, f.file))).toBe(true);
		// Every figure is placed in the text.
		expect(blocks(source, "figure")).toHaveLength(2);
		expect(source.inputs[0]!.ocr).toEqual([{ page: 3, method: "vision" }]);
		expect(calls.map((c) => c[0])).toEqual(["pdf", "crop"]);
		expect(source.warnings).toEqual([]);
	});

	it("falls back to local OCR when vision fails, and reports pages it could not read", async () => {
		const dir = tempDir();
		writeFileSync(join(dir, "light.pdf"), makePdf(SAMPLE_PAGES));
		const calls: string[][] = [];
		const vision: VisionAsk = async () => {
			throw new Error("model does not support images");
		};
		const { source } = await run([{ kind: "file", path: join(dir, "light.pdf") }], { docs: fakeDocs(dir, calls), vision, soffice: null });
		expect(source.inputs[0]!.ocr).toEqual([{ page: 3, method: "local-ocr" }]);
		expect(headings(source)).toContain("1:Rainbows");
		expect(source.warnings.join(" ")).toMatch(/AI vision stopped working \(model does not support images\)/);

		const local = await run([{ kind: "file", path: join(dir, "light.pdf") }], { docs: fakeDocs(dir, [], { ocrFails: true }), vision: null, soffice: null }, "local");
		expect(local.source.warnings.join(" ")).toMatch(/page 3 could not be read: boom/);
		expect(local.source.warnings.join(" ")).toMatch(/Page\(s\) 3 could not be read/);
	});

	it("stops when cancelled", async () => {
		const dir = tempDir();
		writeFileSync(join(dir, "light.pdf"), makePdf(SAMPLE_PAGES));
		const ac = new AbortController();
		const vision: VisionAsk = async () => {
			ac.abort(new Error("Cancelled by the user"));
			throw new Error("aborted");
		};
		const root = tempDir();
		await expect(
			ingest({ items: [{ kind: "file", path: join(dir, "light.pdf") }], ocr: "auto", draftDir: join(root, "d"), tmpDir: join(root, "t"), signal: ac.signal }, { docs: fakeDocs(dir, []), vision, soffice: null }),
		).rejects.toThrow(/aborted|Cancelled/);
	});
});

describe("images and errors", () => {
	it("keeps a photo as a figure and reads its text with vision", async () => {
		const dir = tempDir();
		writeFileSync(join(dir, "board.jpg"), makePng(50, 40)); // content type is sniffed by the reader, not the name
		writeFileSync(join(dir, "board.png"), makePng(50, 40));
		const vision: VisionAsk = async (req) => {
			expect(req.images[0]!.mediaType).toBe("image/png");
			return "# Whiteboard\n\nNewton's first law.";
		};
		const { source } = await run([{ kind: "file", path: join(dir, "board.png") }], { docs: null, vision, soffice: null });
		expect(headings(source)).toEqual(["1:Whiteboard"]);
		expect(source.figures[0]).toMatchObject({ caption: "board.png", width: 50 });
		expect(source.inputs[0]!.ocr).toEqual([{ page: 1, method: "vision" }]);
	});

	it("gives clear errors for missing, unsupported and empty input", async () => {
		const dir = tempDir();
		await expect(run([{ kind: "file", path: join(dir, "gone.pdf") }])).rejects.toThrow(/could not be found/);
		writeFileSync(join(dir, "x.exe"), "MZ");
		await expect(run([{ kind: "file", path: join(dir, "x.exe") }])).rejects.toThrow(/not a supported file type/);
		writeFileSync(join(dir, "broken.pdf"), "not a pdf");
		await expect(run([{ kind: "file", path: join(dir, "broken.pdf") }])).rejects.toThrow(/could not be opened as a PDF/);
		await expect(run([{ kind: "text", text: "   " }])).rejects.toThrow(/No text was found/);
		await expect(run([])).rejects.toThrow(/at least one/);
	});

	it("merges several inputs into one Source", async () => {
		const dir = tempDir();
		writeFileSync(join(dir, "a.md"), "# Part A\n\nAlpha.");
		const { source } = await run([{ kind: "file", path: join(dir, "a.md") }, { kind: "text", text: "# Part B\n\nBeta." }]);
		expect(source.inputs.map((x) => x.kind)).toEqual(["md", "text"]);
		expect(source.sections.map((x) => x.input)).toEqual([0, 1]);
		expect(source.title).toBe("Part A");
	});
});
