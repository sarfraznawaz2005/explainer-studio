import { app, Notification } from "electron";
import { join } from "node:path";
import { renderEvents, type RenderCheck } from "@shared/ipc/render";
import { libraryEvents } from "@shared/ipc/library";
import { attributionFor, classifyLicense, LICENSES } from "@shared/assets";
import { Outline } from "@shared/planner";
import { VideoPlan } from "@shared/plan/schema";
import { buildSoundtrack, soundtrackAssets } from "@shared/plan/soundtrack";
import { computeTimeline } from "@shared/plan/timing";
import { buildSrt, buildYoutubePack, DEFAULT_RENDER, RenderSettings, youtubeText, type Credit } from "@shared/render";
import { appFolders } from "../app/folders";
import { audioBaseFor, figureBaseFor } from "../app/media-url";
import { pictureCredits } from "../pictures/library";
import { kitForDraft, stampForDraft } from "../brand";
import { writeLog } from "../app/logger";
import { getMainWindow } from "../app/window";
import { draftSound } from "../assets";
import { repos } from "../db/repos";
import { narrationCounts } from "../voice/narration";
import { voiceDir, voiceSetupOf } from "../voice/narration-jobs";
import { cancelTask, runTask } from "./manager";
import { createRenderQueue } from "./queue";

/**
 * Dev: the Remotion source, bundled by the worker on first use.
 * Release: the bundle made at build time (scripts/bundle-video.mjs), shipped outside the asar.
 */
export const videoEntry = () => (app.isPackaged ? join(process.resourcesPath, "video-bundle") : join(app.getAppPath(), "video", "src", "index.ts"));

const DEFAULTS_KEY = "render.defaults";

export function renderDefaults(): RenderSettings {
	const r = RenderSettings.safeParse(repos.settings.get(DEFAULTS_KEY) ?? {});
	return r.success ? r.data : DEFAULT_RENDER;
}

export function setRenderDefaults(s: RenderSettings): RenderSettings {
	repos.settings.set(DEFAULTS_KEY, s);
	return renderDefaults();
}

export const notifyLibraryChanged = () => getMainWindow()?.webContents.send(libraryEvents.changed, {});

function focusWindow() {
	const w = getMainWindow();
	if (!w) return;
	if (w.isMinimized()) w.restore();
	w.show();
	w.focus();
}

function toast(title: string, body: string) {
	if (!Notification.isSupported()) return;
	const n = new Notification({ title, body, silent: false });
	n.on("click", focusWindow);
	n.show();
}

export const renderQueue = createRenderQueue({
	repos,
	videosDir: () => appFolders().videos,
	roots: () => ({ drafts: appFolders().drafts, assets: appFolders().assets, videos: appFolders().videos }),
	entryPoint: videoEntry,
	runTask,
	cancelTask,
	emit: (v) => getMainWindow()?.webContents.send(renderEvents.job, v),
	onDone: (title) => {
		writeLog("render", "info", `video ready: ${title}`);
		notifyLibraryChanged();
		toast("Video ready", `"${title}" has finished rendering.`);
	},
	onFailed: (title, error) => {
		writeLog("render", "warn", `render failed: ${title}: ${error}`);
		notifyLibraryChanged();
		toast("Render failed", `"${title}" stopped: ${error}`.slice(0, 200));
	},
});

/** Everything about a draft's render that does not depend on the chosen settings. */
function snapshot(draftId: string, fps: 30 | 60, withBrand = true) {
	const d = repos.drafts.get(draftId);
	if (!d) throw new Error("This draft was not found. It may have been deleted.");
	const parsed = VideoPlan.safeParse(d.plan);
	if (!parsed.success) throw new Error("This draft has no script yet. Finish the script in New video first.");
	// The brand kit is frozen into the plan, so the timeline (and so captions, chapters, render parts) includes the intro and outro.
	const stamp = stampForDraft(d);
	const { brand: _old, ...meta } = parsed.data.meta;
	const plan: VideoPlan = { ...parsed.data, meta: { ...meta, fps, ...(withBrand && stamp ? { brand: stamp } : {}) } };
	const timeline = computeTimeline(plan);
	const sound = draftSound(draftId);
	const soundtrack = buildSoundtrack(plan, timeline, sound.setup, sound.library, { seed: sound.seed, roleDefaults: sound.roleDefaults });
	const credits: Credit[] = soundtrackAssets(soundtrack)
		.map((id) => repos.assets.get(id))
		.filter((a) => !!a)
		.map((a) => {
			const v = classifyLicense(a.license);
			const needs = v.ok && LICENSES[v.code].credit;
			return { title: a.title, author: a.author, license: a.license, sourceUrl: a.sourceUrl, line: needs ? (a.attribution ?? attributionFor(a)) : null };
		});
	// Photos found on the web that the video shows.
	const photos = pictureCredits(d);
	credits.push(...photos.lines);
	const outline = Outline.safeParse(d.outline);
	const extra = outline.success ? { subtitle: outline.data.subtitle, subject: outline.data.subject, hook: outline.data.hook } : {};
	const series = d.seriesId && d.episode ? repos.series.get(d.seriesId) : null;
	const episode = series && d.episode ? { title: series.title, episode: d.episode } : null;
	const pack = buildYoutubePack(plan, timeline, credits, { ...extra, series: episode, channel: plan.meta.brand?.channel });
	const counts = narrationCounts(parsed.data, voiceSetupOf(d), voiceDir(d.id));
	return { d, plan, timeline, soundtrack, pack, counts, stamp, episode, figureMeta: photos.meta };
}

export function renderCheck(draftId: string): RenderCheck {
	const s = snapshot(draftId, 30, renderDefaults().brand);
	const kit = kitForDraft(s.d);
	return {
		title: s.plan.meta.title,
		width: s.plan.meta.width,
		height: s.plan.meta.height,
		durationMs: Math.round((s.timeline.durationInFrames / s.timeline.fps) * 1000),
		chapters: s.plan.chapters.length,
		scenes: s.timeline.scenes.length,
		voiced: s.counts.voiced,
		sentences: s.counts.total,
		musicBeds: s.soundtrack.music.length,
		effects: s.soundtrack.sfx.length,
		credits: s.pack.credits,
		activeJobId: renderQueue.activeFor(draftId),
		defaults: renderDefaults(),
		brand: kit && s.stamp ? { name: kit.name, channel: s.stamp.channel, intro: s.stamp.intro, outro: s.stamp.outro, watermark: s.stamp.watermark.enabled } : null,
		series: s.episode,
	};
}

export async function queueDraft(draftId: string, settings: RenderSettings, remember: boolean): Promise<string> {
	const s = snapshot(draftId, settings.fps, settings.brand);
	if (remember) setRenderDefaults(settings);
	const props = { plan: s.plan, audioBase: audioBaseFor(s.d.id), soundtrack: s.soundtrack, figureBase: figureBaseFor(s.d.id), figureMeta: s.figureMeta };
	const id = await renderQueue.add({
		draftId,
		title: s.plan.meta.title,
		level: s.plan.meta.level,
		settings,
		plan: s.plan,
		timeline: s.timeline,
		input: { props, plan: s.plan, pack: s.pack, youtubeText: youtubeText(s.pack), srt: buildSrt(s.timeline) },
	});
	writeLog("render", "info", `queued ${s.plan.meta.title} (${settings.resolution} ${settings.fps} fps, ${settings.quality})`);
	return id;
}

/** Jobs cut short by a crash or by closing the app start again a few seconds after launch. */
export function resumeRendersSoon(): void {
	if (process.env.EXPLAINER_NO_RESUME) return;
	setTimeout(() => {
		try {
			const n = renderQueue.resumeAll();
			if (n) writeLog("render", "info", `resuming ${n} render job(s) after restart`);
		} catch (err) {
			writeLog("render", "error", "could not resume renders", err);
		}
	}, 3000);
}
