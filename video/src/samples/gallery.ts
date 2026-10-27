import type { SceneInput, SceneType, VideoPlanInput } from "../../../src/shared/plan/schema";

/**
 * One hand-written scene of every scene type. Used by the snapshot tests
 * (tests/render/stills.render.test.ts) and as a library preview.
 * The figure scene needs a figure folder (figureBase); without one it shows a placeholder.
 */
let n = 0;
const say = (...texts: string[]) => texts.map((text) => ({ id: `g${++n}`, text }));

const LEAF_SVG = `<svg viewBox="0 0 800 500" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="accent3" stop-opacity="0.25"/><stop offset="1" stop-color="accent3" stop-opacity="0.05"/></linearGradient>
  </defs>
  <rect x="0" y="0" width="800" height="500" rx="24" fill="url(#sky)"/>
  <circle id="sun" cx="680" cy="100" r="56" fill="accent"/>
  <g id="rays" stroke="accent" stroke-width="8" stroke-linecap="round">
    <path d="M600 140 L470 210"/><path d="M620 170 L500 260"/><path d="M650 185 L560 300"/>
  </g>
  <path id="leaf" d="M140 380 C 180 200, 380 150, 470 250 C 400 400, 220 430, 140 380 Z" fill="positive" fill-opacity="0.85" stroke="ink" stroke-width="5"/>
  <path id="vein" d="M150 375 C 250 320, 340 290, 460 255" fill="none" stroke="ink" stroke-width="4"/>
  <g id="co2"><circle cx="120" cy="150" r="34" fill="paper" stroke="muted" stroke-width="4"/><text x="120" y="160" text-anchor="middle" font-size="28" fill="ink">CO₂</text></g>
  <g id="o2"><circle cx="560" cy="420" r="34" fill="paper" stroke="accent2" stroke-width="4"/><text x="560" y="430" text-anchor="middle" font-size="28" fill="ink">O₂</text></g>
</svg>`;

const HEART_SVG = `<svg viewBox="0 0 600 600" xmlns="http://www.w3.org/2000/svg">
  <path d="M300 540 C 120 420, 40 300, 60 190 C 80 90, 200 50, 300 150 C 400 50, 520 90, 540 190 C 560 300, 480 420, 300 540 Z" fill="accent2" fill-opacity="0.2" stroke="accent2" stroke-width="8"/>
  <path d="M300 150 L 300 520" stroke="accent2" stroke-width="6" stroke-dasharray="14 12"/>
  <path d="M120 250 C 180 230, 230 260, 290 250" fill="none" stroke="ink" stroke-width="5"/>
  <path d="M310 250 C 370 260, 420 230, 480 250" fill="none" stroke="ink" stroke-width="5"/>
  <circle cx="200" cy="360" r="60" fill="accent" fill-opacity="0.25" stroke="accent" stroke-width="5"/>
  <circle cx="400" cy="360" r="60" fill="accent3" fill-opacity="0.25" stroke="accent3" stroke-width="5"/>
</svg>`;

export const GALLERY_SCENES: SceneInput[] = [
	{ id: "title", type: "title", props: { kicker: "Scene library", title: "Every Way to Explain", subtitle: "One example of each scene type" }, narration: say("Here is every scene type the studio can draw.") },
	{ id: "chapter", type: "chapter", props: { number: 3, title: "Energy from Light", goal: "How plants turn sunlight into food" }, narration: say("Chapter three. Energy from light.") },
	{
		id: "kinetic",
		type: "kinetic",
		props: { lines: ["Plants don't eat food.", "They make it.", "From light, air and water."], emphasis: ["make", "light"] },
		narration: say("Plants do not eat food like we do.", "They make it themselves.", "And they make it from light, air and water."),
	},
	{ id: "bullets", type: "bullets", props: { heading: "What a plant needs", items: ["Sunlight", "Carbon dioxide from the air", "Water from the soil"] }, narration: say("A plant needs three things.", "Air gives it carbon dioxide.", "The soil gives it water.") },
	{ id: "definition", type: "definition", props: { term: "Photosynthesis", partOfSpeech: "noun", definition: "The way green plants use light to make sugar from carbon dioxide and water.", example: "A leaf in the sun is doing photosynthesis." }, narration: say("Photosynthesis is how plants make their food.", "A leaf in the sun is doing it right now.") },
	{ id: "quote", type: "quote", props: { text: "The leaf is the factory, and sunlight is its power supply.", author: "A biology teacher", source: "Grade 7 lesson" }, narration: say("One teacher put it like this.", "The leaf is the factory, and sunlight is its power supply.") },
	{ id: "summary", type: "summary", props: { heading: "Remember", items: ["Leaves catch light", "Roots bring water", "Sugar is the food", "Oxygen is let out"] }, narration: say("Let us sum up.", "Leaves catch light and roots bring water.", "Sugar is made, and oxygen goes into the air.") },
	{
		id: "glossary",
		type: "glossary",
		props: { terms: [{ term: "Chlorophyll", meaning: "The green stuff in leaves that catches light." }, { term: "Stomata", meaning: "Tiny holes that let air in and out." }, { term: "Glucose", meaning: "The sugar a plant makes." }] },
		narration: say("Three words to know.", "Chlorophyll catches light, and stomata let air in.", "Glucose is the sugar."),
	},
	{
		id: "flow",
		type: "flow",
		props: { heading: "Inside the leaf", steps: [{ label: "Light hits", detail: "Chlorophyll absorbs it" }, { label: "Water splits", detail: "Oxygen is released" }, { label: "Sugar forms", detail: "Using carbon dioxide" }] },
		narration: say("First, light hits the leaf.", "The energy splits water.", "Then sugar is built from carbon dioxide."),
	},
	{
		id: "cycle",
		type: "cycle",
		props: { heading: "The water cycle", center: "Water", steps: [{ label: "Evaporation" }, { label: "Condensation" }, { label: "Rain" }, { label: "Collection" }] },
		narration: say("The sun warms the sea and water evaporates.", "High up, it cools into clouds.", "It falls back as rain.", "And it collects in rivers and seas again."),
	},
	{
		id: "tree",
		type: "tree",
		props: { heading: "Living things", nodes: [{ label: "Living things" }, { label: "Plants", parent: 0 }, { label: "Animals", parent: 0 }, { label: "Trees", parent: 1 }, { label: "Grasses", parent: 1 }, { label: "Mammals", parent: 2 }, { label: "Birds", parent: 2 }] },
		narration: say("Living things split into groups.", "Plants and animals are the two big ones.", "Plants include trees and grasses.", "Animals include mammals and birds."),
	},
	{
		id: "mindmap",
		type: "mindmap",
		props: { center: "Leaf", branches: [{ label: "Parts", children: ["Blade", "Vein"] }, { label: "Jobs", children: ["Make food", "Breathe"] }, { label: "Colour", children: ["Green"] }, { label: "Shapes", children: ["Needle", "Broad"] }] },
		narration: say("Let us map out the leaf.", "It has parts and jobs.", "It is usually green.", "And it comes in many shapes."),
	},
	{
		id: "diagram",
		type: "diagram",
		props: { heading: "The heart", svg: HEART_SVG, labels: [{ text: "Left side", x: 30, y: 58, detail: "Pumps to the body" }, { text: "Right side", x: 70, y: 58, detail: "Pumps to the lungs" }, { text: "Septum", x: 50, y: 40 }] },
		narration: say("The heart has two sides.", "The left side pumps blood to the body.", "The right side pumps it to the lungs, and a wall called the septum keeps them apart."),
	},
	{
		id: "venn",
		type: "venn",
		props: { heading: "Plants and animals", sets: [{ label: "Plants", items: ["Make food", "Have roots"] }, { label: "Animals", items: ["Eat food", "Move around"] }], overlap: ["Grow", "Need water"], overlapLabel: "Both" },
		narration: say("Plants make their own food.", "Animals have to eat.", "But both grow and need water."),
	},
	{
		id: "compare",
		type: "compare",
		props: { heading: "Day and night", left: { title: "Day", points: ["Photosynthesis", "Takes in CO₂"] }, right: { title: "Night", points: ["Only breathing", "Gives out CO₂"] }, verdict: "Plants breathe all the time but make food only in light." },
		narration: say("In the day, a plant makes food.", "At night, it only breathes."),
	},
	{
		id: "proscons",
		type: "proscons",
		props: { heading: "Growing plants indoors", pros: ["Cleaner air", "Fresh herbs"], cons: ["Needs a sunny window", "Must remember to water"], verdict: "Worth it with a sunny spot." },
		narration: say("Indoor plants clean the air.", "You can grow fresh herbs.", "But they need a sunny window.", "And you must remember to water them."),
	},
	{
		id: "chart",
		type: "chart",
		props: { heading: "What a leaf makes per hour", kind: "pie", unit: "%", data: [{ label: "Sugar", value: 55 }, { label: "Oxygen", value: 30 }, { label: "Other", value: 15 }], highlight: 0 },
		narration: say("Most of what the leaf makes is sugar.", "About a third is oxygen.", "The rest is other things."),
	},
	{
		id: "counter",
		type: "counter",
		props: { heading: "Big numbers", counters: [{ value: 390000, label: "known plant species" }, { value: 28, unit: "%", label: "of oxygen from rainforests" }] },
		narration: say("Scientists know about three hundred and ninety thousand plant species.", "Rainforests make over a quarter of our oxygen."),
	},
	{
		id: "equation",
		type: "equation",
		props: {
			heading: "The equation",
			steps: [
				{ tex: "\\text{carbon dioxide} + \\text{water} \\xrightarrow{\\text{light}} \\text{sugar} + \\text{oxygen}", note: "In words" },
				{ tex: "6\\,CO_2 + 6\\,H_2O \\xrightarrow{h\\nu} C_6H_{12}O_6 + 6\\,O_2", note: "With symbols" },
				{ tex: "E = h\\nu = \\frac{hc}{\\lambda}", note: "Energy of light" },
			],
		},
		narration: say("In words, carbon dioxide and water make sugar and oxygen.", "With symbols, six of each go in.", "The energy comes from light."),
	},
	{
		id: "graph",
		type: "graph",
		props: { heading: "More light, more sugar", functions: [{ expr: "10(1 - e^(-x/3))", label: "sugar made" }], x: [0, 12], y: [0, 11], points: [{ x: 3, label: "half way" }], xLabel: "light", yLabel: "rate" },
		narration: say("More light means more sugar.", "But the curve flattens out.", "After a point, more light does not help."),
	},
	{
		id: "code",
		type: "code",
		props: { heading: "Model it in Python", language: "python", code: "def sugar(light, water):\n    if water == 0:\n        return 0\n    return min(light, water) * 2", steps: [{ lines: [1, 1], note: "Two inputs" }, { lines: [2, 3], note: "No water, no sugar" }, { lines: [4, 4], note: "The smaller input limits it" }] },
		narration: say("Here is a tiny model.", "Without water, nothing is made.", "Otherwise the smaller input sets the limit."),
	},
	{
		id: "trace",
		type: "trace",
		props: {
			heading: "Binary search for 23",
			array: [2, 5, 8, 12, 16, 23, 38, 56, 72],
			steps: [
				{ pointers: [{ name: "lo", index: 0 }, { name: "mid", index: 4 }, { name: "hi", index: 8 }], range: [0, 8], compare: [4, 4], note: "16 is less than 23: go right" },
				{ pointers: [{ name: "lo", index: 5 }, { name: "mid", index: 6 }, { name: "hi", index: 8 }], range: [5, 8], note: "38 is more than 23: go left" },
				{ pointers: [{ name: "lo", index: 5 }, { name: "mid", index: 5 }, { name: "hi", index: 5 }], range: [5, 5], found: 5, note: "Found 23 at index 5" },
			],
		},
		narration: say("We look at the middle first.", "Then we look at half of what is left.", "Three looks, and we found it."),
	},
	{
		id: "table",
		type: "table",
		props: { heading: "Leaf types", columns: ["Plant", "Leaf", "Lives in"], rows: [["Pine", "Needle", "Cold places"], ["Oak", "Broad", "Woods"], ["Cactus", "Spine", "Deserts"]], highlight: { row: 2, col: 1 } },
		narration: say("Pine trees have needles.", "Oaks have broad leaves.", "A cactus has spines instead."),
	},
	{
		id: "timeline",
		type: "timeline",
		props: { heading: "Discovering photosynthesis", events: [{ date: "1648", label: "Van Helmont", detail: "Trees gain mass" }, { date: "1771", label: "Priestley", detail: "Plants restore air" }, { date: "1779", label: "Ingenhousz", detail: "Light is needed" }, { date: "1950s", label: "Calvin", detail: "The sugar cycle" }] },
		narration: say("In 1648, a tree was weighed.", "In 1771, plants were shown to fix air.", "In 1779, light was found to matter.", "In the 1950s, the sugar cycle was mapped."),
	},
	{
		id: "map",
		type: "map",
		props: { heading: "The great rainforests", view: "world", route: false, pins: [{ label: "Amazon", lat: -3.4, lon: -62 }, { label: "Congo", lat: -1, lon: 22 }, { label: "Borneo", lat: 0.9, lon: 114 }] },
		narration: say("The Amazon is the biggest rainforest.", "The Congo is second.", "And Borneo has some of the oldest."),
	},
	{
		id: "analogy",
		type: "analogy",
		props: { heading: "A leaf is like a kitchen", idea: "Leaf", like: "Kitchen", pairs: [{ idea: "Sunlight", like: "The stove's heat" }, { idea: "Water and CO₂", like: "Ingredients" }, { idea: "Sugar", like: "The meal" }], limit: "A kitchen needs a cook; a leaf runs by itself." },
		narration: say("Think of a leaf as a kitchen.", "Sunlight is the heat.", "Water and air are the ingredients, and sugar is the meal.", "But no cook is needed."),
	},
	{
		id: "dialogue",
		type: "dialogue",
		props: { setting: "In the garden", characters: [{ name: "Mia", look: "kid2" }, { name: "Professor Owl", look: "owl" }], lines: [{ who: 0, text: "Why are leaves green?" }, { who: 1, text: "Because chlorophyll reflects green light!" }, { who: 0, text: "So they use the other colours?" }] },
		narration: say("Mia asks why leaves are green.", "The owl says chlorophyll reflects green light.", "So the leaf uses the other colours."),
	},
	{
		id: "figure",
		type: "figure",
		props: { figure: "in1-001.png", caption: "A leaf under a microscope", callouts: [{ x: 30, y: 35, text: "Cell wall" }, { x: 66, y: 60, text: "Chloroplast" }] },
		narration: say("This is a leaf, magnified.", "The green dots are chloroplasts."),
	},
	{
		id: "pause",
		type: "pause",
		props: { question: "Why do plants grow towards a window?", answer: "They bend towards the light, because light is what they use to make food.", seconds: 4, hint: "Think about what plants need." },
		narration: say("Here is a question for you. Why do plants grow towards a window?", "They bend towards the light, because light is their energy."),
	},
	{
		id: "quiz",
		type: "quiz",
		props: { questions: [{ question: "What gas do plants give out?", options: ["Oxygen", "Carbon dioxide", "Nitrogen", "Helium"], answer: 0, explain: "Oxygen is made when water is split." }], seconds: 3 },
		narration: say("Quick quiz. What gas do plants give out?", "It is oxygen."),
	},
	{
		id: "lowerthird",
		type: "lowerthird",
		props: { name: "Dr. Amina Okafor", role: "Plant biologist", statement: "Every leaf is a tiny solar factory." },
		narration: say("Doctor Amina Okafor studies plants.", "She calls every leaf a tiny solar factory."),
	},
	{
		id: "device",
		type: "device",
		props: { heading: "Track your garden", device: "phone", items: ["Water the basil", "Move the fern to light", "Feed the tomatoes"] },
		narration: say("The garden app keeps a simple list.", "Water the basil.", "Move the fern into the light.", "Feed the tomatoes."),
	},
	{
		id: "chat",
		type: "chat",
		props: {
			heading: "Ask the gardener",
			title: "Garden help",
			messages: [
				{ from: "me", text: "Why are my leaves turning yellow?" },
				{ from: "them", text: "Too little light, most of the time." },
				{ from: "me", text: "So a sunnier window?" },
				{ from: "them", text: "Yes, and water a little less." },
			],
		},
		narration: say("A reader asks why the leaves turn yellow.", "Most of the time, the plant gets too little light.", "So a sunnier window helps.", "And a little less water."),
	},
	{
		id: "social",
		type: "social",
		props: { author: "Maya Lin", handle: "@mayagrows", text: "Moved my plants to the east window and they doubled in a month. Light really is food!", stars: 5, likes: 12400, shares: 860 },
		narration: say("Maya moved her plants to an east window.", "They doubled in a month. Light really is food."),
	},
	{
		id: "cta",
		type: "cta",
		props: { headline: "Grow greener plants this week", points: ["Free plant guide", "5-minute lessons"], action: "Start learning", detail: "example.com/plants" },
		narration: say("Grow greener plants this week.", "Get the free guide and short lessons.", "Start learning today."),
	},
	{
		id: "logo",
		type: "logo",
		props: { name: "Leafy Lab", tagline: "Science you can grow" },
		narration: say("Leafy Lab. Science you can grow."),
	},
	{
		id: "svg",
		type: "svg",
		props: {
			heading: "Light in, oxygen out",
			svg: LEAF_SVG,
			caption: "Sunlight + CO₂ → sugar + O₂",
			animations: [
				{ target: "leaf", at: 0, from: { opacity: 0, scale: 0.6 }, to: { opacity: 1, scale: 1 }, ease: "spring" },
				{ target: "vein", at: 0, offsetMs: 500, durationMs: 900, from: { draw: 0 }, to: { draw: 1 } },
				{ target: "sun", at: 1, from: { scale: 0 }, to: { scale: 1 }, ease: "spring" },
				{ target: "rays", at: 1, offsetMs: 300, durationMs: 800, from: { draw: 0 }, to: { draw: 1 } },
				{ target: "co2", at: 2, durationMs: 1200, from: { opacity: 0, x: -120 }, to: { opacity: 1, x: 120, y: 150 } },
				{ target: "o2", at: 2, offsetMs: 900, durationMs: 900, from: { opacity: 0, y: 40 }, to: { opacity: 1, y: 0 } },
			],
		},
		narration: say("Here is the leaf.", "The sun shines on it.", "Carbon dioxide goes in, and oxygen comes out."),
	},
];

/** A plan with every scene of the gallery (one chapter per library group would be overkill). */
export const GALLERY_PLAN: VideoPlanInput = {
	version: 1,
	meta: { title: "Scene Library", level: "Middle school", style: "clean", fps: 30, width: 1920, height: 1080 },
	chapters: [{ id: "all", title: "All scene types", scenes: GALLERY_SCENES }],
};

/** A one-scene plan for one type (snapshot tests). */
export function galleryPlanFor(type: SceneType): VideoPlanInput {
	const scene = GALLERY_SCENES.find((s) => s.type === type);
	if (!scene) throw new Error(`no gallery scene for ${type}`);
	return { ...GALLERY_PLAN, chapters: [{ id: "c", title: "c", scenes: [scene] }] };
}
