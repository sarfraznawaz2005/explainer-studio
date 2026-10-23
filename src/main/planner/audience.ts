import type { Level } from "@shared/ipc/ingest";
import { SCENE_TYPES, type SceneType, type StyleId } from "@shared/plan/schema";

/**
 * How the audience level shapes a video: words, sentence length, pace, how much
 * goes on one screen, and which scene types fit. Based on the audience rules of
 * the explain skill (references/audience.md), extended down to kindergarten and
 * up to PhD.
 */
export type Audience = {
	level: Level;
	ages: string;
	/** Longest narration sentence, in words. */
	maxSentenceWords: number;
	/** Speaking speed; also stored in the plan for timing. */
	wordsPerMinute: number;
	/** Narration sentences per content scene. */
	sentencesPerScene: [number, number];
	/** Most bullets, steps, chart bars or compare points on one screen. */
	maxItems: number;
	/** Longest time one scene may stay on screen before it feels dense. */
	maxSceneSeconds: number;
	/** Scene types that fit this level. */
	scenes: SceneType[];
	/** Fallback visual style when the AI does not pick one. */
	style: StyleId;
	/** Flag words with more syllables than this (kindergarten to middle school). null = no check. */
	maxSyllables: number | null;
	words: string;
	visuals: string;
	math: string;
	tone: string;
	analogies: string;
};

/** Scene types a young audience can follow: big pictures, few words, no notation. */
const YOUNG: SceneType[] = ["title", "chapter", "kinetic", "bullets", "definition", "summary", "flow", "cycle", "compare", "counter", "analogy", "dialogue", "figure", "pause", "quiz", "svg"];
const PRIMARY: SceneType[] = [...YOUNG, "glossary", "tree", "mindmap", "diagram", "venn", "chart", "table", "timeline", "map"];
/** Every type. Code walkthroughs and traces only make sense when the topic is code; the prompt says so. */
const ALL: SceneType[] = SCENE_TYPES;

export const AUDIENCES: Record<Level, Audience> = {
	Kindergarten: {
		level: "Kindergarten",
		ages: "4-6",
		maxSentenceWords: 8,
		wordsPerMinute: 115,
		sentencesPerScene: [2, 4],
		maxItems: 3,
		maxSceneSeconds: 25,
		scenes: YOUNG,
		style: "cartoon",
		maxSyllables: 3,
		words: "Only words a five-year-old uses at home. No technical terms. If one cannot be avoided, say it, show it and repeat it.",
		visuals: "One big idea per screen. Very few words on screen: 1 to 4 words per bullet. Flows of at most 3 steps.",
		math: "Counting and comparing only. No symbols, no formulas, no code.",
		tone: "Warm, playful and slow. Talk to the child as 'you'. Use 'imagine' and tiny stories with toys, animals and food.",
		analogies: "Everyday things a small child knows: toys, sharing snacks, lining up, building blocks.",
	},
	Primary: {
		level: "Primary",
		ages: "6-10",
		maxSentenceWords: 10,
		wordsPerMinute: 125,
		sentencesPerScene: [2, 5],
		maxItems: 4,
		maxSceneSeconds: 30,
		scenes: PRIMARY,
		style: "chalkboard",
		maxSyllables: 3,
		words: "Only everyday words. No jargon. A key term is said, shown and repeated.",
		visuals: "Big, few, friendly items on screen. One thing per picture. Short bullets.",
		math: "Counting and simple + - x with real numbers. Simple bar charts only. No code.",
		tone: "Warm, playful, 'you'. Use 'imagine' and short stories.",
		analogies: "Everyday things: water in pipes, a crowded hallway, sharing pizza, a seesaw.",
	},
	"Middle school": {
		level: "Middle school",
		ages: "11-13",
		maxSentenceWords: 15,
		wordsPerMinute: 135,
		sentencesPerScene: [3, 6],
		maxItems: 5,
		maxSceneSeconds: 40,
		scenes: ALL,
		style: "clean",
		maxSyllables: 4,
		words: "Plain words. Introduce each key term once, with a one-line meaning.",
		visuals: "Clear labelled steps and comparisons. Cause then effect.",
		math: "Basic formulas, shown with real numbers first, then the symbols. Short, simple code only if the topic is code.",
		tone: "Friendly and curious. Concrete examples from daily life.",
		analogies: "Everyday things, and say where the analogy stops working.",
	},
	"High school": {
		level: "High school",
		ages: "14-18",
		maxSentenceWords: 20,
		wordsPerMinute: 145,
		sentencesPerScene: [3, 7],
		maxItems: 6,
		maxSceneSeconds: 50,
		scenes: ALL,
		style: "clean",
		maxSyllables: null,
		words: "Subject terms are fine once defined. Avoid stacked abstractions.",
		visuals: "Labelled processes, charts with units, code walkthroughs, comparisons.",
		math: "Formulas with a sketch of why they hold. Units matter.",
		tone: "Respectful and direct. Link to exams and to why it is true.",
		analogies: "Everyday things plus the explicit limit: 'this breaks when...'.",
	},
	College: {
		level: "College",
		ages: "18-20",
		maxSentenceWords: 25,
		wordsPerMinute: 155,
		sentencesPerScene: [3, 8],
		maxItems: 6,
		maxSceneSeconds: 55,
		scenes: ALL,
		style: "clean",
		maxSyllables: null,
		words: "Standard vocabulary of the subject. Define the non-obvious.",
		visuals: "Process flows, charts, code walkthroughs, trade-off comparisons.",
		math: "Full notation. Show the steps; do not skip algebra.",
		tone: "Peer to peer. Intuition first, rigour second.",
		analogies: "Everyday things or simpler models, with their limits.",
	},
	University: {
		level: "University",
		ages: "20+",
		maxSentenceWords: 30,
		wordsPerMinute: 160,
		sentencesPerScene: [3, 8],
		maxItems: 7,
		maxSceneSeconds: 65,
		scenes: ALL,
		style: "clean",
		maxSyllables: null,
		words: "Precise terminology. State assumptions.",
		visuals: "Dense but clean: detailed flows, complexity comparisons, code with line-by-line focus, data charts.",
		math: "Full rigour where it helps understanding; intuition still first. Name complexity, edge cases and limits.",
		tone: "Concise and exact. Name the edge cases and the limits of the idea.",
		analogies: "A simpler model as the analogy ('like X, but...').",
	},
	PhD: {
		level: "PhD",
		ages: "postgraduate",
		maxSentenceWords: 35,
		wordsPerMinute: 170,
		sentencesPerScene: [3, 9],
		maxItems: 8,
		maxSceneSeconds: 75,
		scenes: ALL,
		style: "clean",
		maxSyllables: null,
		words: "Field-standard terminology and notation. Assumptions and definitions explicit.",
		visuals: "Dense diagrams, formal comparisons, code and data. Several ideas may share a screen when they belong together.",
		math: "Formal statements, proofs sketched, complexity bounds, open questions.",
		tone: "Fast, exact and critical. Point to limits, alternatives and open problems.",
		analogies: "Related formal models and where they differ.",
	},
};

export const audienceFor = (level: Level): Audience => AUDIENCES[level];

/** The audience rules as prompt text. */
export function audienceRules(a: Audience): string {
	return [
		`Audience: ${a.level} (ages ${a.ages}).`,
		`- Words: ${a.words}`,
		`- Sentences: at most ${a.maxSentenceWords} words each. One idea per sentence.`,
		`- On screen: ${a.visuals} At most ${a.maxItems} items per screen.`,
		`- Maths and code: ${a.math}`,
		`- Tone: ${a.tone}`,
		`- Analogies: ${a.analogies} Say where an analogy stops working.`,
		"Rules at every level: picture first, then words that point at it ('the orange box is...'). Concrete example before the general rule.",
		"Define each key term the first time it is used. Never say 'obviously', 'simply', 'just', 'clearly' or 'of course'.",
		"Speak to the viewer as 'you'. Plain words even at high levels: precision is not complexity.",
	].join("\n");
}
