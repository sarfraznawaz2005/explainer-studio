import { z } from "zod";
import { MATH_MAX_CHARS, parseMath } from "./math-expr";
import { sanitizeSvg, SVG_MAX_CHARS } from "./svg";
import { TEX_MAX_CHARS, texProblem } from "./tex";

/**
 * Props of every scene type (PLAN.md section 8). Each type has its own zod
 * schema; limits keep every screen readable. Pure data: drawings, formulas and
 * graph functions are checked here and are never executed.
 */

const text = (max: number) => z.string().trim().min(1).max(max);
const Point = text(200);
const Heading = z.string().max(120).optional();
/** A position on a picture, in percent of its width and height. */
const Pct = z.number().min(0).max(100);
/** A figure saved from the source material ("in1-003.png"), in the draft's source/figures folder. */
export const FigureFile = z.string().regex(/^[a-z0-9]{1,12}-\d{3,4}\.(png|jpe?g|webp|gif)$/, "a figure file name from the source, such as in1-003.png");
const Color = z.string().regex(/^#[0-9a-fA-F]{3,8}$/, "a hex colour such as #ff8800");

/** Drawing markup for svg-custom and labelled diagrams, checked by the allowlist sanitiser. */
export const SvgMarkup = z
	.string()
	.min(1)
	.max(SVG_MAX_CHARS)
	.superRefine((v, ctx) => {
		const r = sanitizeSvg(v);
		if (!r.ok) for (const p of r.problems) ctx.addIssue({ code: "custom", message: `SVG: ${p}` });
	});
export const Tex = z
	.string()
	.min(1)
	.max(TEX_MAX_CHARS)
	.superRefine((v, ctx) => {
		const p = texProblem(v);
		if (p) ctx.addIssue({ code: "custom", message: `TeX: ${p}` });
	});
export const MathExpr = z
	.string()
	.min(1)
	.max(MATH_MAX_CHARS)
	.superRefine((v, ctx) => {
		const r = parseMath(v);
		if (!r.ok) ctx.addIssue({ code: "custom", message: `formula: ${r.problem}` });
	});

/* ---------- Text and structure ---------- */

export const TitleProps = z.object({ title: text(120), subtitle: z.string().max(200).optional(), kicker: z.string().max(60).optional() });
export const ChapterProps = z.object({ number: z.number().int().min(1).max(99), title: text(120), goal: z.string().max(200).optional() });
export const KineticProps = z.object({
	/** Short lines that land one by one. */
	lines: z.array(text(80)).min(1).max(6),
	/** Words drawn in the accent colour. */
	emphasis: z.array(z.string().min(1).max(40)).max(8).default([]),
	/** stack: lines pile up; punch: one big line at a time. */
	mode: z.enum(["stack", "punch"]).default("stack"),
});
export const BulletsProps = z.object({ heading: Heading, items: z.array(Point).min(1).max(8) });
export const DefinitionProps = z.object({
	term: text(80),
	partOfSpeech: z.string().max(30).optional(),
	definition: text(400),
	example: z.string().max(300).optional(),
});
export const QuoteProps = z.object({ text: text(320), author: z.string().max(80).optional(), source: z.string().max(120).optional() });
export const SummaryProps = z.object({ heading: Heading, items: z.array(text(140)).min(1).max(8) });
export const GlossaryProps = z.object({ heading: Heading, terms: z.array(z.object({ term: text(60), meaning: text(200) })).min(1).max(6) });

/* ---------- Diagrams ---------- */

export const FlowProps = z.object({
	heading: Heading,
	direction: z.enum(["horizontal", "vertical"]).default("horizontal"),
	steps: z.array(z.object({ label: text(60), detail: z.string().max(140).optional() })).min(2).max(7),
});
export const CycleProps = z.object({
	heading: Heading,
	/** Written in the middle of the circle. */
	center: z.string().max(40).optional(),
	steps: z.array(z.object({ label: text(40), detail: z.string().max(100).optional() })).min(3).max(8),
});
export const TreeProps = z
	.object({
		heading: Heading,
		/** Node 0 is the root. Every other node names an earlier node as its parent. */
		nodes: z.array(z.object({ label: text(40), parent: z.number().int().min(0).max(14).optional() })).min(2).max(15),
	})
	.superRefine((p, ctx) =>
		p.nodes.forEach((n, i) => {
			if (i === 0 && n.parent !== undefined) ctx.addIssue({ code: "custom", path: ["nodes", 0, "parent"], message: "node 0 is the root and has no parent" });
			if (i > 0 && (n.parent === undefined || n.parent >= i)) ctx.addIssue({ code: "custom", path: ["nodes", i, "parent"], message: `node ${i} needs a parent before it (0 to ${i - 1})` });
		}),
	);
export const MindmapProps = z.object({
	center: text(60),
	branches: z.array(z.object({ label: text(40), children: z.array(text(40)).max(4).default([]) })).min(2).max(8),
});
export const DiagramLabels = z.array(z.object({ text: text(60), x: Pct, y: Pct, detail: z.string().max(120).optional() })).min(1).max(8);
export const DiagramProps = z
	.object({
		heading: Heading,
		/** The picture: a figure from the source, or a drawing. */
		figure: FigureFile.optional(),
		svg: SvgMarkup.optional(),
		labels: DiagramLabels,
	})
	.refine((p) => !!p.figure !== !!p.svg, { message: "give either figure or svg (one of them)", path: ["svg"] });
export const VennProps = z.object({
	heading: Heading,
	sets: z.array(z.object({ label: text(40), items: z.array(text(40)).max(4).default([]) })).min(2).max(3),
	/** What all the sets share (the middle). */
	overlap: z.array(text(40)).max(4).default([]),
	overlapLabel: z.string().max(40).optional(),
});
const Side = z.object({ title: text(60), points: z.array(Point).min(1).max(6) });
export const CompareProps = z.object({ heading: Heading, left: Side, right: Side, verdict: z.string().max(200).optional() });
export const ProsConsProps = z.object({
	heading: Heading,
	pros: z.array(text(120)).min(1).max(6),
	cons: z.array(text(120)).min(1).max(6),
	verdict: z.string().max(200).optional(),
});

/* ---------- Data and maths ---------- */

export const ChartProps = z.object({
	heading: Heading,
	kind: z.enum(["bar", "line", "pie"]).default("bar"),
	unit: z.string().max(20).optional(),
	data: z.array(z.object({ label: text(30), value: z.number() })).min(2).max(12),
	/** Index of a bar/point/slice to call out. */
	highlight: z.number().int().min(0).optional(),
});
export const CounterProps = z.object({
	heading: Heading,
	counters: z
		.array(
			z.object({
				value: z.number(),
				from: z.number().default(0),
				label: text(80),
				prefix: z.string().max(4).optional(),
				unit: z.string().max(12).optional(),
				decimals: z.number().int().min(0).max(3).default(0),
			}),
		)
		.min(1)
		.max(4),
});
export const EquationProps = z.object({
	heading: Heading,
	/** One line of the derivation per step (KaTeX), each with an optional note. */
	steps: z.array(z.object({ tex: Tex, note: z.string().max(140).optional() })).min(1).max(8),
});
export const GraphProps = z
	.object({
		heading: Heading,
		functions: z.array(z.object({ expr: MathExpr, label: z.string().max(40).optional() })).min(1).max(3),
		x: z.tuple([z.number(), z.number()]).default([-5, 5]),
		/** Leave out to fit the curves. */
		y: z.tuple([z.number(), z.number()]).optional(),
		points: z.array(z.object({ x: z.number(), fn: z.number().int().min(0).max(2).default(0), label: z.string().max(30).optional() })).max(6).default([]),
		/** A dot that runs along the last curve. */
		tracer: z.boolean().default(true),
		xLabel: z.string().max(20).optional(),
		yLabel: z.string().max(20).optional(),
	})
	.superRefine((p, ctx) => {
		if (!(p.x[1] > p.x[0])) ctx.addIssue({ code: "custom", path: ["x"], message: "x range must go from small to large" });
		if (p.y && !(p.y[1] > p.y[0])) ctx.addIssue({ code: "custom", path: ["y"], message: "y range must go from small to large" });
		p.points.forEach((pt, i) => {
			if (pt.fn >= p.functions.length) ctx.addIssue({ code: "custom", path: ["points", i, "fn"], message: "no such function" });
		});
	});

/* ---------- Technical ---------- */

export const CodeProps = z.object({
	heading: Heading,
	language: z.enum(["python", "javascript", "typescript", "java", "c", "cpp", "csharp", "sql", "text"]).default("text"),
	code: z.string().min(1).max(4000),
	/** Walkthrough steps. Each focuses a line range (1-based, inclusive) and may show a note. */
	steps: z
		.array(z.object({ lines: z.tuple([z.number().int().min(1), z.number().int().min(1)]), note: z.string().max(200).optional() }))
		.max(12)
		.default([]),
});
const Cell = z.union([z.number(), z.string().max(6)]);
const Idx = z.number().int().min(0).max(11);
export const TraceProps = z
	.object({
		heading: Heading,
		array: z.array(Cell).min(2).max(12),
		/** One state per step; the array changes by swap and set, step after step. */
		steps: z
			.array(
				z.object({
					pointers: z.array(z.object({ name: z.string().trim().min(1).max(8), index: Idx })).max(3).default([]),
					/** Cells still in play; the rest are dimmed. */
					range: z.tuple([Idx, Idx]).optional(),
					compare: z.tuple([Idx, Idx]).optional(),
					swap: z.tuple([Idx, Idx]).optional(),
					set: z.object({ index: Idx, value: Cell }).optional(),
					/** Cells in their final place. */
					done: z.array(Idx).max(12).default([]),
					found: Idx.optional(),
					note: z.string().max(140).optional(),
				}),
			)
			.min(1)
			.max(24),
	})
	.superRefine((p, ctx) => {
		const n = p.array.length;
		p.steps.forEach((st, i) => {
			const idx = [...st.pointers.map((q) => q.index), ...(st.range ?? []), ...(st.compare ?? []), ...(st.swap ?? []), ...st.done, st.set?.index, st.found].filter((v) => v !== undefined) as number[];
			if (idx.some((v) => v >= n)) ctx.addIssue({ code: "custom", path: ["steps", i], message: `an index is past the end of the array (0 to ${n - 1})` });
		});
	});
export const TableProps = z
	.object({
		heading: Heading,
		columns: z.array(text(40)).min(2).max(6),
		rows: z.array(z.array(z.string().max(60))).min(1).max(8),
		highlight: z.object({ row: z.number().int().min(0), col: z.number().int().min(0).optional() }).optional(),
	})
	.superRefine((p, ctx) =>
		p.rows.forEach((r, i) => {
			if (r.length > p.columns.length) ctx.addIssue({ code: "custom", path: ["rows", i], message: `row has ${r.length} cells, the table has ${p.columns.length} columns` });
		}),
	);

/* ---------- Story and world ---------- */

export const TimelineProps = z.object({
	heading: Heading,
	events: z.array(z.object({ date: text(30), label: text(60), detail: z.string().max(140).optional() })).min(2).max(8),
});
export const MAP_VIEWS = ["world", "europe", "asia", "africa", "north-america", "south-america", "oceania", "middle-east", "south-asia"] as const;
export const MapProps = z.object({
	heading: Heading,
	view: z.enum(MAP_VIEWS).default("world"),
	pins: z.array(z.object({ label: text(40), lat: z.number().min(-85).max(85), lon: z.number().min(-180).max(180), detail: z.string().max(100).optional() })).min(1).max(8),
	/** Join the pins in order, like a journey. */
	route: z.boolean().default(false),
});
export const AnalogyProps = z.object({
	heading: Heading,
	/** The idea being taught, and the everyday thing it is like. */
	idea: text(40),
	like: text(40),
	pairs: z.array(z.object({ idea: text(80), like: text(80) })).min(1).max(5),
	/** Where the analogy stops working. */
	limit: z.string().max(160).optional(),
});
export const CHARACTER_LOOKS = ["kid", "kid2", "teacher", "scientist", "robot", "cat", "owl"] as const;
export const DialogueProps = z
	.object({
		setting: z.string().max(60).optional(),
		characters: z.array(z.object({ name: text(24), look: z.enum(CHARACTER_LOOKS) })).min(1).max(2),
		lines: z.array(z.object({ who: z.number().int().min(0).max(1), text: text(140) })).min(1).max(10),
	})
	.superRefine((p, ctx) =>
		p.lines.forEach((l, i) => {
			if (l.who >= p.characters.length) ctx.addIssue({ code: "custom", path: ["lines", i, "who"], message: `only ${p.characters.length} character(s)` });
		}),
	);
export const FigureProps = z.object({
	figure: FigureFile,
	caption: z.string().max(160).optional(),
	callouts: z.array(z.object({ x: Pct, y: Pct, text: text(60) })).max(5).default([]),
	/** Where the slow zoom ends (percent), and how far it zooms. */
	focus: z.object({ x: Pct, y: Pct, zoom: z.number().min(1).max(3).default(1.3) }).optional(),
});

/* ---------- Engagement ---------- */

export const PauseProps = z.object({
	question: text(200),
	answer: text(300),
	/** Thinking time, in silence, after the question is asked. */
	seconds: z.number().int().min(3).max(15).default(5),
	hint: z.string().max(140).optional(),
});
export const QuizProps = z
	.object({
		heading: Heading,
		questions: z.array(z.object({ question: text(160), options: z.array(text(80)).min(2).max(4), answer: z.number().int().min(0).max(3), explain: z.string().max(160).optional() })).min(1).max(4),
		/** Thinking time per question. */
		seconds: z.number().int().min(2).max(10).default(4),
	})
	.superRefine((p, ctx) =>
		p.questions.forEach((q, i) => {
			if (q.answer >= q.options.length) ctx.addIssue({ code: "custom", path: ["questions", i, "answer"], message: `answer must be 0 to ${q.options.length - 1}` });
		}),
	);

/* ---------- Custom drawing ---------- */

const AnimState = z.object({
	opacity: z.number().min(0).max(1).optional(),
	x: z.number().min(-4000).max(4000).optional(),
	y: z.number().min(-4000).max(4000).optional(),
	scale: z.number().min(0).max(20).optional(),
	rotate: z.number().min(-1440).max(1440).optional(),
	/** 0 = stroke not drawn, 1 = fully drawn. */
	draw: z.number().min(0).max(1).optional(),
	fill: Color.optional(),
});
export type AnimState = z.infer<typeof AnimState>;
export const SvgAnimation = z.object({
	/** id of an element in the drawing. */
	target: z.string().regex(/^[A-Za-z][\w-]{0,40}$/),
	/** Narration sentence the animation starts on. */
	at: z.number().int().min(0),
	edge: z.enum(["start", "end"]).default("start"),
	offsetMs: z.number().int().min(-5000).max(10_000).default(0),
	durationMs: z.number().int().min(0).max(10_000).default(600),
	from: AnimState.default({}),
	to: AnimState.default({}),
	ease: z.enum(["ease", "linear", "spring"]).default("ease"),
});
export type SvgAnimation = z.infer<typeof SvgAnimation>;
export const SvgProps = z
	.object({
		heading: Heading,
		svg: SvgMarkup,
		animations: z.array(SvgAnimation).max(40).default([]),
		caption: z.string().max(160).optional(),
	})
	.superRefine((p, ctx) => {
		const r = sanitizeSvg(p.svg);
		if (!r.ok) return;
		p.animations.forEach((a, i) => {
			if (!r.ids.includes(a.target)) ctx.addIssue({ code: "custom", path: ["animations", i, "target"], message: `no element with id "${a.target}" in the drawing` });
		});
	});

/** Every scene type and its props, in library order (the order the Studio lists them). */
export const SCENE_PROPS = {
	title: TitleProps,
	chapter: ChapterProps,
	kinetic: KineticProps,
	bullets: BulletsProps,
	definition: DefinitionProps,
	quote: QuoteProps,
	summary: SummaryProps,
	glossary: GlossaryProps,
	flow: FlowProps,
	cycle: CycleProps,
	tree: TreeProps,
	mindmap: MindmapProps,
	diagram: DiagramProps,
	venn: VennProps,
	compare: CompareProps,
	proscons: ProsConsProps,
	chart: ChartProps,
	counter: CounterProps,
	equation: EquationProps,
	graph: GraphProps,
	code: CodeProps,
	trace: TraceProps,
	table: TableProps,
	timeline: TimelineProps,
	map: MapProps,
	analogy: AnalogyProps,
	dialogue: DialogueProps,
	figure: FigureProps,
	pause: PauseProps,
	quiz: QuizProps,
	svg: SvgProps,
} as const;
