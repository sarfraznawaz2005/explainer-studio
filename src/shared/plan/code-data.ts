import { isRtl } from "./code";
import type { VideoPlan } from "./schema";
import type { Timeline } from "./timing";

/**
 * The data the AI's video code gets (the `video` prop). Shape documented in
 * CODE_TYPES (code.ts). Scene props are passed as they are in the plan, so a
 * text edit in the Studio shows in the code's picture at once.
 */
export type CodeVideoData = {
	width: number;
	height: number;
	fps: number;
	durationInFrames: number;
	title: string;
	level: string;
	language: string;
	rtl: boolean;
	intro: number;
	outro: number;
	chapters: { title: string; from: number; durationInFrames: number }[];
	scenes: CodeSceneData[];
};

export type CodeSceneData = {
	id: string;
	index: number;
	chapter: number;
	type: string;
	from: number;
	durationInFrames: number;
	props: Record<string, unknown>;
	sentences: { text: string; from: number; duration: number }[];
	cues: { frame: number; action: "reveal" | "highlight" | "focus" | "sfx"; target?: number }[];
	gaps: { from: number; duration: number; target: number }[];
};

export function codeVideoData(plan: VideoPlan, t: Timeline): CodeVideoData {
	return {
		width: plan.meta.width,
		height: plan.meta.height,
		fps: t.fps,
		durationInFrames: t.durationInFrames,
		title: plan.meta.title,
		level: plan.meta.level,
		language: plan.meta.language,
		rtl: isRtl(plan.meta.language),
		intro: t.intro,
		outro: t.outro,
		chapters: t.chapters.map((c) => ({ title: c.title, from: c.from, durationInFrames: c.durationInFrames })),
		scenes: t.scenes.map((s, index) => ({
			id: s.scene.id,
			index,
			chapter: s.chapterIndex,
			type: s.scene.type,
			from: s.from,
			durationInFrames: s.durationInFrames,
			props: s.scene.props as Record<string, unknown>,
			sentences: s.sentences.map((x) => ({ text: x.text, from: x.from, duration: x.duration })),
			cues: s.cues.map((c) => ({ frame: c.frame, action: c.action, ...(c.target === undefined ? {} : { target: c.target }) })),
			gaps: s.gaps.map((g) => ({ from: g.from, duration: g.duration, target: g.target })),
		})),
	};
}

/** The scene on screen at an absolute frame (the last one when past the end). */
export function codeSceneAt(video: CodeVideoData, frame: number): CodeSceneData | undefined {
	let found = video.scenes[0];
	for (const s of video.scenes) if (s.from <= frame) found = s;
	return found;
}
