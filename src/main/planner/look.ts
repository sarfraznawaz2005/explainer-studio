import { LOOK_BACKGROUNDS, LOOK_ENTERS, LOOK_FONTS, LookRecipe, lookSummary } from "@shared/plan/look";
import { languageLabel, type VideoFormat } from "@shared/planner";
import { jsonInstructions } from "../ai/structured";
import type { PlannerAi } from "./ai";
import type { EstimateCall } from "./estimate";
import { tokens } from "./estimate";

/**
 * "AI free-form" style: the AI designs a look recipe for one video. It only fills
 * in menus (colours, fonts, background, motion); fixLook makes the result readable.
 */

export type LookBrief = {
	title: string;
	subject?: string;
	level: string;
	tone: string;
	language: string;
	format: VideoFormat;
	/** Looks this video had before: the new one must differ. */
	avoid?: string[];
	/** What the user wants, in their words ("darker", "like a retro poster"). */
	wish?: string;
};

const fonts = Object.entries(LOOK_FONTS)
	.map(([k, f]) => `${k} = ${f.label}`)
	.join("; ");

export const LOOK_SYSTEM = [
	"You are an art director for explainer videos. You design the whole-video look for ONE video: colours, fonts, card shapes, a background and motion.",
	"The look must fit the topic, the audience and the mood, and it should feel designed for this video, not generic.",
	"",
	"Rules:",
	"- Pick a clear idea first (for example 'old map parchment', 'night sky', 'lab notebook', 'retro poster', 'calm ocean', 'bold sports'), name it in `name` (2 to 4 words) and say in `idea` why it fits.",
	"- Colours are hex like #1a2b3c. Use 1 background colour plus `background2` for patterns, gradients and glows. `surface` is the card colour: close to the background (a little lighter or darker).",
	"- Text must be easy to read on the background and on cards. Accents must stand out from the background. Keep the palette to 3 accents that work together.",
	"- Dark backgrounds suit space, night, technology and drama. Light backgrounds suit young children, nature, history and calm topics. Vary it: do not always pick dark or always pick white.",
	`- Fonts (headingFont, bodyFont): ${fonts}. Body text must be easy to read for a long time: prefer modern, friendly, soft, serif or classic for the body. Handwriting, marker and comic fonts suit young children and casual topics. Typewriter and code fonts only for headings.`,
	"- corners: 0 for sharp and serious, 8 to 18 for neutral, 24 to 40 for playful. line.width: 0 to 5 (outline thickness; 0 = none). line.dashed for sketchy looks.",
	"- shadow: none (flat), soft, lifted (paper cards), hard (a solid offset shadow, comic and poster looks), glow (dark backgrounds only).",
	"- texture: chalk or pencil only for hand-drawn looks; else none. glow: true only on dark backgrounds for neon looks.",
	`- background.kind: ${LOOK_BACKGROUNDS.join(", ")}. strength 0.2 to 0.8 (keep it quiet behind text). moving: a slow drift. angle: gradient and stripe direction in degrees.`,
	`- motion.enter (how text and items come in): ${LOOK_ENTERS.join(", ")}. bounce: none (calm, serious), soft, lively (young children, fun topics). speed: slow (calm), normal, fast (energetic, short videos).`,
	"- Older and serious audiences: calm motion, less bounce. Young children: bright, friendly, lively.",
].join("\n");

/** The frame, as the look and code prompts describe it. */
export const FRAME_WORDS: Record<VideoFormat, string> = {
	landscape: "wide 16:9 (YouTube, web)",
	vertical: "vertical 9:16 for phones (Shorts, TikTok, Reels): bold and high contrast reads best on small screens",
	square: "square 1:1 for social feeds (Instagram, LinkedIn, X), mostly seen small on phones: bold and high contrast",
	portrait: "portrait 4:5 for social feeds (Instagram, Facebook), mostly seen small on phones: bold and high contrast",
};

export function lookPrompt(b: LookBrief): string {
	return [
		`Video title: ${b.title}`,
		b.subject ? `Subject: ${b.subject}` : "",
		`Audience level: ${b.level}. Tone: ${b.tone}. Language of the text: ${languageLabel(b.language)}.`,
		`Frame: ${FRAME_WORDS[b.format]}.`,
		b.avoid?.length ? `Looks used before (make something clearly different):\n${b.avoid.map((a) => `- ${a}`).join("\n")}` : "",
		b.wish ? `What the user asks for (follow it): ${b.wish}` : "",
	]
		.filter(Boolean)
		.join("\n");
}

export async function designLook(ai: PlannerAi, b: LookBrief): Promise<LookRecipe> {
	return ai.structured({ schema: LookRecipe, system: LOOK_SYSTEM, prompt: lookPrompt(b) }, { slot: "planner", purpose: "plan.look", maxOutputTokens: 1500 });
}

export function lookCalls(b: LookBrief): EstimateCall[] {
	return [{ slot: "planner", input: tokens(LOOK_SYSTEM.length + jsonInstructions(LookRecipe).length + lookPrompt(b).length), output: 600 }];
}

/** The old looks to avoid, newest first, at most 4. */
export const avoidList = (current: LookRecipe | undefined, older: string[] = []) => [...(current ? [lookSummary(current)] : []), ...older].slice(0, 4);
