import type { PlanSettings, VideoType } from "@shared/planner";

/**
 * Planner guides per video type: the structure of the outline and the scene
 * choices of the script. The explainer is the planner's own teaching arc, so it
 * adds nothing. Every type still uses only facts from the material.
 */
type Guide = { outline: string[]; script: string[] };

const GUIDES: Record<Exclude<VideoType, "explainer">, Guide> = {
	launch: {
		outline: [
			"This is a LAUNCH video: it announces something new from the material (a product, feature, version, course or event). Use this arc instead of the teaching arc:",
			"- Hook: the problem, or the moment that changes, in 1 or 2 sentences.",
			"- What it is, in one plain line.",
			"- The 2 or 3 most important benefits or features, each one shown (a demo step, an example, a before and after), not just named.",
			"- Proof: numbers, results or quotes from the material.",
			"- Call to action: where to get it and when, as the material says.",
			"- Short chapters and a quick pace. No recap chapter.",
		],
		script: [
			"This is a launch video: every scene has one message, in 1 to 3 sentences.",
			"- Good scene types here: title, kinetic, counter, compare (before and after), flow (how it works), figure (the product), quote.",
			"- The last scene states the call to action (a title or summary scene).",
			"- No quiz or pause scenes.",
		],
	},
	data: {
		outline: [
			"This is a DATA STORY: the numbers in the material tell the story. Use this arc instead of the teaching arc:",
			"- The question the numbers answer.",
			"- The baseline: what normal looks like.",
			"- The key finding, with its big number.",
			"- What drives it: a breakdown, a comparison or a trend over time.",
			"- What it means, and the takeaway.",
			"- Every number exactly as in the material, with its unit.",
		],
		script: [
			"This is a data story: give every important number a picture.",
			"- Good scene types here: chart, counter, table, compare, timeline, graph.",
			"- One chart for one idea. Say what the chart shows before its details, and highlight the bar or row that matters.",
			"- Comparable numbers on the same chart use the same unit and scale.",
		],
	},
	promo: {
		outline: [
			"This is a PROMO: a short ad for a product, service, course or event in the material. Use this arc instead of the teaching arc:",
			"- Hook: a pain or a wish the viewer has, in the first sentence.",
			"- The offer, as the answer.",
			"- 2 or 3 benefits for the viewer.",
			"- Proof: one number, quote or result from the material.",
			"- A strong call to action with one clear next step.",
			"- One chapter, or two at most. Speak to the viewer (you). No recap chapter.",
		],
		script: [
			"This is a promo: very short on-screen text (1 to 5 words), quick scenes of 1 or 2 sentences.",
			"- Good scene types here: kinetic, title, counter, compare, figure.",
			"- The last scene is the call to action (a title scene).",
			"- No quiz, pause, glossary or code scenes.",
		],
	},
};

/** Outline rules for the chosen video type (empty for an explainer). */
export function outlineGuide(s: Pick<PlanSettings, "videoType">): string[] {
	return s.videoType === "explainer" ? [] : ["", ...GUIDES[s.videoType].outline];
}

/** Script rules for the chosen video type (empty for an explainer). */
export function scriptGuide(s: Pick<PlanSettings, "videoType">): string[] {
	return s.videoType === "explainer" ? [] : ["", ...GUIDES[s.videoType].script];
}
