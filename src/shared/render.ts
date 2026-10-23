import { z } from "zod";
import type { VideoPlan } from "./plan/schema";
import type { Timeline } from "./plan/timing";

/**
 * Render settings and the text outputs of a render (captions, YouTube pack).
 * Pure code, shared by main (writes the files) and the renderer (shows them).
 */

/* ---------- Settings ---------- */

export const RESOLUTIONS = {
	"720p": { label: "720p HD", height: 720 },
	"1080p": { label: "1080p Full HD", height: 1080 },
	"1440p": { label: "1440p QHD", height: 1440 },
	"2160p": { label: "4K UHD", height: 2160 },
} as const;
export const Resolution = z.enum(["720p", "1080p", "1440p", "2160p"]);
export type Resolution = z.infer<typeof Resolution>;

/** crf + x264 preset per quality. Lower crf = better picture, bigger file. */
export const QUALITIES = {
	draft: { label: "Draft", hint: "Fast, smaller file", crf: 26, preset: "veryfast" },
	standard: { label: "Standard", hint: "Good for YouTube", crf: 20, preset: "medium" },
	high: { label: "High", hint: "Best picture, slower", crf: 16, preset: "slow" },
} as const;
export const Quality = z.enum(["draft", "standard", "high"]);
export type Quality = z.infer<typeof Quality>;

export const RenderSettings = z.object({
	resolution: Resolution.default("1080p"),
	fps: z.union([z.literal(30), z.literal(60)]).default(30),
	quality: Quality.default("standard"),
	/** Add the brand kit's intro, outro and watermark (when there is a kit). */
	brand: z.boolean().default(true),
});
export type RenderSettings = z.infer<typeof RenderSettings>;
export const DEFAULT_RENDER: RenderSettings = { resolution: "1080p", fps: 30, quality: "standard", brand: true };

/** Output size for a plan drawn at `width`×`height`. Remotion renders at composition size × scale. */
export function outputSize(plan: { width: number; height: number }, resolution: Resolution) {
	const scale = RESOLUTIONS[resolution].height / plan.height;
	// x264 needs even sizes.
	const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
	return { scale, width: even(plan.width * scale), height: even(plan.height * scale) };
}

/* ---------- Time stamps ---------- */

/** 0:00 / 1:05 / 1:02:03, as YouTube writes chapter times. */
export function stamp(ms: number): string {
	const total = Math.max(0, Math.floor(ms / 1000));
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = total % 60;
	return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

const framesToMs = (f: number, fps: number) => Math.round((f / fps) * 1000);

/**
 * YouTube chapter list. YouTube's rules: the first chapter starts at 0:00, there
 * are at least 3, and each is at least 10 seconds long. Short chapters are merged
 * into the one before; if fewer than 3 are left, no list is made (null).
 */
export function youtubeChapters(timeline: Timeline): { ms: number; title: string }[] | null {
	const out: { ms: number; title: string; end: number }[] = [];
	for (const c of timeline.chapters) {
		const ms = framesToMs(c.from, timeline.fps);
		const end = framesToMs(c.from + c.durationInFrames, timeline.fps);
		const last = out.at(-1);
		// A short chapter joins the one before. A short first chapter is taken over by the next.
		if (last && end - ms < 10_000) last.end = end;
		else if (last && last.end - last.ms < 10_000) Object.assign(last, { title: c.title, end });
		else out.push({ ms, title: c.title, end });
	}
	if (out[0]) out[0].ms = 0;
	return out.length >= 3 ? out.map(({ ms, title }) => ({ ms, title })) : null;
}

/* ---------- Captions ---------- */

const srtTime = (ms: number) => {
	const h = Math.floor(ms / 3_600_000);
	const m = Math.floor((ms % 3_600_000) / 60_000);
	const s = Math.floor((ms % 60_000) / 1000);
	const r = ms % 1000;
	const p = (n: number, w = 2) => String(n).padStart(w, "0");
	return `${p(h)}:${p(m)}:${p(s)},${p(r, 3)}`;
};

/** Splits a sentence into caption lines of at most `max` characters, at word edges. */
export function captionChunks(text: string, max = 84): string[] {
	const words = text.trim().split(/\s+/).filter(Boolean);
	const out: string[] = [];
	let cur = "";
	for (const w of words) {
		if (cur && cur.length + 1 + w.length > max) {
			out.push(cur);
			cur = w;
		} else cur = cur ? `${cur} ${w}` : w;
	}
	if (cur) out.push(cur);
	return out;
}

/** Two lines of at most 42 characters, the usual caption layout. */
function twoLines(chunk: string): string {
	if (chunk.length <= 42) return chunk;
	const words = chunk.split(" ");
	let best = 1;
	let bestDiff = Infinity;
	for (let i = 1; i < words.length; i++) {
		const a = words.slice(0, i).join(" ").length;
		const diff = Math.abs(a - (chunk.length - a - 1));
		if (diff < bestDiff) {
			bestDiff = diff;
			best = i;
		}
	}
	return `${words.slice(0, best).join(" ")}\n${words.slice(best).join(" ")}`;
}

/**
 * SubRip captions from the timeline: one cue per sentence, long sentences split
 * into parts that share the sentence time by length. Times match the voice.
 */
export function buildSrt(timeline: Timeline): string {
	const cues: string[] = [];
	for (const t of timeline.scenes) {
		for (const s of t.sentences) {
			const start = framesToMs(t.from + s.from, timeline.fps);
			const end = framesToMs(t.from + s.from + s.duration, timeline.fps);
			const parts = captionChunks(s.text);
			const chars = parts.reduce((n, p) => n + p.length, 0) || 1;
			let at = start;
			parts.forEach((p, i) => {
				const to = i === parts.length - 1 ? end : Math.round(at + ((end - start) * p.length) / chars);
				cues.push(`${cues.length + 1}\n${srtTime(at)} --> ${srtTime(to)}\n${twoLines(p)}\n`);
				at = to;
			});
		}
	}
	return cues.join("\n");
}

/* ---------- YouTube pack ---------- */

export type Credit = { title: string; author: string | null; license: string; line: string | null; sourceUrl: string | null };

export const YoutubePack = z.object({
	title: z.string(),
	description: z.string(),
	tags: z.array(z.string()),
	chapters: z.array(z.object({ ms: z.number(), title: z.string() })).nullable(),
	/** Credit lines that a license requires (CC BY). */
	credits: z.array(z.string()),
});
export type YoutubePack = z.infer<typeof YoutubePack>;

const STOP = new Set("a an and are as at be by for from how in into is it its of on or the this to what when why with your you".split(" "));

/** Up to 15 tags, at most 500 characters in total (YouTube's limit). */
export function makeTags(plan: VideoPlan, extra: { subject?: string } = {}): string[] {
	const raw = [extra.subject, plan.meta.title, ...plan.chapters.map((c) => c.title)].filter((x): x is string => !!x?.trim());
	const out: string[] = [];
	const add = (t: string) => {
		const tag = t
			.replace(/[<>"#,]/g, " ")
			.replace(/\s+/g, " ")
			.trim()
			.toLowerCase();
		if (tag.length < 2 || tag.length > 60 || out.includes(tag)) return;
		if (out.join(",").length + tag.length + 1 > 500) return;
		out.push(tag);
	};
	for (const r of raw.slice(0, 2)) add(r);
	for (const r of raw) {
		for (const w of r.split(/[^\p{L}\p{N}+#-]+/u)) if (w.length > 3 && !STOP.has(w.toLowerCase())) add(w);
	}
	add(`${plan.meta.level} explained`);
	add("explainer");
	return out.slice(0, 15);
}

/**
 * The YouTube pack. The description lists the chapters with their times and
 * every credit line a license requires. Public domain and CC0 sounds are thanked
 * in a short line (not required, but polite).
 */
export function buildYoutubePack(plan: VideoPlan, timeline: Timeline, credits: Credit[], extra: { subtitle?: string; subject?: string; hook?: string[]; series?: { title: string; episode: number } | null; channel?: string } = {}): YoutubePack {
	const chapters = youtubeChapters(timeline);
	const required = credits.map((c) => c.line).filter((l): l is string => !!l);
	const thanks = [...new Set(credits.filter((c) => !c.line).map((c) => c.author).filter((a): a is string => !!a))];
	const intro = extra.subtitle?.trim() || extra.hook?.[0]?.trim() || `${plan.meta.title}, explained step by step.`;
	const parts: string[] = [intro];
	if (extra.series) parts.push(`Episode ${extra.series.episode} of the series "${extra.series.title}".`);
	const goals = plan.chapters.map((c) => c.title);
	if (goals.length > 1) parts.push(`In this video:\n${goals.map((g) => `• ${g}`).join("\n")}`);
	if (chapters) parts.push(`Chapters\n${chapters.map((c) => `${stamp(c.ms)} ${c.title}`).join("\n")}`);
	if (required.length) parts.push(`Credits\n${required.join("\n")}`);
	if (thanks.length) parts.push(`Music and sound effects: ${thanks.join(", ")} (public domain / CC0).`);
	if (extra.channel) parts.push(`Subscribe to ${extra.channel} for more explainers.`);
	const tags = makeTags(plan, extra);
	return { title: plan.meta.title.slice(0, 100), description: parts.join("\n\n").slice(0, 5000), tags, chapters, credits: required };
}

/** youtube.txt: everything to paste into YouTube Studio. */
export function youtubeText(pack: YoutubePack): string {
	return [`TITLE\n${pack.title}`, `DESCRIPTION\n${pack.description}`, `TAGS\n${pack.tags.join(", ")}`].join("\n\n") + "\n";
}
