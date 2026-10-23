import { randomUUID } from "node:crypto";
import { mkdir, rm, stat } from "node:fs/promises";
import { basename, isAbsolute, join, relative } from "node:path";
import { ingestEvents, type IngestItemInput, type IngestUpdate, type Level, type OcrMode, type PickedFile } from "@shared/ipc/ingest";
import type { Estimate, TopicRequest } from "@shared/planner";
import { kindOfFile } from "@shared/source";
import { ai } from "../ai";
import { appFolders } from "../app/folders";
import { writeLog } from "../app/logger";
import { getMainWindow } from "../app/window";
import { repos } from "../db/repos";
import { redact } from "../security/redact";
import { normalisePath } from "../security/path-guard";
import { voiceEngine } from "../voice";
import { describeProviderError } from "../ai/providers/errors";
import { plannerAiFrom } from "../planner/ai";
import { priced } from "../planner/jobs";
import { topicCalls, writeTopicNotes } from "./topic";
import { ingest, type IngestDeps } from "./ingest";
import type { VisionAsk } from "./ocr";
import { pdfPageCount } from "./pdf-text";
import { findSoffice, IngestUserError } from "./word";

/** Files the user picked or dropped in this session. Only these can be read. */
const allowed = new Set<string>();
const key = (p: string) => (process.platform === "win32" ? p.toLowerCase() : p);

const jobs = new Map<string, { abort: AbortController; last: IngestUpdate }>();

function emit(u: IngestUpdate) {
	const job = jobs.get(u.jobId);
	if (job) job.last = u;
	getMainWindow()?.webContents.send(ingestEvents.update, u);
}

/** Checks a picked or dropped path and remembers it. Returns null for files that cannot be read. */
export async function admitFile(raw: string): Promise<PickedFile | null> {
	let path: string;
	try {
		path = normalisePath(raw);
	} catch {
		return null;
	}
	const kind = kindOfFile(path);
	if (!kind) return null;
	const st = await stat(path).catch(() => null);
	if (!st?.isFile()) return null;
	allowed.add(key(path));
	const pageCount = kind === "pdf" ? await pdfPageCount(path).catch(() => null) : null;
	return { path, name: basename(path), kind, bytes: st.size, pageCount };
}

/** Which helpers can run right now. */
export function capabilities() {
	let vision: { providerName: string; modelId: string } | null = null;
	try {
		const d = ai().describeSlot("vision");
		vision = { providerName: d.providerName, modelId: d.modelId };
	} catch {
		vision = null;
	}
	return { localEngine: voiceEngine().isReady(), vision, libreOffice: !!findSoffice() };
}

/** Deletes a folder only when it sits inside `root`. */
async function removeInside(root: string, dir: string) {
	const rel = relative(root, dir);
	if (!rel || rel.startsWith("..") || isAbsolute(rel)) return;
	await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
}

export function startIngest(req: { items: IngestItemInput[]; ocr: OcrMode; level: Level }): string {
	for (const it of req.items) {
		if (it.kind === "file" && !allowed.has(key(normalisePath(it.path)))) throw new Error(`Add ${basename(it.path)} again with Choose files or drag and drop.`);
	}
	const jobId = randomUUID();
	const draftId = randomUUID();
	const abort = new AbortController();
	const folders = appFolders();
	const draftDir = join(folders.drafts, draftId);
	const tmpDir = join(folders.cache, "ingest", jobId);
	jobs.set(jobId, { abort, last: { jobId, state: "running", progress: null } });
	emit({ jobId, state: "running", progress: null });

	const vision: VisionAsk = (r, signal) =>
		ai().generateText({ system: r.system, prompt: r.prompt, images: r.images }, { slot: "vision", purpose: "ingest.read-page", draftId: null, abortSignal: signal, maxOutputTokens: 6000 });
	const caps = capabilities();
	const deps: IngestDeps = {
		docs: voiceEngine().docsRunner(),
		vision: caps.vision ? vision : null,
		log: (m) => writeLog("ingest", "info", m),
	};
	writeLog("ingest", "info", `job ${jobId}: ${req.items.length} item(s), ocr=${req.ocr}, local engine=${!!deps.docs}, vision=${caps.vision ? `${caps.vision.providerName}/${caps.vision.modelId}` : "none"}`);

	void (async () => {
		try {
			await mkdir(draftDir, { recursive: true });
			const items = req.items.map((it) => (it.kind === "file" ? { kind: "file" as const, path: normalisePath(it.path), pages: it.pages } : it));
			const source = await ingest({ items, ocr: req.ocr, draftDir, tmpDir, signal: abort.signal, onProgress: (p) => emit({ jobId, state: "running", progress: p }) }, deps);
			repos.drafts.create({ id: draftId, title: source.title || "Untitled", level: req.level, stage: "source", source, plan: null, seriesId: null, brandKitId: null });
			writeLog("ingest", "info", `job ${jobId} done: draft ${draftId}, ${source.sections.length} sections, ${source.figures.length} figures, ${source.stats.words} words, ${source.warnings.length} warnings`);
			emit({ jobId, state: "done", progress: jobs.get(jobId)?.last.progress ?? null, draftId });
		} catch (err) {
			await removeInside(folders.drafts, draftDir).catch(() => {});
			if (abort.signal.aborted) {
				writeLog("ingest", "info", `job ${jobId} cancelled`);
				emit({ jobId, state: "cancelled", progress: jobs.get(jobId)?.last.progress ?? null });
			} else {
				const user = err instanceof IngestUserError;
				writeLog("ingest", user ? "warn" : "error", `job ${jobId} failed`, err);
				emit({ jobId, state: "error", progress: jobs.get(jobId)?.last.progress ?? null, error: redact(user ? err.message : `Reading failed: ${(err as Error)?.message ?? String(err)}`) });
			}
		} finally {
			await removeInside(folders.cache, tmpDir).catch(() => {});
		}
	})();
	return jobId;
}

/** Cost and time of writing material from a topic. */
export const estimateTopic = (req: TopicRequest): Promise<Estimate> => priced("research", topicCalls(req));

/** The AI writes the material from a topic, then it is saved as a draft like read files. The wizard opens with the topic's settings. */
export async function startTopic(req: TopicRequest & { confirmedCost: boolean }): Promise<string> {
	if (!req.confirmedCost && (await estimateTopic(req)).needsConfirm) throw new Error("This run may cost money. Confirm the estimate first.");
	const jobId = randomUUID();
	const draftId = randomUUID();
	const abort = new AbortController();
	const draftDir = join(appFolders().drafts, draftId);
	jobs.set(jobId, { abort, last: { jobId, state: "running", progress: null } });
	emit({ jobId, state: "running", progress: null });
	writeLog("ingest", "info", `topic job ${jobId}: ${req.minutes} min, ${req.level}`);
	const name = req.topic.slice(0, 80);
	const tell = (progress: number, detail: string) => emit({ jobId, state: "running", progress: { fileIndex: 0, fileCount: 1, fileName: name, stage: "research", progress, detail } });

	void (async () => {
		try {
			// Created up front because drafts own a folder; it stays empty (no figures).
			await mkdir(draftDir, { recursive: true });
			tell(0, "Planning the sections");
			// No draft link on the usage rows: the draft row is only created at the end, and ai_usage.draft_id must point to a real draft.
			const source = await writeTopicNotes(req, plannerAiFrom(ai(), null, abort.signal), {
				signal: abort.signal,
				onProgress: (p) => (p.step === "plan" ? tell(0.05, "Planning the sections") : tell(0.1 + (0.85 * p.done) / p.total, `Writing section ${Math.min(p.done + 1, p.total)} of ${p.total}`)),
			});
			tell(0.97, "Saving the draft");
			const settings = { format: req.format, level: req.level, language: req.language, tone: req.tone, targetMinutes: req.minutes, style: "auto" as const, webPictures: true };
			repos.drafts.create({ id: draftId, title: source.title || "Untitled", level: req.level, stage: "source", source, plan: null, settings, seriesId: null, brandKitId: null });
			writeLog("ingest", "info", `topic job ${jobId} done: draft ${draftId}, ${source.sections.length} sections, ${source.stats.words} words`);
			emit({ jobId, state: "done", progress: jobs.get(jobId)?.last.progress ?? null, draftId });
		} catch (err) {
			await removeInside(appFolders().drafts, draftDir).catch(() => {});
			if (abort.signal.aborted) {
				writeLog("ingest", "info", `topic job ${jobId} cancelled`);
				emit({ jobId, state: "cancelled", progress: jobs.get(jobId)?.last.progress ?? null });
			} else {
				writeLog("ingest", "error", `topic job ${jobId} failed`, err);
				emit({ jobId, state: "error", progress: jobs.get(jobId)?.last.progress ?? null, error: redact(`Writing failed: ${describeProviderError(err).message || String(err)}`) });
			}
		}
	})();
	return jobId;
}

/** True while material is being read (temp files in the cache, a draft folder with no row yet). */
export const ingestBusy = () => [...jobs.values()].some((j) => j.last.state === "running");

export function cancelIngest(jobId: string): void {
	jobs.get(jobId)?.abort.abort(new Error("Cancelled by the user"));
}

export function cancelAllIngest(): void {
	for (const j of jobs.values()) j.abort.abort(new Error("The app is closing"));
}
