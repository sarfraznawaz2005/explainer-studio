import type { Scene, SceneType } from "./schema";

/** Human names for scene types, used in the Studio and by the planner prompt. */
export const SCENE_LABELS: Record<SceneType, string> = {
	title: "Title card",
	chapter: "Chapter card",
	kinetic: "Kinetic text",
	bullets: "Bullet reveal",
	definition: "Definition",
	quote: "Quote",
	summary: "Summary checklist",
	glossary: "Key-term glossary",
	flow: "Process flow",
	cycle: "Cycle",
	tree: "Hierarchy tree",
	mindmap: "Mind map",
	diagram: "Labelled diagram",
	venn: "Venn diagram",
	compare: "Compare two",
	proscons: "Pros and cons",
	chart: "Chart",
	counter: "Number counter",
	equation: "Equation steps",
	graph: "Graph plot",
	code: "Code walkthrough",
	trace: "Algorithm trace",
	table: "Table build-up",
	timeline: "Timeline",
	map: "Map with pins",
	analogy: "Analogy split",
	dialogue: "Character dialogue",
	figure: "Source figure",
	pause: "Pause and think",
	quiz: "Recap quiz",
	svg: "Custom drawing",
};

/** Library groups (PLAN.md section 8), for menus. */
export const SCENE_GROUPS: { name: string; types: SceneType[] }[] = [
	{ name: "Text and structure", types: ["title", "chapter", "kinetic", "bullets", "definition", "quote", "summary", "glossary"] },
	{ name: "Diagrams", types: ["flow", "cycle", "tree", "mindmap", "diagram", "venn", "compare", "proscons"] },
	{ name: "Data and maths", types: ["chart", "counter", "equation", "graph"] },
	{ name: "Technical", types: ["code", "trace", "table"] },
	{ name: "Story and world", types: ["timeline", "map", "analogy", "dialogue", "figure"] },
	{ name: "Engagement", types: ["pause", "quiz"] },
	{ name: "Custom", types: ["svg"] },
];

const first = (...v: (string | undefined)[]) => v.find((x) => x && x.trim()) ?? "";

/** A short name for one scene, taken from its content. */
export function sceneName(scene: Scene): string {
	const p = scene.props as { heading?: string };
	switch (scene.type) {
		case "title":
			return scene.props.title;
		case "chapter":
			return `Chapter ${scene.props.number}: ${scene.props.title}`;
		case "kinetic":
			return scene.props.lines.join(" ");
		case "bullets":
		case "summary":
			return first(p.heading, scene.props.items[0]);
		case "definition":
			return scene.props.term;
		case "quote":
			return first(scene.props.author ? `Quote: ${scene.props.author}` : undefined, scene.props.text);
		case "glossary":
			return first(p.heading, scene.props.terms.map((t) => t.term).join(", "));
		case "flow":
		case "cycle":
			return first(p.heading, scene.props.steps.map((s) => s.label).join(" → "));
		case "tree":
			return first(p.heading, scene.props.nodes[0]!.label);
		case "mindmap":
			return scene.props.center;
		case "diagram":
			return first(p.heading, scene.props.labels.map((l) => l.text).join(", "));
		case "venn":
			return first(p.heading, scene.props.sets.map((s) => s.label).join(" ∩ "));
		case "compare":
			return first(p.heading, `${scene.props.left.title} vs ${scene.props.right.title}`);
		case "proscons":
			return first(p.heading, "Pros and cons");
		case "chart":
			return first(p.heading, "Chart");
		case "counter":
			return first(p.heading, scene.props.counters[0]!.label);
		case "equation":
			return first(p.heading, scene.props.steps[0]!.tex);
		case "graph":
			return first(p.heading, `y = ${scene.props.functions[0]!.expr}`);
		case "code":
			return first(p.heading, `${scene.props.language} code`);
		case "trace":
			return first(p.heading, `Trace of [${scene.props.array.join(", ")}]`);
		case "table":
			return first(p.heading, scene.props.columns.join(" · "));
		case "timeline":
			return first(p.heading, `${scene.props.events[0]!.date} – ${scene.props.events.at(-1)!.date}`);
		case "map":
			return first(p.heading, scene.props.pins.map((x) => x.label).join(", "));
		case "analogy":
			return first(p.heading, `${scene.props.idea} is like ${scene.props.like}`);
		case "dialogue":
			return first(scene.props.setting, scene.props.characters.map((c) => c.name).join(" and "));
		case "figure":
			return first(scene.props.caption, scene.props.figure);
		case "pause":
			return scene.props.question;
		case "quiz":
			return first(p.heading, "Quiz");
		case "svg":
			return first(p.heading, scene.props.caption, "Custom drawing");
	}
}
