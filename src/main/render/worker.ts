/**
 * Render worker. Runs in an Electron utility process so heavy bundling and
 * rendering never block the main process or the UI.
 *
 * Remotion keeps its headless Chrome in `<cwd>/node_modules/.remotion`.
 * Main starts this process with cwd = <userData>/engine, so the browser lives
 * in a writable per-user folder in both dev and packaged builds.
 *
 * In the release build the entry point is a ready bundle folder, and Remotion's
 * binaries come from the unpacked asar folder (EXPLAINER_REMOTION_BINARIES).
 */
import { ensureBrowser, makeCancelSignal, RenderInternals, renderMedia, renderStill, selectComposition } from "@remotion/renderer";
import { rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { RenderStage, RenderUpdate } from "@shared/ipc/render";
import type { MediaRoots } from "../app/media-url";
import { concatList, joinArgs, rewriteMedia, startMediaServer, type MediaServer } from "./media-server";
import type { FromWorker, Task, ToWorker } from "./protocol";

const port = process.parentPort;
const post = (m: FromWorker) => port.postMessage(m);
const log = (level: "info" | "warn" | "error", message: string) => post({ type: "log", level, message });

const binariesDirectory = process.env.EXPLAINER_REMOTION_BINARIES || null;

/** Bundles are reused for the life of the worker, keyed by entry point. */
const bundles = new Map<string, Promise<string>>();
const cancels = new Map<string, () => void>();
const cancelled = new Set<string>();

function send(jobId: string, stage: RenderStage, progress: number, extra: Partial<RenderUpdate> = {}) {
	post({ type: "update", update: { jobId, stage, progress: Math.max(0, Math.min(1, progress)), ...extra } });
}

/** Throttle per-frame callbacks so IPC stays light (about 10 updates a second). */
function throttle<T extends unknown[]>(fn: (...a: T) => void, ms = 100) {
	let last = 0;
	return (...a: T) => {
		const now = Date.now();
		if (now - last < ms) return;
		last = now;
		fn(...a);
	};
}

class Cancelled extends Error {}
const check = (jobId: string) => {
	if (cancelled.has(jobId)) throw new Cancelled();
};

async function run(msg: Extract<ToWorker, { type: "start" }>) {
	const { jobId } = msg;
	try {
		send(jobId, "browser", 0, { detail: "Checking render browser" });
		await ensureBrowser({
			chromeMode: "headless-shell",
			onBrowserDownload: () => {
				log("info", "Downloading Chrome Headless Shell (one time)");
				return {
					version: null,
					onProgress: throttle(({ percent, downloadedBytes, totalSizeInBytes }) =>
						send(jobId, "browser", percent, {
							detail: `Downloading render browser · ${(downloadedBytes / 1e6).toFixed(0)} of ${(totalSizeInBytes / 1e6).toFixed(0)} MB`,
						}),
					),
				};
			},
		});
		check(jobId);

		send(jobId, "bundling", 0, { detail: "Preparing video code" });
		const url = await bundled(msg.entryPoint, (p) => send(jobId, "bundling", p, { detail: "Preparing video code" }));
		check(jobId);

		const composition = await selectComposition({ serveUrl: url, id: msg.compositionId, inputProps: msg.inputProps, logLevel: "warn", binariesDirectory });
		check(jobId);

		const { cancelSignal, cancel } = makeCancelSignal();
		cancels.set(jobId, cancel);
		const total = composition.durationInFrames;
		await renderMedia({
			serveUrl: url,
			composition,
			inputProps: msg.inputProps,
			codec: "h264",
			outputLocation: msg.outputPath,
			overwrite: true,
			cancelSignal,
			logLevel: "warn",
			chromeMode: "headless-shell",
			binariesDirectory,
			onProgress: throttle(({ progress, renderedFrames, stitchStage }) =>
				send(jobId, stitchStage === "muxing" ? "encoding" : "rendering", progress, {
					detail: stitchStage === "muxing" ? "Finishing file" : `Frame ${renderedFrames} of ${total}`,
				}),
			),
		});
		send(jobId, "done", 1, { outputPath: msg.outputPath, detail: "Render complete" });
	} catch (err) {
		if (err instanceof Cancelled || cancelled.has(jobId)) send(jobId, "cancelled", 0, { detail: "Render cancelled" });
		else {
			const message = (err as Error)?.message ?? String(err);
			log("error", `job ${jobId} failed: ${(err as Error)?.stack ?? message}`);
			send(jobId, "error", 0, { error: message.split("\n")[0] });
		}
	} finally {
		cancels.delete(jobId);
		cancelled.delete(jobId);
	}
}

/* ---------- Video render steps ---------- */

let media: Promise<MediaServer> | null = null;
async function mediaBase(roots: MediaRoots): Promise<string> {
	media ??= startMediaServer(roots);
	media.catch(() => (media = null));
	const m = await media;
	m.setRoots(roots);
	return m.base;
}

/** A source entry point (.ts/.tsx) is bundled once; a ready bundle folder (release build) is used as is. */
function bundled(entryPoint: string, onProgress?: (p: number) => void): Promise<string> {
	if (!/\.tsx?$/.test(entryPoint)) return Promise.resolve(entryPoint);
	let serveUrl = bundles.get(entryPoint);
	if (!serveUrl) {
		// Loaded only here: the release build never bundles, so webpack is never loaded there.
		serveUrl = import("@remotion/bundler").then(({ bundle }) => bundle({ entryPoint, onProgress: onProgress ? throttle((p: number) => onProgress(p / 100)) : undefined }));
		bundles.set(entryPoint, serveUrl);
		serveUrl.catch(() => bundles.delete(entryPoint));
	}
	return serveUrl;
}

async function runTask(jobId: string, taskId: string, task: Task) {
	const progress = throttle((p: number, detail?: string) => post({ type: "progress", taskId, progress: Math.max(0, Math.min(1, p)), detail }));
	const { cancelSignal, cancel } = makeCancelSignal();
	cancels.set(jobId, cancel);
	try {
		check(jobId);
		if (task.kind === "prepare") {
			await ensureBrowser({
				chromeMode: "headless-shell",
				onBrowserDownload: () => {
					log("info", "Downloading Chrome Headless Shell (one time)");
					return { version: null, onProgress: ({ percent }) => progress(percent * 0.5, "Downloading the render browser (one time)") };
				},
			});
			check(jobId);
			await bundled(task.entryPoint, (p) => progress(0.5 + p * 0.5, "Preparing video code"));
		} else if (task.kind === "chapter") {
			const serveUrl = await bundled(task.entryPoint);
			const inputProps = rewriteMedia(task.inputProps, await mediaBase(task.roots));
			check(jobId);
			const composition = await selectComposition({ serveUrl, id: "Explainer", inputProps, logLevel: "warn", chromeMode: "headless-shell", binariesDirectory });
			check(jobId);
			const [from, to] = task.frameRange;
			const total = to - from + 1;
			await renderMedia({
				serveUrl,
				composition,
				inputProps,
				codec: "h264",
				audioCodec: "pcm-16",
				separateAudioTo: task.audioPath,
				frameRange: task.frameRange,
				scale: task.scale,
				crf: task.crf,
				x264Preset: task.preset,
				pixelFormat: "yuv420p",
				outputLocation: task.videoPath,
				overwrite: true,
				cancelSignal,
				logLevel: "warn",
				chromeMode: "headless-shell",
				binariesDirectory,
				onProgress: ({ progress: p, renderedFrames, stitchStage }) =>
					progress(p, stitchStage === "muxing" ? "Finishing chapter file" : `Frame ${Math.min(renderedFrames, total)} of ${total}`),
			});
		} else if (task.kind === "join") {
			const dir = dirname(task.outputPath);
			const vList = join(dir, "video-parts.txt");
			const aList = join(dir, "audio-parts.txt");
			await writeFile(vList, concatList(task.videoParts));
			await writeFile(aList, concatList(task.audioParts));
			const tmp = `${task.outputPath}.part.mp4`;
			const proc = RenderInternals.callFf({
				bin: "ffmpeg",
				args: joinArgs(vList, aList, tmp),
				indent: false,
				logLevel: "warn",
				binariesDirectory,
				cancelSignal,
			});
			proc.stderr?.on("data", (d: Buffer) => {
				const m = /time=(\d+):(\d+):(\d+\.\d+)/.exec(d.toString());
				if (m) progress(((Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1000) / Math.max(1, task.durationMs), "Joining chapters");
			});
			await proc;
			check(jobId);
			await rm(task.outputPath, { force: true });
			await rename(tmp, task.outputPath);
			await Promise.all([rm(vList, { force: true }), rm(aList, { force: true })]);
		} else {
			const serveUrl = await bundled(task.entryPoint);
			const inputProps = rewriteMedia(task.inputProps, await mediaBase(task.roots));
			const composition = await selectComposition({ serveUrl, id: task.compositionId, inputProps, logLevel: "warn", chromeMode: "headless-shell", binariesDirectory });
			check(jobId);
			await renderStill({ serveUrl, composition, inputProps, output: task.outputPath, imageFormat: "png", overwrite: true, frame: 0, logLevel: "warn", chromeMode: "headless-shell", cancelSignal, binariesDirectory });
		}
		post({ type: "result", taskId, ok: true });
	} catch (err) {
		const wasCancelled = err instanceof Cancelled || cancelled.has(jobId);
		const message = (err as Error)?.message ?? String(err);
		if (!wasCancelled) log("error", `task ${task.kind} of ${jobId} failed: ${(err as Error)?.stack ?? message}`);
		post({ type: "result", taskId, ok: false, cancelled: wasCancelled, error: (message.split("\n")[0] ?? "").slice(0, 500) });
	} finally {
		cancels.delete(jobId);
		cancelled.delete(jobId);
	}
}

port.on("message", (e) => {
	const msg = e.data as ToWorker;
	if (msg.type === "start") void run(msg);
	else if (msg.type === "task") void runTask(msg.jobId, msg.taskId, msg.task);
	else if (msg.type === "cancel") {
		cancelled.add(msg.jobId);
		cancels.get(msg.jobId)?.();
	}
});
