import type { SeriesForm, SeriesLook, SeriesView } from "@shared/ipc/series";
import { SeriesLook as LookSchema } from "@shared/ipc/series";
import type { Draft, Series } from "@shared/models";
import { VideoPlan } from "@shared/plan/schema";
import { videoUrlFor } from "../app/media-url";
import { repos } from "../db/repos";
import { listDrafts } from "../library";
import { plannerBusy } from "../planner/jobs";
import { voiceBusy, voiceSetupOf } from "../voice/narration-jobs";

/**
 * Series: videos grouped under one name, numbered as episodes, sharing one
 * style, voice and brand kit. A draft is an episode; its videos carry the
 * series and episode number they were rendered with.
 */

function mustSeries(id: string): Series {
	const s = repos.series.get(id);
	if (!s) throw new Error("This series was not found. It may have been deleted.");
	return s;
}

function mustDraft(id: string): Draft {
	const d = repos.drafts.get(id);
	if (!d) throw new Error("This draft was not found. It may have been deleted.");
	return d;
}

const lookOf = (s: Series): SeriesLook => {
	const r = LookSchema.safeParse(s.style);
	return r.success ? r.data : {};
};

const episodesOf = (seriesId: string) =>
	repos.drafts
		.list({ where: { seriesId } })
		.filter((d) => d.episode !== null)
		.sort((a, b) => a.episode! - b.episode!);

/** Numbers the episodes 1, 2, 3... in their current order (closes gaps after a removal). */
export function renumber(seriesId: string) {
	if (!repos.series.get(seriesId)) return;
	episodesOf(seriesId).forEach((d, i) => {
		if (d.episode !== i + 1) repos.drafts.update(d.id, { episode: i + 1 });
	});
	repos.series.update(seriesId, {});
}

export function listSeries(): SeriesView[] {
	const summaries = new Map(listDrafts().map((d) => [d.id, d]));
	const videos = repos.videos.list({ orderBy: "createdAt" });
	return repos.series.list({ orderBy: "updatedAt" }).map((s) => {
		const own = videos.filter((v) => v.seriesId === s.id);
		return {
			id: s.id,
			title: s.title,
			description: s.description,
			brandKitId: s.brandKitId,
			look: lookOf(s),
			episodes: episodesOf(s.id).map((d) => {
				const sum = summaries.get(d.id);
				const v = videos.find((x) => x.draftId === d.id);
				return {
					draftId: d.id,
					episode: d.episode!,
					title: d.title,
					level: d.level,
					badge: sum?.badge ?? "source",
					durationMs: sum?.durationMs ?? 0,
					video: v ? { id: v.id, thumbnail: v.thumbnailPath ? videoUrlFor(v.id, "thumbnail.png") : null, createdAt: v.createdAt } : null,
				};
			}),
			videosWithoutDraft: own.filter((v) => !v.draftId || !repos.drafts.get(v.draftId)).length,
			updatedAt: s.updatedAt,
		};
	});
}

export function seriesView(id: string): SeriesView {
	const v = listSeries().find((s) => s.id === id);
	if (!v) throw new Error("This series was not found. It may have been deleted.");
	return v;
}

function checkKit(id: string | null) {
	if (id && !repos.brandKits.get(id)) throw new Error("That brand kit was not found. Pick another one.");
}

export function createSeries(form: SeriesForm): SeriesView {
	checkKit(form.brandKitId);
	const s = repos.series.create({ title: form.title, description: form.description, brandKitId: form.brandKitId, style: {} });
	return seriesView(s.id);
}

export function updateSeries(id: string, form: SeriesForm): SeriesView {
	mustSeries(id);
	checkKit(form.brandKitId);
	repos.series.update(id, { title: form.title, description: form.description, brandKitId: form.brandKitId });
	return seriesView(id);
}

export function removeSeries(id: string): void {
	mustSeries(id);
	for (const d of repos.drafts.list({ where: { seriesId: id } })) repos.drafts.update(d.id, { seriesId: null, episode: null });
	repos.series.remove(id);
}

/** The draft's own style and voice, to start a series look from. */
function draftLook(d: Draft): SeriesLook {
	const plan = VideoPlan.safeParse(d.plan);
	const meta = plan.success ? plan.data.meta : undefined;
	return { style: meta?.style, look: meta?.style === "free" ? meta.look : undefined, code: meta?.style === "code" ? meta.code : undefined, voice: voiceSetupOf(d) };
}

function applyLook(d: Draft, look: SeriesLook) {
	const patch: Partial<Pick<Draft, "plan" | "voice">> = {};
	const plan = VideoPlan.safeParse(d.plan);
	if (look.style && plan.success) {
		const meta = plan.data.meta;
		// An AI look is shared too, so every episode looks the same.
		const recipe = look.style === "free" ? (look.look ?? meta.look) : meta.look;
		// The AI design code too: it reads its texts from each episode's plan.
		const code = look.style === "code" ? (look.code ?? meta.code) : meta.code;
		if (meta.style !== look.style || JSON.stringify(recipe) !== JSON.stringify(meta.look) || code?.source !== meta.code?.source) patch.plan = { ...plan.data, meta: { ...meta, style: look.style, look: recipe, code } };
	}
	if (look.voice) patch.voice = look.voice;
	if (Object.keys(patch).length) repos.drafts.update(d.id, patch);
}

export function addToSeries(seriesId: string, draftId: string, withLook: boolean): SeriesView {
	const s = mustSeries(seriesId);
	const d = mustDraft(draftId);
	if (d.seriesId === seriesId) return seriesView(seriesId);
	if (withLook && (voiceBusy(draftId) || plannerBusy(draftId))) throw new Error("This draft is busy (voice or script). Wait until it finishes.");
	const oldSeries = d.seriesId;
	const episodes = episodesOf(seriesId);
	const next = (episodes.at(-1)?.episode ?? 0) + 1;
	repos.drafts.update(draftId, { seriesId, episode: next });
	const look = lookOf(s);
	// The first episode sets the look; later episodes follow it.
	if (!look.style && !look.voice) repos.series.update(seriesId, { style: draftLook(d) });
	else if (withLook) applyLook(d, look);
	else repos.series.update(seriesId, {});
	if (oldSeries) renumber(oldSeries);
	return seriesView(seriesId);
}

export function removeFromSeries(draftId: string): void {
	const d = mustDraft(draftId);
	if (!d.seriesId) return;
	repos.drafts.update(draftId, { seriesId: null, episode: null });
	renumber(d.seriesId);
}

export function moveEpisode(draftId: string, by: -1 | 1): SeriesView {
	const d = mustDraft(draftId);
	if (!d.seriesId) throw new Error("This draft is not in a series.");
	const list = episodesOf(d.seriesId);
	const i = list.findIndex((x) => x.id === draftId);
	const j = i + by;
	if (i < 0 || j < 0 || j >= list.length) return seriesView(d.seriesId);
	[list[i], list[j]] = [list[j]!, list[i]!];
	list.forEach((x, k) => repos.drafts.update(x.id, { episode: k + 1 }));
	repos.series.update(d.seriesId, {});
	return seriesView(d.seriesId);
}
