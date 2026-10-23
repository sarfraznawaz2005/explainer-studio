import { shell } from "electron";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Level } from "@shared/ipc/ingest";
import type { DraftBadge, DraftSummary, VideoView } from "@shared/ipc/library";
import { PlanSettings } from "@shared/planner";
import type { Draft, Video } from "@shared/models";
import { VideoPlan } from "@shared/plan/schema";
import { computeTimeline } from "@shared/plan/timing";
import { YoutubePack, youtubeText } from "@shared/render";
import { appFolders } from "../app/folders";
import { videoUrlFor } from "../app/media-url";
import { repos } from "../db/repos";
import { plannerBusy } from "../planner/jobs";
import { renderQueue } from "../render";
import { ownedDir } from "../security/path-guard";
import { narrationCounts } from "../voice/narration";
import { voiceBusy, voiceDir, voiceSetupOf } from "../voice/narration-jobs";

const THUMB_FILES = ["thumbnail.png", "thumbnail-b.png", "thumbnail-c.png"];

function mustVideo(id: string): Video {
	const v = repos.videos.get(id);
	if (!v) throw new Error("This video was not found. It may have been deleted.");
	return v;
}

function mustDraft(id: string): Draft {
	const d = repos.drafts.get(id);
	if (!d) throw new Error("This draft was not found. It may have been deleted.");
	return d;
}

type StoredPack = YoutubePack & { level?: string; fps?: number };

export function listVideos(): VideoView[] {
	return repos.videos.list({ orderBy: "createdAt" }).map((v) => {
		const y = v.youtube as StoredPack | null;
		const pack = YoutubePack.safeParse(y);
		const dir = dirname(v.filePath);
		return {
			id: v.id,
			title: v.title,
			level: typeof y?.level === "string" ? y.level : "",
			draftId: v.draftId && repos.drafts.get(v.draftId) ? v.draftId : null,
			durationMs: v.durationMs,
			width: v.width,
			height: v.height,
			fps: typeof y?.fps === "number" ? y.fps : 30,
			sizeBytes: v.sizeBytes,
			createdAt: v.createdAt,
			videoUrl: videoUrlFor(v.id, "video.mp4"),
			thumbnails: THUMB_FILES.filter((f) => existsSync(join(dir, f))).map((f) => videoUrlFor(v.id, f)),
			fileOk: existsSync(v.filePath),
			youtube: pack.success ? pack.data : null,
		};
	});
}

export function revealVideo(id: string): void {
	const v = mustVideo(id);
	if (existsSync(v.filePath)) shell.showItemInFolder(v.filePath);
	else if (existsSync(dirname(v.filePath))) void shell.openPath(dirname(v.filePath));
	else throw new Error("The video folder is gone. It was moved or deleted outside the app.");
}

export async function videoPack(id: string): Promise<string> {
	const v = mustVideo(id);
	try {
		return await readFile(join(dirname(v.filePath), "youtube.txt"), "utf8");
	} catch {
		const pack = YoutubePack.safeParse(v.youtube);
		if (!pack.success) throw new Error("This video has no YouTube pack.");
		return youtubeText(pack.data);
	}
}

export async function removeVideo(id: string): Promise<void> {
	mustVideo(id);
	const dir = ownedDir(appFolders().videos, id);
	await rm(dir, { recursive: true, force: true });
	repos.videos.remove(id);
}

/** Copies the voice clips of one draft to another, so the copy plays and renders with voice at once. */
async function copyVoice(fromDraft: string, toDraft: string) {
	const from = voiceDir(fromDraft);
	if (!existsSync(from)) return;
	await cp(from, voiceDir(toDraft), { recursive: true, filter: (src) => !src.endsWith(".part") });
}

function copyRow(d: Draft, patch: Partial<Draft>): Draft {
	return repos.drafts.create({
		id: randomUUID(),
		title: d.title,
		level: d.level,
		stage: d.stage,
		source: d.source,
		plan: d.plan,
		settings: d.settings,
		outline: d.outline,
		report: d.report,
		voice: d.voice,
		audio: d.audio,
		brandKitId: d.brandKitId,
		// A copy is not a new episode: it starts outside any series.
		seriesId: null,
		episode: null,
		...patch,
	});
}

export async function duplicateVideo(id: string): Promise<string> {
	const v = mustVideo(id);
	let plan: VideoPlan;
	try {
		plan = VideoPlan.parse(JSON.parse(await readFile(join(dirname(v.filePath), "plan.json"), "utf8")));
	} catch {
		throw new Error("The saved plan of this video is missing or damaged.");
	}
	const from = v.draftId ? repos.drafts.get(v.draftId) : null;
	const base: Draft = from ?? ({ title: v.title, level: plan.meta.level, stage: "preview", source: {}, plan: null, settings: null, outline: null, report: null, voice: null, audio: null, seriesId: null, brandKitId: null } as unknown as Draft);
	// plan.json holds the brand stamp of that render; the draft gets it again at the next render.
	const { brand: _stamp, ...meta } = plan.meta;
	const d = copyRow(base, { title: `${plan.meta.title} (copy)`.slice(0, 200), level: plan.meta.level, stage: "preview", plan: { ...plan, meta } });
	if (from) await copyVoice(from.id, d.id);
	return d.id;
}

export async function duplicateDraft(id: string): Promise<string> {
	const src = mustDraft(id);
	const title = `${src.title} (copy)`.slice(0, 200);
	const d = copyRow(src, { title });
	await copyVoice(src.id, d.id);
	return d.id;
}

/**
 * Same material, another audience: copies the source (and its figures) and the
 * wizard settings with the new level. The outline, script and voice are not
 * copied, because they must be written again for that level.
 */
export async function duplicateForLevel(id: string, level: Level): Promise<string> {
	const src = mustDraft(id);
	if (!src.source || typeof src.source !== "object" || !Object.keys(src.source).length) throw new Error("This draft has no source material to copy.");
	const settings = PlanSettings.safeParse(src.settings);
	const base = src.title.replace(/\s+\((copy|[A-Za-z ]+ version)\)$/, "");
	const d = copyRow(src, {
		title: `${base} (${level} version)`.slice(0, 200),
		level,
		stage: "source",
		settings: settings.success ? { ...settings.data, level } : null,
		outline: null,
		plan: null,
		report: null,
		voice: null,
	});
	const from = join(ownedDir(appFolders().drafts, src.id), "source");
	if (existsSync(from)) await cp(from, join(ownedDir(appFolders().drafts, d.id), "source"), { recursive: true, filter: (p) => !p.endsWith(".part") });
	return d.id;
}

export async function removeDraft(id: string): Promise<void> {
	mustDraft(id);
	if (renderQueue.activeFor(id)) throw new Error("This draft is rendering. Cancel the render first.");
	if (voiceBusy(id)) throw new Error("The voice for this draft is being made. Stop it first.");
	if (plannerBusy(id)) throw new Error("The script for this draft is being written. Stop it first.");
	const dir = ownedDir(appFolders().drafts, id);
	repos.drafts.remove(id);
	await rm(dir, { recursive: true, force: true });
}

function badgeOf(d: Draft, counts: { total: number; voiced: number } | null, videos: number): DraftBadge {
	if (renderQueue.activeFor(d.id)) return "rendering";
	const last = renderQueue.lastFor(d.id);
	if (last?.status === "error") return "failed";
	if (!counts) return d.stage === "script" ? "script" : d.outline ? "outline" : "source";
	if (counts.voiced < counts.total) return "voice";
	return videos > 0 ? "rendered" : "ready";
}

export function listDrafts(): DraftSummary[] {
	const seriesTitle = new Map(repos.series.list().map((s) => [s.id, s.title]));
	const videoCount = new Map<string, number>();
	for (const v of repos.videos.list()) if (v.draftId) videoCount.set(v.draftId, (videoCount.get(v.draftId) ?? 0) + 1);
	return repos.drafts.list({ orderBy: "updatedAt" }).map((d) => {
		const plan = VideoPlan.safeParse(d.plan);
		const timeline = plan.success ? computeTimeline(plan.data) : null;
		const counts = plan.success ? narrationCounts(plan.data, voiceSetupOf(d), voiceDir(d.id)) : null;
		const videos = videoCount.get(d.id) ?? 0;
		return {
			id: d.id,
			title: d.title,
			level: d.level,
			stage: d.stage,
			badge: badgeOf(d, counts, videos),
			chapters: plan.success ? plan.data.chapters.length : 0,
			scenes: timeline?.scenes.length ?? 0,
			durationMs: timeline ? Math.round((timeline.durationInFrames / timeline.fps) * 1000) : 0,
			sentences: counts?.total ?? 0,
			voiced: counts?.voiced ?? 0,
			videos,
			series: d.seriesId && d.episode && seriesTitle.has(d.seriesId) ? { id: d.seriesId, title: seriesTitle.get(d.seriesId)!, episode: d.episode } : null,
			createdAt: d.createdAt,
			updatedAt: d.updatedAt,
		};
	});
}
