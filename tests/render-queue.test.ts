import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { RenderJobView } from "../src/shared/ipc/render";
import { VideoPlan } from "../src/shared/plan/schema";
import { computeTimeline, type Timeline } from "../src/shared/plan/timing";
import { buildSrt, buildYoutubePack, captionChunks, makeTags, outputSize, RenderSettings, stamp, youtubeChapters, youtubeText } from "../src/shared/render";
import { mediaPath } from "../src/main/app/media-url";
import { openFile, type Db } from "../src/main/db/connection";
import { runMigrations } from "../src/main/db/migrate";
import { MIGRATIONS } from "../src/main/db/migrations";
import { createRepos } from "../src/main/db/repos";
import { concatList, rewriteMedia, startMediaServer } from "../src/main/render/media-server";
import type { Task } from "../src/main/render/protocol";
import { chapterFiles, createRenderQueue, estimateEta, workDir, type RenderInput } from "../src/main/render/queue";
import { ownedDir, PathDeniedError } from "../src/main/security/path-guard";
import { SAMPLE_PLAN } from "../video/src/samples/web-page-journey";
import { tempDir } from "./helpers";

const plan = VideoPlan.parse(SAMPLE_PLAN);
const timeline = computeTimeline(plan);

/** A timeline with chapters of the given lengths in seconds (30 fps). */
function fakeTimeline(seconds: number[], titles = seconds.map((_, i) => `Chapter ${i + 1}`)): Timeline {
	let from = 0;
	const chapters = seconds.map((s, i) => {
		const c = { id: `c${i}`, title: titles[i]!, from, durationInFrames: s * 30 };
		from += s * 30;
		return c;
	});
	return { fps: 30, durationInFrames: from, intro: 0, outro: 0, scenes: [], chapters };
}

describe("render settings and outputs", () => {
	it("defaults to 1080p30 and scales the plan to each resolution", () => {
		expect(RenderSettings.parse({})).toEqual({ resolution: "1080p", fps: 30, quality: "standard", brand: true });
		const meta = { width: 1920, height: 1080 };
		expect(outputSize(meta, "720p")).toMatchObject({ width: 1280, height: 720 });
		expect(outputSize(meta, "1080p")).toMatchObject({ width: 1920, height: 1080, scale: 1 });
		expect(outputSize(meta, "1440p")).toMatchObject({ width: 2560, height: 1440 });
		expect(outputSize(meta, "2160p")).toMatchObject({ width: 3840, height: 2160, scale: 2 });
		expect(() => RenderSettings.parse({ fps: 24 })).toThrow();
	});

	it("writes time stamps the way YouTube reads them", () => {
		expect(stamp(0)).toBe("0:00");
		expect(stamp(65_400)).toBe("1:05");
		expect(stamp(3_723_000)).toBe("1:02:03");
	});

	it("makes YouTube chapters: first at 0:00, at least 3, each at least 10 s", () => {
		expect(youtubeChapters(fakeTimeline([30, 40, 50]))).toEqual([
			{ ms: 0, title: "Chapter 1" },
			{ ms: 30_000, title: "Chapter 2" },
			{ ms: 70_000, title: "Chapter 3" },
		]);
		// A 5 s chapter joins the one before; a short first chapter is taken over by the next.
		expect(youtubeChapters(fakeTimeline([4, 30, 5, 40, 30]))?.map((c) => [c.ms, c.title])).toEqual([
			[0, "Chapter 2"],
			[39_000, "Chapter 4"],
			[79_000, "Chapter 5"],
		]);
		expect(youtubeChapters(fakeTimeline([60, 60]))).toBeNull();
		// The sample plan: every chapter starts on the frame the timeline gives it.
		const yc = youtubeChapters(timeline);
		if (yc) for (const c of yc.slice(1)) expect(timeline.chapters.some((t) => Math.round((t.from / 30) * 1000) === c.ms)).toBe(true);
	});

	it("builds captions that follow the voice timing", () => {
		const srt = buildSrt(timeline);
		const cues = srt.trim().split(/\n\n/);
		const sentences = timeline.scenes.flatMap((t) => t.sentences.map((s) => ({ t, s })));
		expect(cues.length).toBeGreaterThanOrEqual(sentences.length);
		const first = sentences[0]!;
		const ms = Math.round(((first.t.from + first.s.from) / 30) * 1000);
		const hh = new Date(ms).toISOString().slice(11, 23).replace(".", ",");
		expect(cues[0]).toContain(`${hh} -->`);
		let last = -1;
		for (const c of cues) {
			const [, times, ...lines] = c.split("\n");
			const [a, b] = times!.split(" --> ").map((x) => {
				const [h, m, rest] = x.split(":");
				const [s, r] = rest!.split(",");
				return Number(h) * 3600000 + Number(m) * 60000 + Number(s) * 1000 + Number(r);
			});
			expect(a).toBeGreaterThanOrEqual(last);
			expect(b).toBeGreaterThan(a!);
			last = b!;
			expect(lines.length).toBeLessThanOrEqual(2);
		}
		expect(captionChunks("one two three four five six seven", 10)).toEqual(["one two", "three four", "five six", "seven"]);
	});

	it("puts chapters and every required credit in the description", () => {
		const t = fakeTimeline([30, 40, 50], ["Intro", "How it works", "Wrap up"]);
		const credits = [
			{ title: "Beat", author: "Sound_Bar_KK", license: "CC-BY-4.0", sourceUrl: "https://freesound.org/s/1/", line: '"Beat" by Sound_Bar_KK (https://freesound.org/s/1/), licensed under CC BY 4.0: https://creativecommons.org/licenses/by/4.0/' },
			{ title: "Calm", author: "Kevin MacLeod", license: "PD", sourceUrl: null, line: null },
		];
		const pack = buildYoutubePack(plan, t, credits);
		expect(pack.description).toContain("Chapters\n0:00 Intro\n0:30 How it works\n1:10 Wrap up");
		expect(pack.description).toContain(`Credits\n${credits[0]!.line}`);
		expect(pack.description).toContain("Kevin MacLeod");
		expect(pack.credits).toEqual([credits[0]!.line]);
		const txt = youtubeText(pack);
		expect(txt.startsWith(`TITLE\n${plan.meta.title}`)).toBe(true);
		expect(txt).toContain("TAGS\n");
		const tags = makeTags(plan);
		expect(tags.length).toBeLessThanOrEqual(15);
		expect(tags.join(",").length).toBeLessThanOrEqual(500);
	});
});

describe("render media server", () => {
	it("serves only token URLs that map to allowed files", async () => {
		const dir = tempDir("es-media-");
		const drafts = join(dir, "drafts");
		const id = "0f8fad5b-d9cb-469f-a165-70867728950e";
		mkdirSync(join(drafts, id, "voice"), { recursive: true });
		const clip = `${"a".repeat(32)}.wav`;
		writeFileSync(join(drafts, id, "voice", clip), "RIFFdata");
		writeFileSync(join(dir, "secret.txt"), "no");
		const srv = await startMediaServer({ drafts, assets: join(dir, "assets") });
		try {
			expect(srv.base).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/[0-9a-f]{48}\/$/);
			const ok = await fetch(`${srv.base}voice/${id}/${clip}`);
			expect(ok.status).toBe(200);
			expect(ok.headers.get("content-type")).toBe("audio/wav");
			expect(await ok.text()).toBe("RIFFdata");
			const port = new URL(srv.base).port;
			expect((await fetch(`http://127.0.0.1:${port}/voice/${id}/${clip}`)).status).toBe(404);
			expect((await fetch(`${srv.base}voice/${id}/..%2F..%2F..%2Fsecret.txt`)).status).toBe(404);
			expect((await fetch(`${srv.base}voice/${id}/${clip}`, { method: "POST" })).status).toBe(405);
		} finally {
			await srv.close();
		}
		expect(rewriteMedia({ a: "es-media://asset/x.mp3", b: ["es-media://voice/y/"], c: 3, d: "https://x" }, "http://h/t/")).toEqual({ a: "http://h/t/asset/x.mp3", b: ["http://h/t/voice/y/"], c: 3, d: "https://x" });
	});

	it("maps finished video files and nothing else", () => {
		const roots = { drafts: "/d", assets: "/a", videos: "/v" };
		const id = "0f8fad5b-d9cb-469f-a165-70867728950e";
		expect(mediaPath(`es-media://video/${id}/video.mp4`, roots)).toBe(join("/v", id, "video.mp4"));
		expect(mediaPath(`es-media://video/${id}/thumbnail-b.png`, roots)).toBe(join("/v", id, "thumbnail-b.png"));
		expect(mediaPath(`es-media://video/${id}/plan.json`, roots)).toBeNull();
		expect(mediaPath(`es-media://video/${id}/../x/video.mp4`, roots)).toBeNull();
		expect(mediaPath(`es-media://video/nope/video.mp4`, roots)).toBeNull();
	});

	it("quotes concat list paths", () => {
		expect(concatList(["C:\\a b\\it's.mp4"])).toBe("file 'C:/a b/it'\\''s.mp4'\n");
	});

	it("only deletes folders the app owns", () => {
		const id = "0f8fad5b-d9cb-469f-a165-70867728950e";
		expect(ownedDir("/root/videos", id)).toBe(resolve("/root/videos", id));
		expect(() => ownedDir("/root/videos", "..")).toThrow(PathDeniedError);
		expect(() => ownedDir("/root/videos", `${id}/..`)).toThrow(PathDeniedError);
	});
});

/* ---------- Queue ---------- */

const open: Db[] = [];
afterEach(() => {
	for (const d of open.splice(0)) if (d.isOpen) d.close();
});

type Call = { kind: Task["kind"]; frameRange?: [number, number] };

async function setupQueue() {
	const dir = tempDir("es-queue-");
	const d = openFile(join(dir, "studio.db"));
	open.push(d);
	await runMigrations(d, MIGRATIONS);
	const repos = createRepos(() => d);
	const videos = join(dir, "videos");
	mkdirSync(videos, { recursive: true });
	const draft = repos.drafts.create({ title: "T", level: "High school", source: {}, plan: plan, seriesId: null, brandKitId: null });
	return { dir, d, repos, videos, draftId: draft.id };
}

/** A fake worker: writes the files a real step would write. `fail` decides which step fails. */
function fakeWorker(calls: Call[], fail: (t: Task, n: number) => "ok" | "fail" | "hang" = () => "ok") {
	return async (_key: string, task: Task, onProgress: (p: number) => void) => {
		calls.push({ kind: task.kind, frameRange: task.kind === "chapter" ? task.frameRange : undefined });
		const what = fail(task, calls.length);
		if (what === "hang") return new Promise<void>(() => undefined);
		onProgress(0.5);
		if (what === "fail") throw Object.assign(new Error("Chrome crashed"), { cancelled: false });
		if (task.kind === "chapter") {
			writeFileSync(task.videoPath, "mp4");
			writeFileSync(task.audioPath, Buffer.alloc(100));
		} else if (task.kind === "join") writeFileSync(task.outputPath, "joined");
		else if (task.kind === "still") writeFileSync(task.outputPath, "png");
	};
}

function makeQueue(s: Awaited<ReturnType<typeof setupQueue>>, runTask: ReturnType<typeof fakeWorker>, views: RenderJobView[] = []) {
	const done: string[] = [];
	const q = createRenderQueue({
		repos: s.repos,
		videosDir: () => s.videos,
		roots: () => ({ drafts: join(s.dir, "drafts"), assets: join(s.dir, "assets"), videos: s.videos }),
		entryPoint: () => "video/src/index.ts",
		runTask,
		cancelTask: () => undefined,
		emit: (v) => views.push(v),
		onDone: (_t, id) => done.push(id),
	});
	return { q, done };
}

const input = (): RenderInput => {
	const pack = buildYoutubePack(plan, timeline, []);
	return { props: { plan, audioBase: "es-media://voice/x/" }, plan, pack, youtubeText: youtubeText(pack), srt: buildSrt(timeline) };
};

const add = (q: ReturnType<typeof makeQueue>["q"], draftId: string, settings = RenderSettings.parse({})) =>
	q.add({ draftId, title: plan.meta.title, level: plan.meta.level, settings, plan, timeline, input: input() });

const settle = async (q: ReturnType<typeof makeQueue>["q"]) => {
	// Time based, not a count of short waits: on a busy machine the timers run late.
	const end = Date.now() + 5000;
	while (q.isLive() && Date.now() < end) await new Promise((r) => setTimeout(r, 5));
	await new Promise((r) => setTimeout(r, 10));
};

describe("render queue", () => {
	it("renders every chapter, joins, makes 3 thumbnails and writes all output files", async () => {
		const s = await setupQueue();
		const calls: Call[] = [];
		const { q, done } = makeQueue(s, fakeWorker(calls));
		const jobId = await add(q, s.draftId);
		await settle(q);
		const job = s.repos.jobs.get(jobId)!;
		expect(job.status).toBe("done");
		const videoId = (job.result as { videoId: string }).videoId;
		expect(done).toEqual([videoId]);
		const dir = join(s.videos, videoId);
		for (const f of ["video.mp4", "thumbnail.png", "thumbnail-b.png", "thumbnail-c.png", "captions.srt", "youtube.txt", "plan.json"]) expect(existsSync(join(dir, f)), f).toBe(true);
		expect(existsSync(workDir(s.videos, videoId))).toBe(false);
		const chapters = calls.filter((c) => c.kind === "chapter");
		expect(chapters.length).toBe(timeline.chapters.length);
		// Chapter frame ranges cover the video with no gap and no overlap.
		expect(chapters.map((c) => c.frameRange)).toEqual(timeline.chapters.map((c) => [c.from, c.from + c.durationInFrames - 1]));
		expect(calls.filter((c) => c.kind === "still").length).toBe(3);
		const row = s.repos.videos.get(videoId)!;
		expect(row).toMatchObject({ width: 1920, height: 1080, draftId: s.draftId });
		expect(JSON.parse(readFileSync(join(dir, "plan.json"), "utf8")).meta.title).toBe(plan.meta.title);
	});

	it("a failed chapter renders alone on retry; finished chapters are kept", async () => {
		const s = await setupQueue();
		const calls: Call[] = [];
		let failOnce = true;
		const { q } = makeQueue(
			s,
			fakeWorker(calls, (t) => {
				if (t.kind === "chapter" && t.frameRange[0] === timeline.chapters[1]!.from && failOnce) {
					failOnce = false;
					return "fail";
				}
				return "ok";
			}),
		);
		const jobId = await add(q, s.draftId);
		await settle(q);
		const failed = q.view(s.repos.jobs.get(jobId)!);
		expect(failed.status).toBe("error");
		expect(failed.error).toBe("Chrome crashed");
		expect(failed.chapters.map((c) => c.state)).toEqual(["done", "error", ...Array(timeline.chapters.length - 2).fill("waiting")]);
		const before = calls.length;
		q.retry(jobId);
		await settle(q);
		const after = calls.slice(before).filter((c) => c.kind === "chapter");
		expect(after[0]!.frameRange![0]).toBe(timeline.chapters[1]!.from);
		expect(after.length).toBe(timeline.chapters.length - 1);
		expect(s.repos.jobs.get(jobId)!.status).toBe("done");
		expect((s.repos.jobs.get(jobId)!.payload as { resumes: number }).resumes).toBe(1);
	});

	it("after a crash, a new app start resumes at the chapter that was cut short", async () => {
		const s = await setupQueue();
		const calls: Call[] = [];
		// First run: chapter 3 never ends (the app is killed while it renders).
		const first = makeQueue(s, fakeWorker(calls, (t) => (t.kind === "chapter" && t.frameRange[0] === timeline.chapters[2]!.from ? "hang" : "ok")));
		const jobId = await add(first.q, s.draftId);
		await new Promise((r) => setTimeout(r, 50));
		expect(s.repos.jobs.get(jobId)!.status).toBe("running");
		const videoId = (s.repos.jobs.get(jobId)!.payload as { videoId: string }).videoId;
		// Simulate a half-written file of the cut-short chapter: it must render again.
		writeFileSync(chapterFiles(workDir(s.videos, videoId), 2).video, "");

		// Second "app start": a new queue on the same database.
		const calls2: Call[] = [];
		const second = makeQueue(s, fakeWorker(calls2));
		expect(second.q.resumeAll()).toBe(1);
		await new Promise((r) => setTimeout(r, 5));
		await settle(second.q);
		const ranges = calls2.filter((c) => c.kind === "chapter").map((c) => c.frameRange![0]);
		expect(ranges).toEqual(timeline.chapters.slice(2).map((c) => c.from));
		expect(s.repos.jobs.get(jobId)!.status).toBe("done");
	});

	it("cancel stops the job and removes its files; one job per draft", async () => {
		const s = await setupQueue();
		const calls: Call[] = [];
		const { q } = makeQueue(s, async (key, task, p) => {
			if (task.kind === "chapter") {
				// Behaves like the worker: the running step fails as cancelled.
				await new Promise((r) => setTimeout(r, 30));
				throw Object.assign(new Error("Cancelled"), { cancelled: true });
			}
			return fakeWorker(calls)(key, task, p);
		});
		const jobId = await add(q, s.draftId);
		await expect(add(q, s.draftId)).rejects.toThrow(/already in the render queue/);
		await new Promise((r) => setTimeout(r, 10));
		q.cancel(jobId);
		await settle(q);
		const job = s.repos.jobs.get(jobId)!;
		expect(job.status).toBe("cancelled");
		expect(existsSync(join(s.videos, (job.payload as { videoId: string }).videoId))).toBe(false);
		await q.clear(jobId);
		expect(s.repos.jobs.get(jobId)).toBeNull();
	});

	it("records 720p, 4K and 60 fps settings", async () => {
		const s = await setupQueue();
		const { q } = makeQueue(s, fakeWorker([]));
		const p60 = { ...plan, meta: { ...plan.meta, fps: 60 as const } };
		const t60 = computeTimeline(p60);
		const id = await q.add({ draftId: s.draftId, title: "x", level: "y", settings: RenderSettings.parse({ resolution: "2160p", fps: 60 }), plan: p60, timeline: t60, input: input() });
		await settle(q);
		const v = q.view(s.repos.jobs.get(id)!);
		expect(v).toMatchObject({ width: 3840, height: 2160, status: "done" });
		expect(v.chapters.reduce((n, c) => n + c.frames, 0)).toBe(t60.durationInFrames);
		expect(t60.durationInFrames).toBeGreaterThan(timeline.durationInFrames * 1.9);
	});

	it("guesses the time left from the frames made so far", () => {
		expect(estimateEta({ framesDone: 100, framesAtStart: 0, totalFrames: 1000, startedAt: 0, now: 1000 })).toBeNull();
		expect(estimateEta({ framesDone: 100, framesAtStart: 0, totalFrames: 1000, startedAt: 0, now: 10_000 })).toBe(Math.round(900 / (100 / 10_000) * 1.08 + 4000));
	});
});
