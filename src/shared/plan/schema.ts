import { z } from "zod";
import { BrandStamp } from "../brand";
import { CaptionStyle } from "./captions";
import { CodeTweaks, VideoCode } from "./code";
import { LookRecipe } from "./look";
import { SCENE_PROPS } from "./scene-props";

export * from "./scene-props";

/**
 * The VideoPlan: one JSON document per draft. Written by the AI, edited by the
 * user, rendered by Remotion. Pure data, with one exception: meta.code (the "code"
 * style) is AI-written video code. It is checked by compileCode and runs only in a sandbox.
 * See PLAN.md section 7.
 */

const id = z.string().min(1).max(64);
const text = (max: number) => z.string().trim().min(1).max(max);

/* ---------- Narration and cues ---------- */

export const Sentence = z.object({
	id,
	text: text(600),
	/** Measured length of the voiced sentence. Missing until voice is made; then timing uses an estimate. */
	durationMs: z.number().int().positive().max(120_000).optional(),
	/** Voiced audio file for this sentence (set by the voice step). */
	audio: z.string().max(1024).optional(),
});
export type Sentence = z.infer<typeof Sentence>;

export const CueAction = z.enum(["reveal", "highlight", "focus", "sfx"]);
export const Cue = z.object({
	/** Index of the narration sentence the cue is tied to. */
	at: z.number().int().min(0),
	/** Fire when the sentence starts (default) or when it ends. */
	edge: z.enum(["start", "end"]).default("start"),
	/** Extra delay after the edge, can be negative. */
	offsetMs: z.number().int().min(-5000).max(5000).default(0),
	action: CueAction,
	/** What the cue acts on: an item index for lists/steps/bars/code steps. */
	target: z.number().int().min(0).max(99).optional(),
	/** Sound effect asset id for `sfx` cues. */
	sfx: z.string().max(64).optional(),
});
export type Cue = z.infer<typeof Cue>;

export const Transition = z.object({
	type: z.enum(["fade", "slide", "zoom", "none"]).default("fade"),
	durationMs: z.number().int().min(0).max(2000).default(400),
});

/* ---------- Scenes ---------- */

const base = {
	id,
	narration: z.array(Sentence).max(40).default([]),
	cues: z.array(Cue).max(80).default([]),
	transition: Transition.default({ type: "fade", durationMs: 400 }),
	/** Shortest time on screen, for scenes with little narration. */
	minDurationMs: z.number().int().min(0).max(60_000).optional(),
};

type PropsMap = typeof SCENE_PROPS;
const sceneOf = <K extends keyof PropsMap>(type: K) => z.object({ ...base, type: z.literal(type), props: SCENE_PROPS[type] as PropsMap[K] });

export const Scene = z.discriminatedUnion("type", [
	sceneOf("title"),
	sceneOf("chapter"),
	sceneOf("kinetic"),
	sceneOf("bullets"),
	sceneOf("definition"),
	sceneOf("quote"),
	sceneOf("summary"),
	sceneOf("glossary"),
	sceneOf("flow"),
	sceneOf("cycle"),
	sceneOf("tree"),
	sceneOf("mindmap"),
	sceneOf("diagram"),
	sceneOf("venn"),
	sceneOf("compare"),
	sceneOf("proscons"),
	sceneOf("chart"),
	sceneOf("counter"),
	sceneOf("equation"),
	sceneOf("graph"),
	sceneOf("code"),
	sceneOf("trace"),
	sceneOf("table"),
	sceneOf("timeline"),
	sceneOf("map"),
	sceneOf("analogy"),
	sceneOf("dialogue"),
	sceneOf("figure"),
	sceneOf("pause"),
	sceneOf("quiz"),
	sceneOf("lowerthird"),
	sceneOf("device"),
	sceneOf("chat"),
	sceneOf("social"),
	sceneOf("cta"),
	sceneOf("logo"),
	sceneOf("svg"),
]);
export type Scene = z.infer<typeof Scene>;
export type SceneInput = z.input<typeof Scene>;
export type SceneType = Scene["type"];
export const SCENE_TYPES = Object.keys(SCENE_PROPS) as SceneType[];
export type PropsOf<T extends SceneType> = Extract<Scene, { type: T }>["props"];

/* ---------- Plan ---------- */

export const STYLE_IDS = ["clean", "chalkboard", "paper", "blueprint", "neon", "cartoon", "academic", "brand", "free", "code"] as const;
export const StyleId = z.enum(STYLE_IDS);
export type StyleId = z.infer<typeof StyleId>;
/** Style names shown to the user. */
export const STYLE_LABELS: Record<StyleId, string> = { clean: "Clean", chalkboard: "Chalkboard", paper: "Paper", blueprint: "Blueprint", neon: "Neon", cartoon: "Cartoon", academic: "Academic", brand: "Brand", free: "AI look", code: "AI free-form" };

export const Chapter = z.object({ id, title: text(120), goal: z.string().max(300).optional(), scenes: z.array(Scene).min(1).max(60) });
export type Chapter = z.infer<typeof Chapter>;

export const MusicCue = z.object({
	assetId: id,
	startMs: z.number().int().min(0),
	endMs: z.number().int().min(0).optional(),
	volume: z.number().min(0).max(1).default(0.25),
	/** Lower the music while the voice speaks. */
	duck: z.boolean().default(true),
});
export const SfxCue = z.object({ assetId: id, atMs: z.number().int().min(0), volume: z.number().min(0).max(1).default(0.6) });

export const PlanMeta = z.object({
	title: text(120),
	level: text(60),
	language: z.string().min(2).max(16).default("en"),
	style: StyleId.default("clean"),
	/** The "free" style's recipe (colours, fonts, background, motion), designed by the AI for this video. */
	look: LookRecipe.optional(),
	/** The "code" style's video code, written by the AI for this video. Missing: the video uses the built-in scenes. */
	code: VideoCode.optional(),
	/** Quick changes to the "code" style's design (no AI call). */
	tweaks: CodeTweaks.optional(),
	voice: z.string().max(64).optional(),
	fps: z.union([z.literal(30), z.literal(60)]).default(30),
	width: z.number().int().min(320).max(3840).default(1920),
	height: z.number().int().min(240).max(2160).default(1080),
	/** Burned-in captions, a few words at a time while the voice speaks. */
	captions: CaptionStyle.default("off"),
	/** Speaking speed used to estimate sentences that have no voice yet. */
	wordsPerMinute: z.number().int().min(80).max(260).default(150),
	brandKitId: z.string().max(64).optional(),
	/** Brand intro, outro and watermark. Set only for renders (never saved with the draft). */
	brand: BrandStamp.optional(),
});

export const VideoPlan = z
	.object({
		version: z.literal(1),
		meta: PlanMeta,
		chapters: z.array(Chapter).min(1).max(40),
		music: z.array(MusicCue).max(50).default([]),
		sfx: z.array(SfxCue).max(500).default([]),
	})
	.superRefine((plan, ctx) => {
		const ids = new Set<string>();
		plan.chapters.forEach((ch, ci) =>
			ch.scenes.forEach((s, si) => {
				const path = ["chapters", ci, "scenes", si];
				if (ids.has(s.id)) ctx.addIssue({ code: "custom", path: [...path, "id"], message: `duplicate scene id "${s.id}"` });
				ids.add(s.id);
				s.cues.forEach((c, k) => {
					if (c.at >= Math.max(1, s.narration.length))
						ctx.addIssue({ code: "custom", path: [...path, "cues", k, "at"], message: `cue points at sentence ${c.at}, scene has ${s.narration.length}` });
				});
				if (s.type === "svg")
					s.props.animations.forEach((a, k) => {
						if (a.at >= Math.max(1, s.narration.length))
							ctx.addIssue({ code: "custom", path: [...path, "props", "animations", k, "at"], message: `animation starts at sentence ${a.at}, scene has ${s.narration.length}` });
					});
			}),
		);
	});
export type VideoPlan = z.infer<typeof VideoPlan>;
export type VideoPlanInput = z.input<typeof VideoPlan>;
