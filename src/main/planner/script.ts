import { z } from "zod";
import { BulletsProps, ChartProps, CodeProps, DeviceProps, DiagramLabels, FigureFile, FigureProps, FlowProps, LogoProps, SCENE_PROPS, SummaryProps, SvgMarkup, VideoPlan, type Scene, type SceneType, type VideoPlanInput } from "@shared/plan/schema";
import { SCENE_LABELS } from "@shared/plan/describe";
import { languageLabel, VIDEO_FORMATS, type Outline, type PlanSettings, type VideoType } from "@shared/planner";
import type { Source } from "@shared/source";
import { describeIssues } from "../ai/structured";
import type { PlannerAi } from "./ai";
import { audienceFor, audienceRules, type Audience } from "./audience";
import { CHAPTER_SOURCE_CHARS, mapForPrompt, sourceForPrompt, type KnowledgeChunk } from "./knowledge";
import { scriptGuide } from "./video-types";

/**
 * One chapter of the outline → narration and scenes. The model picks scene
 * types from those that fit the level (young audiences never get code or
 * charts) and writes the props and the spoken sentences. Ids, chapter cards,
 * the hook title card and timing defaults are added here, so the model cannot
 * get them wrong.
 */

export class PlannerError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "PlannerError";
	}
}

const say = z.string().trim().min(1).max(600);
const label = (max: number) => z.string().trim().min(1).max(max);

/** Figures the model may show: source figure id → file name in source/figures. */
export type FigureRef = { id: string; file: string; caption: string | null; origin?: "source" | "mine" | "web"; mustUse?: boolean; chapter?: number };
export const figureRefs = (source: Pick<Source, "figures">): FigureRef[] =>
	source.figures
		.map((f) => ({ id: f.id, file: f.file.split("/").pop()!, caption: f.caption, origin: f.origin, mustUse: f.mustUse, chapter: f.search?.chapter }))
		.filter((f) => FigureFile.safeParse(f.file).success);

const kindOf = (f: FigureRef) => (f.origin === "web" ? "photo from the web" : f.origin === "mine" ? "the creator's own picture" : "figure from the material");

/**
 * Photos each chapter should show: web photos found for it, and the creator's
 * must-use pictures spread over the chapters in order (chapters are written in
 * parallel, so each picture gets one home and is not shown twice).
 */
export function chapterPictures(figures: FigureRef[], chapters: number, index: number): FigureRef[] {
	const web = figures.filter((f) => f.origin === "web" && f.chapter === index + 1);
	const mine = figures.filter((f) => f.origin === "mine" && f.mustUse);
	return [...web, ...mine.filter((_, k) => k % Math.max(1, chapters) === index)];
}

/** Scene types the model may choose from: the level's list without the cards it never writes (and no figure scenes without figures). */
/** Scene types for ads and announcements: offered only in launch and promo videos. */
export const PROMO_TYPES: ReadonlySet<SceneType> = new Set(["lowerthird", "social", "cta", "logo"]);

export const contentTypes = (a: Audience, figures: FigureRef[] = [], videoType: VideoType = "explainer") =>
	a.scenes.filter((t) => t !== "title" && t !== "chapter" && (t !== "figure" || figures.length > 0) && (!PROMO_TYPES.has(t) || videoType === "launch" || videoType === "promo"));

function propsFor(type: SceneType, a: Audience, figures: FigureRef[]): z.ZodType {
	const n = a.maxItems;
	const figureId = figures.length ? z.enum(figures.map((f) => f.id) as [string, ...string[]]) : z.never();
	switch (type) {
		case "bullets":
			return BulletsProps.extend({ items: z.array(label(200)).min(1).max(n) });
		case "flow":
			return FlowProps.extend({ steps: z.array(z.object({ label: label(60), detail: z.string().max(140).optional() })).min(2).max(Math.min(7, n)) });
		case "compare": {
			const side = z.object({ title: label(60), points: z.array(label(200)).min(1).max(Math.min(6, n)) });
			return z.object({ heading: z.string().max(120).optional(), left: side, right: side, verdict: z.string().max(200).optional() });
		}
		case "chart":
			return ChartProps.extend({ data: z.array(z.object({ label: label(30), value: z.number() })).min(2).max(Math.min(12, Math.max(4, n))) });
		case "summary":
			return SummaryProps.extend({ items: z.array(label(140)).min(1).max(n) });
		case "figure":
			// The model names a source figure by id; tidyProps turns it into the file name.
			return FigureProps.extend({ figure: figureId });
		case "diagram":
			return z
				.object({ heading: z.string().max(120).optional(), figure: figureId.optional(), svg: SvgMarkup.optional(), labels: DiagramLabels })
				.refine((p) => !!p.figure !== !!p.svg, { message: "give either figure or svg (one of them)", path: ["svg"] });
		case "device":
			return DeviceProps.extend({ figure: figureId.optional() });
		case "logo":
			return LogoProps.extend({ figure: figureId.optional() });
		case "title":
		case "chapter":
			throw new Error(`scene type ${type} is not written by the model`);
		default:
			return SCENE_PROPS[type];
	}
}

export function aiSceneSchema(a: Audience, figures: FigureRef[] = [], only?: SceneType) {
	const types = only ? [only] : contentTypes(a, figures);
	const [first, ...rest] = types.map((type) =>
		z.object({ type: z.literal(type), props: propsFor(type, a, figures), narration: z.array(say).min(1).max(Math.max(12, a.sentencesPerScene[1] + 3)) }),
	);
	return rest.length ? z.discriminatedUnion("type", [first!, ...rest]) : first!;
}

export function chapterScriptSchema(a: Audience, figures: FigureRef[] = []) {
	return z.object({
		/** Spoken on the chapter card. */
		intro: say,
		scenes: z.array(aiSceneSchema(a, figures)).min(1).max(40),
	});
}
export type ChapterScript = { intro: string; scenes: { type: SceneType; props: Record<string, unknown>; narration: string[] }[] };

export const SCENE_GUIDE: Partial<Record<SceneType, string>> = {
	kinetic: "1 to 6 short punchy lines that land one by one (mode stack or punch); emphasis lists words to colour. For a hook, a surprising fact or a key message.",
	bullets: "a heading and a few short points that appear one by one. For lists, steps without arrows, recaps.",
	definition: "one key term, its meaning and an example. Use the first time an important term appears.",
	quote: "a short quotation with author and source. Only real quotations that are in the material.",
	summary: "a checklist of what was learned; each item gets a tick. For the end of a chapter or video.",
	glossary: "up to 6 terms with one-line meanings. For a chapter that introduces several terms at once.",
	flow: "steps joined by arrows, appearing one by one. For processes, algorithms in words, cause and effect.",
	cycle: "3 to 8 steps in a loop, with an optional word in the middle. For anything that repeats: water cycle, life cycles, feedback loops.",
	tree: "a hierarchy: node 0 is the root, every other node gives the index of an earlier node as its parent. For classifications, family trees, org charts, file systems.",
	mindmap: "a central idea with 2 to 8 branches, each with up to 4 short children. For an overview of a topic.",
	diagram: "a picture with labels: either a source figure (by id) or a simple drawing in svg; each label points at x,y (percent of the picture). For parts of a thing: a cell, a machine, an organ.",
	venn: "2 or 3 overlapping sets with items, and what they share in the middle. For similarities and differences.",
	compare: "two columns side by side. For A versus B, before and after, wrong idea versus right idea.",
	proscons: "advantages and disadvantages, then an optional verdict. For choices and trade-offs.",
	chart: "an animated bar, line or pie chart with real numbers from the material. Only when the material has numbers to compare; pie only for parts of a whole.",
	counter: "1 to 4 big numbers that count up, each with a label. For striking figures from the material.",
	equation: "a derivation, one KaTeX line per step with a short note. For formulas and worked algebra. Write valid KaTeX (\\frac, ^, _, \\sqrt); never \\href or \\url.",
	graph: "a plot of y = f(x): expr uses x, numbers, + - * / ^, brackets, pi, e and sin cos tan sqrt abs ln log exp; points mark x values. For functions and relationships.",
	code: "a code listing; each step focuses a line range (1-based, inclusive) with a short note. For code, pseudocode and algorithms written as code.",
	trace: "an algorithm running on a small array (2 to 12 cells): each step shows pointers (name and index), the range still in play, cells compared, swapped or set, cells done, the cell found, and a short note. The array changes by swap and set, step after step. For searching and sorting.",
	table: "a table with 2 to 6 columns whose rows appear one by one; highlight one row or cell. For facts with the same fields.",
	timeline: "2 to 8 dated events in order. For history and sequences in time.",
	map: "pins on a world or region map (lat, lon in degrees) with labels; route joins them in order. For places, journeys, where things are.",
	analogy: "the idea on the left, an everyday thing it is like on the right, matching pairs, and where the analogy stops working.",
	dialogue: "1 or 2 simple characters (looks: kid, kid2, teacher, scientist, robot, cat, owl) talking in speech bubbles; who is 0 or 1. For young viewers, questions and answers, misconceptions.",
	figure: "a figure from the source (by id) with a slow zoom and up to 5 numbered callouts at x,y (percent). Only when the figure shows the idea.",
	pause: "a question to the viewer, then silent thinking time (seconds), then the answer. The first narration sentence asks the question; the next ones explain the answer.",
	quiz: "1 to 4 multiple-choice questions with the index of the right option; each gets thinking time before its answer shows. For a recap at the end of a chapter.",
	lowerthird: "a name bar at the bottom (name and role) under an optional big statement. To introduce a person or quote someone by name. Mostly for launch and promo videos.",
	device: "a phone or browser window showing a figure from the list (by id) or a simple app screen with 1 to 5 items that appear one by one; url for the browser bar. To show a product, an app or a website at work.",
	chat: "1 to 8 chat messages between 'me' and 'them' that appear one by one, as in a messaging app; title names the other side. For a customer question, a support talk or a real-life exchange.",
	social: "a social post or review card: author, handle, the words (read along with the voice), stars 1 to 5 for a review, likes and shares. Only with words and numbers from the material. Mostly for launch and promo videos.",
	cta: "the end card: a headline, up to 3 short points, a button with the action (2 to 4 words) and the detail (a web address or handle) from the material. Only as the last scene of a launch or promo video.",
	logo: "a logo sting: the name, a tagline, and a figure from the list (by id) when it is the logo. Only at the very start or end of a launch or promo video.",
	svg: "your own simple drawing: SVG markup with a viewBox, using only shapes (rect circle ellipse line polyline polygon path text g), gradients and ids. No script, style element, image, links, event handlers or external references. Colours may be the words accent, accent2, accent3, positive, ink, muted, paper so the drawing follows the video style. animations move elements by id (from/to: opacity, x, y, scale, rotate, draw for strokes, fill), starting at a narration sentence. For anything the other types cannot show.",
};

export function scriptSystem(s: PlanSettings, figures: FigureRef[] = []): string {
	const a = audienceFor(s.level);
	return [
		"You write the narration and the scene plan for one chapter of a YouTube explainer video. Each scene is one screen; its narration is spoken while the screen shows.",
		"",
		audienceRules(a),
		"",
		`Scene types you can use (at this level only these):`,
		...contentTypes(a, figures, s.videoType).map((t) => `- ${t} (${SCENE_LABELS[t]}): ${SCENE_GUIDE[t]}`),
		"",
		"Rules for scenes:",
		"- Pick the scene type that shows the idea best. Vary the types; do not use the same type more than twice in a row.",
		`- Each scene has ${a.sentencesPerScene[0]} to ${a.sentencesPerScene[1]} narration sentences and at most ${a.maxItems} items on screen.`,
		"- Items (bullets, steps, bars, nodes, labels, pins, events, rows, dialogue lines, quiz questions, trace and code steps) appear in order while the narration goes on: item k appears at sentence k × sentences ÷ items. So talk about the items in the same order, about one item per sentence.",
		"- Use code and trace scenes only when the topic is programming or an algorithm. Use figure scenes and diagrams with a figure only with the figures listed below.",
		"- Photos (from the web or the creator) go in figure scenes: the narration talks about what the photo shows, the caption names it, callouts are optional. Show each photo at most once in the video, and only in the chapter it is planned for.",
		"- On-screen text is short (labels, not sentences). The narration explains; it does not read the screen word for word.",
		"- Teach only what the source material says. You may add an analogy, a question to the viewer or a simple everyday example, but no new facts, numbers, names or dates.",
		"- Copy code, numbers and definitions exactly from the material.",
		"- `intro` is one sentence spoken on the chapter card that says what the chapter is about.",
		`- Write all narration and on-screen text in ${languageLabel(s.language)}. Tone: ${s.tone}.`,
		...(s.format === "square" || s.format === "portrait"
			? [
					"",
					`This is a ${s.format === "square" ? "square (1:1)" : "portrait (4:5)"} video for social feeds (Instagram, Facebook, LinkedIn), mostly watched small on a phone, often without sound at first.`,
					"- Keep on-screen text short: labels of 1 to 5 words, and at most 5 items in a scene.",
					"- Prefer scenes with one clear idea. Tables get at most 3 columns.",
					"- Make the first scene grab attention: the main promise or question, in big words.",
				]
			: []),
		...(s.format === "vertical"
			? [
					"",
					"This is a vertical video (9:16) watched on a phone: Shorts, TikTok, Reels. The screen is narrow and tall.",
					"- Keep on-screen text very short: labels of 1 to 4 words, and at most 4 items in a scene.",
					"- Prefer scenes with one big idea: kinetic text, a counter, a definition, a short flow, a quiz or pause question. Tables get at most 3 columns.",
					"- Grab attention in the first sentence of every scene. Keep the pace quick.",
				]
			: []),
		...scriptGuide(s),
		...(figures.length ? ["", "Figures and photos you may show (id, kind: caption):", ...figures.slice(0, 40).map((f) => `- ${f.id} (${kindOf(f)}): ${f.caption ?? "(no caption)"}`)] : []),
	].join("\n");
}

export type ChapterContext = {
	source: Pick<Source, "title" | "sections" | "figures">;
	outline: Outline;
	settings: PlanSettings;
	map: KnowledgeChunk[] | null;
	/** Extra wishes from the creator when a chapter is written again. */
	instructions?: string;
};

/** Pauses between sentences, scene lead-ins and chapter cards take about a fifth of the running time. */
export const SPEECH_SHARE = 0.8;

export function chapterWords(ctx: ChapterContext, index: number): number {
	return Math.max(40, Math.round(ctx.outline.chapters[index]!.minutes * audienceFor(ctx.settings.level).wordsPerMinute * SPEECH_SHARE));
}

/** The source text a chapter script sees: its sections, else the knowledge map, else the whole source (cut). */
export function chapterSource(ctx: ChapterContext, index: number): string {
	const ch = ctx.outline.chapters[index]!;
	if (ch.sources.length) return sourceForPrompt(ctx.source, { sections: ch.sources, maxChars: CHAPTER_SOURCE_CHARS });
	if (ctx.map) return mapForPrompt(ctx.map).slice(0, CHAPTER_SOURCE_CHARS);
	return sourceForPrompt(ctx.source, { maxChars: CHAPTER_SOURCE_CHARS });
}

export function scriptPrompt(ctx: ChapterContext, index: number): string {
	const { outline } = ctx;
	const ch = outline.chapters[index]!;
	const last = index === outline.chapters.length - 1;
	return [
		`Video: "${outline.title}" for ${ctx.settings.level}.`,
		`All chapters: ${outline.chapters.map((c, i) => `${i + 1}. ${c.title}${i === index ? " (this one)" : ""}`).join(" | ")}`,
		"",
		`Write chapter ${index + 1}: ${ch.title}`,
		`Goal: ${ch.goal}`,
		`Key points, in order:\n${ch.keyPoints.map((p) => `- ${p}`).join("\n")}`,
		`Length: about ${chapterWords(ctx, index)} words of narration in total (± 20%).`,
		outline.terms.length ? `Key terms of the video (define each the first time it appears): ${outline.terms.join(", ")}` : "",
		outline.misconceptions.length ? `Common wrong ideas (address them where they fit this chapter): ${outline.misconceptions.join(" | ")}` : "",
		index === 0 ? `The video opens with this hook, already spoken before this chapter. Do not repeat it: ${outline.hook.join(" ")}` : "",
		last ? "This is the last chapter: end with a short recap of the whole video and a friendly goodbye." : "",
		ctx.instructions ? `Extra instructions from the creator (follow them): ${ctx.instructions}` : "",
		...(() => {
			const pics = chapterPictures(figureRefs(ctx.source), outline.chapters.length, index);
			return pics.length ? ["Photos planned for this chapter (show each in its own figure scene where it fits the narration):", ...pics.map((f) => `- ${f.id}: ${f.caption ?? "(no caption)"}`)] : [];
		})(),
		"",
		"Source material for this chapter (section ids in brackets):",
		chapterSource(ctx, index),
	]
		.filter((l) => l !== "")
		.join("\n");
}

const clip = (t: string, max: number) => (t.length <= max ? t : `${t.slice(0, max - 1).replace(/\s+\S*$/, "")}…`);

/** Fixes small things the schema cannot express: code line ranges, chart highlights, figure ids → files. */
export function tidyProps(type: SceneType, props: Record<string, unknown>, figures: FigureRef[] = []): Record<string, unknown> {
	if ((type === "figure" || type === "diagram" || type === "device" || type === "logo") && typeof props.figure === "string") {
		const f = figures.find((x) => x.id === props.figure);
		return { ...props, figure: f?.file ?? props.figure };
	}
	if (type === "code") {
		const p = props as z.output<typeof CodeProps>;
		const lines = Math.max(1, p.code.replace(/\n+$/, "").split("\n").length);
		const steps = (p.steps ?? [])
			.map((st) => {
				const a = Math.min(lines, Math.max(1, st.lines[0]));
				const b = Math.min(lines, Math.max(a, st.lines[1]));
				return { ...st, lines: [a, b] as [number, number] };
			})
			.slice(0, 12);
		return { ...p, steps };
	}
	if (type === "chart") {
		const p = props as z.output<typeof ChartProps>;
		return p.highlight !== undefined && p.highlight >= p.data.length ? { ...p, highlight: undefined } : p;
	}
	return props;
}

/** Turns a chapter script into plan scenes with stable ids and a chapter card first. */
export function toScenes(index: number, script: ChapterScript, outline: Outline, figures: FigureRef[] = []): Scene[] {
	const ch = outline.chapters[index]!;
	const n = index + 1;
	const card: Scene = {
		id: `ch${n}-card`,
		type: "chapter",
		props: { number: n, title: clip(ch.title, 120), goal: clip(ch.goal, 200) },
		narration: [{ id: `ch${n}-card-n1`, text: script.intro }],
		cues: [],
		transition: { type: "fade", durationMs: 400 },
	};
	const scenes = script.scenes.map((sc, k) => {
		const id = `ch${n}-s${k + 1}`;
		return {
			id,
			type: sc.type,
			props: tidyProps(sc.type, sc.props, figures),
			narration: sc.narration.map((text, j) => ({ id: `${id}-n${j + 1}`, text })),
			cues: [],
			transition: { type: k % 3 === 2 ? "slide" : "fade", durationMs: 400 },
		} as unknown as Scene;
	});
	return [card, ...scenes];
}

/**
 * The hook: a title card with the first 15 seconds of narration. No kicker: the subject
 * and audience level are for the creator, not something to show viewers.
 */
export function hookScene(outline: Outline, _s: PlanSettings): Scene {
	return {
		id: "hook",
		type: "title",
		props: { title: clip(outline.title, 120), subtitle: outline.subtitle ? clip(outline.subtitle, 200) : undefined },
		narration: outline.hook.map((text, j) => ({ id: `hook-n${j + 1}`, text })),
		cues: [],
		transition: { type: "fade", durationMs: 400 },
	};
}

/** Writes one chapter. Invalid replies are repaired by the structured-output loop (2 rounds), then reported. */
export async function writeChapter(ctx: ChapterContext, index: number, ai: PlannerAi): Promise<Scene[]> {
	const a = audienceFor(ctx.settings.level);
	const words = chapterWords(ctx, index);
	const figures = figureRefs(ctx.source);
	try {
		const script = (await ai.structured(
			{ schema: chapterScriptSchema(a, figures), system: scriptSystem(ctx.settings, figures), prompt: scriptPrompt(ctx, index) },
			{ slot: "planner", purpose: "plan.script", maxOutputTokens: Math.min(32_000, 4000 + words * 6) },
		)) as ChapterScript;
		return toScenes(index, script, ctx.outline, figures);
	} catch (err) {
		if ((err as Error).name === "StructuredOutputError") throw new PlannerError(`Chapter ${index + 1} ("${ctx.outline.chapters[index]!.title}"): ${(err as Error).message}`);
		throw err;
	}
}

/** Puts the chapters together and checks the whole plan. */
export function assemblePlan(outline: Outline, s: PlanSettings, chapters: Scene[][]): VideoPlan {
	const a = audienceFor(s.level);
	const input: VideoPlanInput = {
		version: 1,
		meta: {
			title: clip(outline.title, 120),
			level: s.level,
			language: s.language,
			style: s.style === "auto" ? outline.style : s.style,
			voice: s.voice,
			fps: 30,
			width: VIDEO_FORMATS[s.format].width,
			height: VIDEO_FORMATS[s.format].height,
			wordsPerMinute: a.wordsPerMinute,
		},
		chapters: outline.chapters.map((ch, i) => ({ id: ch.id, title: clip(ch.title, 120), goal: ch.goal, scenes: i === 0 ? [hookScene(outline, s), ...chapters[i]!] : chapters[i]! })),
		music: [],
		sfx: [],
	};
	const r = VideoPlan.safeParse(input);
	if (!r.success) throw new PlannerError(`The finished plan is not valid: ${describeIssues(r.error, 5).join("; ")}`);
	return r.data;
}
