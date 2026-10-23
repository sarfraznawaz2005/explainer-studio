import { app, shell, utilityProcess, type UtilityProcess } from "electron";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderEvents, type RenderUpdate } from "@shared/ipc/render";
import { appFolders } from "../app/folders";
import { getMainWindow } from "../app/window";
import type { FromWorker, Task, ToWorker } from "./protocol";

type Job = { id: string; outputPath: string; last: RenderUpdate };

const jobs = new Map<string, Job>();
let worker: UtilityProcess | null = null;

/** Steps of video renders that wait for the worker's answer. */
type Pending = { resolve: () => void; reject: (e: TaskError) => void; onProgress: (p: number, detail?: string) => void };
const pending = new Map<string, Pending>();

export class TaskError extends Error {
	constructor(
		message: string,
		readonly cancelled: boolean,
	) {
		super(message);
	}
}

const FINAL = new Set(["done", "cancelled", "error"]);

/** Writable folder that holds Remotion's headless Chrome (see worker.ts). */
function engineDir(): string {
	const dir = appFolders().engine;
	// Remotion picks its download folder from the nearest package.json above cwd.
	const pkg = join(dir, "package.json");
	if (!existsSync(pkg)) writeFileSync(pkg, JSON.stringify({ name: "explainer-studio-engine", private: true }, null, 2));
	return dir;
}

/** Engine-test renders are throwaway files, so they live in the cache. */
export function testRendersDir(): string {
	const dir = join(appFolders().cache, "test-renders");
	mkdirSync(dir, { recursive: true });
	return dir;
}

function emit(update: RenderUpdate) {
	const job = jobs.get(update.jobId);
	if (job) job.last = update;
	getMainWindow()?.webContents.send(renderEvents.update, update);
}

function getWorker(): UtilityProcess {
	if (worker) return worker;
	const w = utilityProcess.fork(join(__dirname, "render-worker.js"), [], {
		cwd: engineDir(),
		serviceName: "Explainer Studio Render",
		stdio: "pipe",
		// Release: Remotion's ffmpeg and compositor cannot run from inside the asar, so they ship unpacked.
		env: app.isPackaged ? { ...process.env, EXPLAINER_REMOTION_BINARIES: join(process.resourcesPath, "app.asar.unpacked", "node_modules", "@remotion", "compositor-win32-x64-msvc") } : process.env,
	});
	w.stdout?.on("data", (d) => process.stdout.write(`[render] ${d}`));
	w.stderr?.on("data", (d) => process.stderr.write(`[render] ${d}`));
	w.on("message", (m: FromWorker) => {
		if (m.type === "update") emit(m.update);
		else if (m.type === "log") console[m.level](`[render] ${m.message}`);
		else if (m.type === "progress") pending.get(m.taskId)?.onProgress(m.progress, m.detail);
		else {
			const p = pending.get(m.taskId);
			pending.delete(m.taskId);
			if (m.ok) p?.resolve();
			else p?.reject(new TaskError(m.error, m.cancelled));
		}
	});
	w.on("exit", (code) => {
		if (worker === w) worker = null;
		// Fail any job that was still running when the worker died.
		for (const job of jobs.values()) {
			if (!FINAL.has(job.last.stage)) emit({ jobId: job.id, stage: "error", progress: 0, error: `Render engine stopped (code ${code})` });
		}
		for (const [id, p] of pending) {
			pending.delete(id);
			p.reject(new TaskError(`The render engine stopped (code ${code}).`, false));
		}
	});
	worker = w;
	return w;
}

function post(msg: ToWorker) {
	getWorker().postMessage(msg);
}

export function startRender(opts: { entryPoint: string; compositionId: string; inputProps: Record<string, unknown>; fileStem: string }): string {
	const id = randomUUID();
	const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
	const outputPath = join(testRendersDir(), `${opts.fileStem}-${stamp}.mp4`);
	const job: Job = { id, outputPath, last: { jobId: id, stage: "queued", progress: 0 } };
	jobs.set(id, job);
	emit(job.last);
	post({ type: "start", jobId: id, entryPoint: opts.entryPoint, compositionId: opts.compositionId, inputProps: opts.inputProps, outputPath });
	return id;
}

/** Runs one step of a video render in the worker. Rejects with TaskError (cancelled = true after cancelTask). */
export function runTask(jobId: string, task: Task, onProgress: (p: number, detail?: string) => void = () => undefined): Promise<void> {
	const taskId = randomUUID();
	return new Promise<void>((resolve, reject) => {
		pending.set(taskId, { resolve, reject, onProgress });
		try {
			post({ type: "task", jobId, taskId, task });
		} catch (err) {
			pending.delete(taskId);
			reject(new TaskError((err as Error).message, false));
		}
	});
}

export function cancelTask(jobId: string): void {
	if (worker) post({ type: "cancel", jobId });
}

export function cancelRender(jobId: string): void {
	const job = jobs.get(jobId);
	if (!job || FINAL.has(job.last.stage)) return;
	post({ type: "cancel", jobId });
}

export function revealRender(jobId: string): void {
	const job = jobs.get(jobId);
	if (!job || job.last.stage !== "done") throw new Error("This render has no finished file.");
	shell.showItemInFolder(job.outputPath);
}

export function stopRenderWorker(): void {
	worker?.kill();
	worker = null;
}
