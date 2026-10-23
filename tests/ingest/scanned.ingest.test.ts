import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { sourceText, type Source } from "../../src/shared/source";
import { createProviderAdapter } from "../../src/main/ai/providers";
import { runText } from "../../src/main/ai/run";
import { ingest, type IngestProgress } from "../../src/main/ingest/ingest";
import type { VisionAsk } from "../../src/main/ingest/ocr";
import { createVoiceEngine } from "../../src/main/voice/engine";
import { tempDir } from "../helpers";

/**
 * Computer Science XI.pdf, pages 81-85 (scanned: no text layer except a watermark),
 * read with Claude (through the Claude Code CLI) and with RapidOCR on this PC.
 * Needs the local engine installed and up to date (Settings → Voice → Repair).
 */
const PDF = resolve("..", "Computer Science XI.pdf");
const root = process.env.EXPLAINER_VOICE_DIR ?? join(process.env.APPDATA ?? "", "Explainer Studio", "python");
const engine = createVoiceEngine({ root, scriptsDir: resolve("resources/python"), log: (l, m) => l !== "info" && console.log(`[engine:${l}] ${m}`) });
const ready = existsSync(PDF) && engine.isReady();
/** Vision runs through the local Claude Code CLI login (claude-subscription provider). */
const VISION_MODEL = process.env.EXPLAINER_VISION_MODEL ?? "claude-sonnet-5-5";
const adapter = createProviderAdapter({ id: "test", name: "Claude subscription", kind: "claude-subscription", apiKey: "", baseUrl: null, defaultModel: null });
const askWith =
	(modelId: string): VisionAsk =>
	async (req, signal) =>
		(await runText(adapter, { modelId, system: req.system, messages: [{ role: "user", content: req.prompt, images: req.images }], maxOutputTokens: 6000, abortSignal: signal })).text;

async function read(ocr: "vision" | "local", vision: VisionAsk | null) {
	const dir = tempDir("es-scan-");
	const progress: IngestProgress[] = [];
	const source = await ingest(
		{ items: [{ kind: "file", path: PDF, pages: "81-85" }], ocr, draftDir: join(dir, "draft"), tmpDir: join(dir, "tmp"), onProgress: (p) => progress.push(p) },
		{ docs: engine.docsRunner(), vision, log: (m) => console.log(`[ingest] ${m}`) },
	);
	return { source, progress, draftDir: join(dir, "draft") };
}

function report(label: string, s: Source) {
	const text = sourceText(s);
	console.log(`\n===== ${label}: ${s.stats.words} words, ${s.sections.length} sections, ${s.figures.length} figures, warnings: ${JSON.stringify(s.warnings)}`);
	console.log(`headings: ${s.sections.filter((x) => x.heading).map((x) => `[p${x.page}] ${"#".repeat(x.level)} ${x.heading}`).join(" | ")}`);
	console.log(text.slice(0, 1500));
}

describe.skipIf(!ready)("scanned PDF pages 81-85", () => {
	it("reads every page with RapidOCR on this PC, and saves the figures", async () => {
		const { source, progress, draftDir } = await read("local", null);
		report("local OCR", source);
		expect(source.inputs[0]!.ocr).toEqual([81, 82, 83, 84, 85].map((page) => ({ page, method: "local-ocr" })));
		const text = sourceText(source);
		expect(text).toMatch(/Bubble/i);
		expect(text).toMatch(/DATA/);
		expect(text).toMatch(/Step 1/);
		expect(source.stats.words).toBeGreaterThan(400);
		expect(source.figures.length).toBeGreaterThanOrEqual(4);
		for (const f of source.figures) expect(existsSync(join(draftDir, f.file))).toBe(true);
		expect(readFileSync(join(draftDir, source.figures[0]!.file)).subarray(1, 4).toString()).toBe("PNG");
		// Per-page progress for the OCR stage.
		expect(progress.filter((p) => p.stage === "ocr" && p.method === "local-ocr").map((p) => p.page)).toEqual(expect.arrayContaining([81, 82, 83, 84, 85]));
		expect(source.warnings).toEqual([]);
	});

	it("reads every page with AI vision (Claude Code CLI)", async () => {
		const { source, progress, draftDir } = await read("vision", askWith(VISION_MODEL));
		report(`vision ${VISION_MODEL}`, source);
		expect(source.inputs[0]!.ocr).toEqual([81, 82, 83, 84, 85].map((page) => ({ page, method: "vision" })));
		const text = sourceText(source);
		expect(text).toMatch(/Bubble/i);
		expect(text).toMatch(/DATA/);
		expect(source.stats.words).toBeGreaterThan(400);
		expect(source.sections.some((s) => s.heading && s.page)).toBe(true);
		expect(source.figures.length).toBeGreaterThanOrEqual(2);
		for (const f of source.figures) expect(existsSync(join(draftDir, f.file))).toBe(true);
		expect(progress.filter((p) => p.stage === "ocr" && p.method === "vision").map((p) => p.page)).toEqual(expect.arrayContaining([81, 82, 83, 84, 85]));
		expect(source.warnings).toEqual([]);
	});
});
