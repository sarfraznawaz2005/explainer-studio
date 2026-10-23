import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { JobStep, RenderJobView } from "@shared/ipc/render";
import type { Job } from "@shared/models";
import { RenderSettings, outputSize, QUALITIES, type YoutubePack } from "@shared/render";
import type { MediaRoots } from "../app/media-url";
import type { Repos } from "../db/repos";
import type { Task } from "./protocol";

/**
 * The video render queue. One video renders at a time; its chapters render one
 * after another (each chapter already uses every CPU core through Remotion).
 *
 * Every step is saved in the jobs table as soon as it ends, so after a crash or
 * a failed chapter the job starts again at the first chapter that has no file.
 * Files of a job live in <videos>/<video id>/:
 *   .work/input.json      the props snapshot taken when the job was queued
 *   .work/chapter-NN.mp4  video of one chapter (no sound)
 *   .work/chapter-NN.wav  sound of one chapter (lossless, joined sample-exact)
 *   video.mp4, thumbnail*.png, captions.srt, youtube.txt, plan.json  when done
 */

export type ChapterPart = { title: string; from: number; frames: number; done: boolean };
export type RenderPayload = {
	videoId: string;
	title: string;
	level: string;
	settings: RenderSettings;
	width: number;
	height: number;
	scale: number;
	fps: number;
	totalFrames: number;
	durationMs: number;
	chapters: ChapterPart[];
	step: JobStep;
	/** Index of the chapter that failed last, if any. */
	failedChapter: number | null;
	joined: boolean;
	thumbs: number;
	resumes: number;
};

/** What queueRender writes to .work/input.json. */
export type RenderInput = {
	/** PlanVideo props: plan (fps already set), audioBase, soundtrack. */
	props: Record<string, unknown>;
	/** The plan as saved to plan.json. */
	plan: unknown;
	pack: YoutubePack;
	youtubeText: string;
	srt: string;
};

export type QueueDeps = {
	repos: Repos;
	videosDir: () => string;
	roots: () => MediaRoots;
	entryPoint: () => string;
	runTask: (runKey: string, task: Task, onProgress: (p: number, detail?: string) => void) => Promise<void>;
	cancelTask: (runKey: string) => void;
	emit: (view: RenderJobView) => void;
	/** A video finished: Windows notification, library refresh. */
	onDone: (title: string, videoId: string) => void;
	onFailed?: (title: string, error: string) => void;
	now?: () => number;
};

const W = { prepare: 0.03, chapters: 0.86, join: 0.05, thumbs: 0.05, finish: 0.01 };
const THUMBS = [
	{ variant: "a", file: "thumbnail.png" },
	{ variant: "b", file: "thumbnail-b.png" },
	{ variant: "c", file: "thumbnail-c.png" },
] as const;
const FINAL = new Set(["done", "cancelled", "error"]);

export const workDir = (videosDir: string, videoId: string) => join(videosDir, videoId, ".work");
const pad = (i: number) => String(i + 1).padStart(2, "0");
export const chapterFiles = (work: string, i: number) => ({ video: join(work, `chapter-${pad(i)}.mp4`), audio: join(work, `chapter-${pad(i)}.wav`) });

/** A chapter counts as done only when both its files are there and not empty. */
export function chapterOnDisk(work: string, i: number): boolean {
	const f = chapterFiles(work, i);
	try {
		return statSync(f.video).size > 0 && statSync(f.audio).size > 44;
	} catch {
		return false;
	}
}

/** Remaining time from the frames rendered in this run. Null until there is enough to measure. */
export function estimateEta(p: { framesDone: number; framesAtStart: number; totalFrames: number; startedAt: number | null; now: number }): number | null {
	if (p.startedAt === null) return null;
	const spent = p.now - p.startedAt;
	const made = p.framesDone - p.framesAtStart;
	if (spent < 3000 || made < 1) return null;
	const left = Math.max(0, p.totalFrames - p.framesDone);
	// Join, thumbnails and files take roughly 8% on top of the frames.
	return Math.round((left / (made / spent)) * 1.08 + 4000);
}

export function createRenderQueue(deps: QueueDeps) {
	const { repos } = deps;
	const now = deps.now ?? Date.now;
	type Live = { jobId: string; runKey: string; cancel: boolean; chapterProgress: number; framesAtStart: number; chaptersStartedAt: number | null; detail: string | null };
	let live: Live | null = null;
	let pumping = false;
	/** Set when the app quits: the running job stays "running" in the database and resumes on the next start. */
	let stopping = false;

	const payloadOf = (j: Job) => j.payload as RenderPayload;

	function framesDone(p: RenderPayload, current: number, currentProgress: number): number {
		return p.chapters.reduce((n, c, i) => n + (c.done ? c.frames : i === current ? c.frames * currentProgress : 0), 0);
	}

	function overall(p: RenderPayload, currentProgress: number, stepProgress = 0): number {
		const cur = p.chapters.findIndex((c) => !c.done);
		const chap = p.totalFrames ? framesDone(p, cur, currentProgress) / p.totalFrames : 1;
		switch (p.step) {
			case "waiting":
				return W.chapters * chap;
			case "browser":
			case "bundling":
				return W.prepare * stepProgress + W.chapters * chap;
			case "chapters":
				return W.prepare + W.chapters * chap;
			case "joining":
				return W.prepare + W.chapters + W.join * stepProgress;
			case "thumbnails":
				return W.prepare + W.chapters + W.join + W.thumbs * ((p.thumbs + stepProgress) / THUMBS.length);
			case "finishing":
				return 1 - W.finish;
			case "done":
				return 1;
		}
	}

	function view(j: Job): RenderJobView {
		const p = payloadOf(j);
		const isLive = live?.jobId === j.id;
		const cur = p.chapters.findIndex((c) => !c.done);
		const done = framesDone(p, cur, isLive ? live!.chapterProgress : 0);
		return {
			id: j.id,
			draftId: j.draftId,
			videoId: p.videoId,
			title: p.title,
			status: j.status,
			step: p.step,
			progress: Math.max(0, Math.min(1, j.progress)),
			detail: (isLive ? live!.detail : null) ?? j.detail,
			error: j.error,
			settings: p.settings,
			width: p.width,
			height: p.height,
			durationMs: p.durationMs,
			chapters: p.chapters.map((c, i) => ({
				title: c.title,
				frames: c.frames,
				state: c.done ? "done" : j.status === "error" && p.failedChapter === i ? "error" : isLive && i === cur && p.step === "chapters" ? "rendering" : "waiting",
				progress: c.done ? 1 : isLive && i === cur ? live!.chapterProgress : 0,
			})),
			etaMs:
				isLive && j.status === "running"
					? estimateEta({ framesDone: done, framesAtStart: live!.framesAtStart, totalFrames: p.totalFrames, startedAt: live!.chaptersStartedAt, now: now() })
					: null,
			resumes: p.resumes,
			createdAt: j.createdAt,
			startedAt: j.startedAt,
			finishedAt: j.finishedAt,
		};
	}

	const emitJob = (id: string) => {
		const j = repos.jobs.get(id);
		if (j) deps.emit(view(j));
	};

	function save(id: string, patch: Partial<Job> & { payload?: RenderPayload }) {
		repos.jobs.update(id, patch);
		emitJob(id);
	}

	/** Live progress: sent to the window, written to the database only on step changes. */
	function tick(id: string, p: RenderPayload, stepProgress: number, detail?: string) {
		if (!live || live.jobId !== id) return;
		if (detail) live.detail = detail;
		const j = repos.jobs.get(id);
		if (!j) return;
		deps.emit(view({ ...j, progress: overall(p, live.chapterProgress, stepProgress), detail: live.detail, payload: p }));
	}

	const list = (): Job[] => repos.jobs.list({ where: { kind: "render" }, orderBy: "createdAt", desc: true });

	async function run(job: Job) {
		const runKey = randomUUID();
		const p = { ...payloadOf(job) };
		const work = workDir(deps.videosDir(), p.videoId);
		const dir = join(deps.videosDir(), p.videoId);
		// A chapter marked done whose files are gone renders again.
		p.chapters = p.chapters.map((c, i) => ({ ...c, done: c.done && chapterOnDisk(work, i) }));
		p.failedChapter = null;
		live = { jobId: job.id, runKey, cancel: false, chapterProgress: 0, framesAtStart: framesDone(p, -1, 0), chaptersStartedAt: null, detail: null };
		save(job.id, { status: "running", error: null, startedAt: job.startedAt ?? new Date(now()).toISOString(), payload: p });
		const step = async (name: JobStep, task: Task, detail: string) => {
			p.step = name;
			live!.detail = detail;
			save(job.id, { payload: p, detail, progress: overall(p, 0) });
			await deps.runTask(runKey, task, (x, d) => {
				if (name === "chapters" && live) live.chapterProgress = x;
				tick(job.id, p, x, d ?? detail);
			});
			if (live?.cancel) throw new Cancelled();
		};
		try {
			const input = JSON.parse(await readFile(join(work, "input.json"), "utf8")) as RenderInput;
			const roots = deps.roots();
			await step("bundling", { kind: "prepare", entryPoint: deps.entryPoint() }, "Preparing the render engine");

			const q = QUALITIES[p.settings.quality];
			for (let i = 0; i < p.chapters.length; i++) {
				const c = p.chapters[i]!;
				if (c.done) continue;
				const f = chapterFiles(work, i);
				live.chapterProgress = 0;
				live.chaptersStartedAt ??= now();
				p.failedChapter = i;
				await step(
					"chapters",
					{ kind: "chapter", entryPoint: deps.entryPoint(), inputProps: input.props, frameRange: [c.from, c.from + c.frames - 1], videoPath: f.video, audioPath: f.audio, scale: p.scale, crf: q.crf, preset: q.preset, roots },
					`Chapter ${i + 1} of ${p.chapters.length}: ${c.title}`,
				);
				// Saved at once: this is the point a resume starts from.
				c.done = true;
				p.failedChapter = null;
				live.chapterProgress = 0;
				save(job.id, { payload: p, progress: overall(p, 0) });
			}

			const video = join(dir, "video.mp4");
			if (!p.joined || !existsSync(video)) {
				const parts = p.chapters.map((_, i) => chapterFiles(work, i));
				await step("joining", { kind: "join", videoParts: parts.map((x) => x.video), audioParts: parts.map((x) => x.audio), outputPath: video, durationMs: p.durationMs }, "Joining the chapters");
				p.joined = true;
			}

			const extra = input.props as { style?: string; figureBase?: string };
			const thumbProps = { plan: input.plan, style: extra.style, figureBase: extra.figureBase };
			for (let k = p.thumbs; k < THUMBS.length; k++) {
				const t = THUMBS[k]!;
				await step("thumbnails", { kind: "still", entryPoint: deps.entryPoint(), compositionId: "Thumbnail", inputProps: { ...thumbProps, variant: t.variant }, outputPath: join(dir, t.file), roots }, `Thumbnail ${k + 1} of ${THUMBS.length}`);
				p.thumbs = k + 1;
			}

			p.step = "finishing";
			save(job.id, { payload: p, detail: "Writing captions and the YouTube pack", progress: overall(p, 0) });
			await writeFile(join(dir, "captions.srt"), input.srt, "utf8");
			await writeFile(join(dir, "youtube.txt"), input.youtubeText, "utf8");
			await writeFile(join(dir, "plan.json"), JSON.stringify(input.plan, null, 2), "utf8");
			const size = statSync(video).size;
			const owner = job.draftId ? repos.drafts.get(job.draftId) : null;
			repos.videos.create({
				id: p.videoId,
				draftId: job.draftId && repos.drafts.get(job.draftId) ? job.draftId : null,
				// The series and episode the video was rendered as (the draft may move later).
				seriesId: owner?.seriesId && repos.series.get(owner.seriesId) ? owner.seriesId : null,
				episode: owner?.seriesId ? owner.episode : null,
				title: p.title,
				filePath: video,
				thumbnailPath: join(dir, THUMBS[0].file),
				durationMs: p.durationMs,
				width: p.width,
				height: p.height,
				sizeBytes: size,
				youtube: { ...input.pack, level: p.level, fps: p.fps },
			});
			await rm(work, { recursive: true, force: true });
			p.step = "done";
			save(job.id, { status: "done", payload: p, progress: 1, detail: "Video ready", finishedAt: new Date(now()).toISOString(), result: { videoId: p.videoId } });
			live = null;
			deps.onDone(p.title, p.videoId);
		} catch (err) {
			if (stopping) return;
			const cancelled = err instanceof Cancelled || live?.cancel || (err as { cancelled?: boolean })?.cancelled === true;
			// The final status is saved first, so no one sees a "running" job that is not running.
			// The job stays live until its files are gone, so the next job waits for the cleanup.
			if (cancelled) {
				save(job.id, { status: "cancelled", payload: { ...p, failedChapter: null }, detail: "Cancelled", finishedAt: new Date(now()).toISOString() });
				await rm(dir, { recursive: true, force: true }).catch(() => undefined);
				live = null;
			} else {
				const message = (err as Error)?.message ?? String(err);
				save(job.id, { status: "error", payload: p, error: message, detail: null, finishedAt: new Date(now()).toISOString() });
				live = null;
				deps.onFailed?.(p.title, message);
			}
		}
	}

	/** Starts the oldest waiting job when nothing is running. */
	async function pump(): Promise<void> {
		if (pumping || live || stopping) return;
		pumping = true;
		try {
			for (;;) {
				if (stopping) return;
				const next = list()
					.filter((j) => j.status === "queued")
					.sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
				if (!next) return;
				await run(next);
			}
		} finally {
			pumping = false;
		}
	}

	return {
		view,
		list: () => list().map(view),
		/** Saves the snapshot and adds the job. Returns the job id. */
		async add(opts: { draftId: string; title: string; level: string; settings: RenderSettings; plan: { meta: { width: number; height: number } }; timeline: { fps: number; durationInFrames: number; chapters: { title: string; from: number; durationInFrames: number }[] }; input: RenderInput }): Promise<string> {
			const active = list().find((j) => j.draftId === opts.draftId && !FINAL.has(j.status));
			if (active) throw new Error("This draft is already in the render queue.");
			const videoId = randomUUID();
			const work = workDir(deps.videosDir(), videoId);
			mkdirSync(work, { recursive: true });
			await writeFile(join(work, "input.json"), JSON.stringify(opts.input), "utf8");
			const size = outputSize(opts.plan.meta, opts.settings.resolution);
			const t = opts.timeline;
			const payload: RenderPayload = {
				videoId,
				title: opts.title,
				level: opts.level,
				settings: opts.settings,
				width: size.width,
				height: size.height,
				scale: size.scale,
				fps: t.fps,
				totalFrames: t.durationInFrames,
				durationMs: Math.round((t.durationInFrames / t.fps) * 1000),
				chapters: t.chapters.filter((c) => c.durationInFrames > 0).map((c) => ({ title: c.title, from: c.from, frames: c.durationInFrames, done: false })),
				step: "waiting",
				failedChapter: null,
				joined: false,
				thumbs: 0,
				resumes: 0,
			};
			const job = repos.jobs.create({ kind: "render", status: "queued", draftId: opts.draftId, progress: 0, detail: "Waiting", payload });
			emitJob(job.id);
			void pump();
			return job.id;
		},
		cancel(jobId: string) {
			const j = repos.jobs.get(jobId);
			if (!j || FINAL.has(j.status)) return;
			if (live?.jobId === jobId) {
				live.cancel = true;
				live.detail = "Cancelling…";
				deps.cancelTask(live.runKey);
				emitJob(jobId);
				return;
			}
			void rm(join(deps.videosDir(), payloadOf(j).videoId), { recursive: true, force: true }).catch(() => undefined);
			save(jobId, { status: "cancelled", detail: "Cancelled", finishedAt: new Date(now()).toISOString() });
		},
		/** A failed job starts again from its first unfinished chapter. */
		retry(jobId: string) {
			const j = repos.jobs.get(jobId);
			if (!j || j.status !== "error") throw new Error("Only a failed render can be started again.");
			const p = payloadOf(j);
			if (!existsSync(join(workDir(deps.videosDir(), p.videoId), "input.json")) && !p.joined) throw new Error("The files of this render are gone. Render the draft again.");
			save(jobId, { status: "queued", error: null, detail: "Waiting", finishedAt: null, payload: { ...p, resumes: p.resumes + 1, step: "waiting" } });
			void pump();
		},
		/** Removes a finished job from the list. A failed one also loses its unfinished files. */
		async clear(jobId: string) {
			const j = repos.jobs.get(jobId);
			if (!j) return;
			if (!FINAL.has(j.status)) throw new Error("Cancel the render before removing it.");
			if (j.status === "error") await rm(join(deps.videosDir(), payloadOf(j).videoId), { recursive: true, force: true });
			repos.jobs.remove(jobId);
		},
		/** After a crash or a closed app: jobs that were running wait again, and the queue starts. */
		resumeAll(): number {
			let n = 0;
			for (const j of list()) {
				if (j.status !== "running") continue;
				const p = payloadOf(j);
				repos.jobs.update(j.id, { status: "queued", detail: "Resuming after restart", payload: { ...p, resumes: p.resumes + 1, step: "waiting" } });
				n++;
			}
			void pump();
			return n;
		},
		activeFor: (draftId: string) => list().find((j) => j.draftId === draftId && !FINAL.has(j.status))?.id ?? null,
		lastFor: (draftId: string) => list().find((j) => j.draftId === draftId) ?? null,
		isLive: () => live !== null,
		/** Call before the render worker is stopped on quit. */
		shutdown() {
			stopping = true;
		},
		pump,
	};
}

class Cancelled extends Error {
	constructor() {
		super("Cancelled");
	}
}

export type RenderQueue = ReturnType<typeof createRenderQueue>;
