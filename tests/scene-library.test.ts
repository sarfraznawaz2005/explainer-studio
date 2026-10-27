import { describe, expect, it } from "vitest";
import { parseMath } from "@shared/plan/math-expr";
import { SCENE_LABELS, SCENE_GROUPS, sceneName } from "@shared/plan/describe";
import { Scene, SCENE_TYPES, SvgProps, VideoPlan } from "@shared/plan/schema";
import { sanitizeSvg, type SvgNode } from "@shared/plan/svg";
import { texProblem } from "@shared/plan/tex";
import { computeTimeline, revealCount, timeScene } from "@shared/plan/timing";
import { GALLERY_PLAN, GALLERY_SCENES } from "../video/src/samples/gallery";

const ok = (svg: string) => {
	const r = sanitizeSvg(svg);
	if (!r.ok) throw new Error(r.problems.join("; "));
	return r;
};
const problems = (svg: string) => {
	const r = sanitizeSvg(svg);
	expect(r.ok, `should be rejected: ${svg}`).toBe(false);
	return r.ok ? [] : r.problems.join(" | ");
};
const wrap = (inner: string) => `<svg viewBox="0 0 100 100">${inner}</svg>`;

describe("scene library", () => {
	it("has a gallery scene, a label and a group for every type", () => {
		const types = new Set(GALLERY_SCENES.map((s) => s.type));
		for (const t of SCENE_TYPES) {
			expect(types.has(t), `gallery misses ${t}`).toBe(true);
			expect(SCENE_LABELS[t]).toBeTruthy();
		}
		expect(SCENE_GROUPS.flatMap((g) => g.types).sort()).toEqual([...SCENE_TYPES].sort());
		expect(SCENE_TYPES.length).toBe(37);
	});

	it("the gallery plan is valid and every scene has a name and timing", () => {
		const plan = VideoPlan.parse(GALLERY_PLAN);
		const t = computeTimeline(plan);
		expect(t.scenes).toHaveLength(SCENE_TYPES.length);
		for (const s of t.scenes) {
			expect(sceneName(s.scene).length, s.scene.type).toBeGreaterThan(0);
			expect(s.durationInFrames).toBeGreaterThan(30);
			// Every revealable item gets a cue.
			const targets = new Set(s.cues.filter((c) => c.action === "reveal" || c.action === "focus").map((c) => c.target));
			expect(targets.size, s.scene.type).toBe(revealCount(s.scene));
		}
	});

	it("pause and quiz scenes get silent thinking time", () => {
		const pause = Scene.parse(GALLERY_SCENES.find((s) => s.type === "pause"));
		const t = timeScene(pause, 30);
		expect(t.gaps).toHaveLength(1);
		expect(t.gaps[0]!.duration).toBe(4 * 30);
		// The answer sentence starts after the gap.
		expect(t.sentences[1]!.from).toBeGreaterThanOrEqual(t.gaps[0]!.from + t.gaps[0]!.duration);
		const noGap = timeScene({ ...pause, type: "bullets", props: { items: ["a"] } } as Scene, 30);
		expect(t.durationInFrames - noGap.durationInFrames).toBeGreaterThanOrEqual(4 * 30);

		const quiz = Scene.parse({ id: "q", type: "quiz", props: { questions: [{ question: "a?", options: ["x", "y"], answer: 1 }, { question: "b?", options: ["x", "y"], answer: 0 }], seconds: 2 }, narration: [{ id: "1", text: "First question." }, { id: "2", text: "Second question." }, { id: "3", text: "Done." }] });
		const tq = timeScene(quiz, 30);
		expect(tq.gaps.map((g) => g.target)).toEqual([0, 1]);
	});

	it("checks props per type (tree parents, quiz answers, trace indexes, table rows)", () => {
		const bad = [
			{ type: "tree", props: { nodes: [{ label: "a" }, { label: "b", parent: 1 }] } },
			{ type: "quiz", props: { questions: [{ question: "q", options: ["a", "b"], answer: 3 }] } },
			{ type: "trace", props: { array: [1, 2], steps: [{ pointers: [{ name: "i", index: 5 }] }] } },
			{ type: "table", props: { columns: ["a", "b"], rows: [["1", "2", "3"]] } },
			{ type: "dialogue", props: { characters: [{ name: "A", look: "kid" }], lines: [{ who: 1, text: "hi" }] } },
			{ type: "diagram", props: { labels: [{ text: "x", x: 1, y: 1 }] } },
			{ type: "figure", props: { figure: "../../secret.png" } },
			{ type: "graph", props: { functions: [{ expr: "x" }], x: [5, 1] } },
			{ type: "equation", props: { steps: [{ tex: "\\frac{1}{" }] } },
		];
		for (const b of bad) expect(Scene.safeParse({ id: "x", ...b }).success, b.type).toBe(false);
	});
});

describe("svg-custom sanitiser", () => {
	it("accepts the gallery drawings and keeps only allowed parts", () => {
		for (const s of GALLERY_SCENES) {
			const p = s.props as { svg?: string };
			if (p.svg) ok(p.svg);
		}
		const r = ok(wrap('<g id="a" transform="translate(5 5)"><rect width="10" height="10" fill="url(#g)" style="stroke: red; stroke-width: 2"/><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient><use href="#a"/><text x="1" y="2">Hi &amp; bye</text></g>'));
		const rect = (r.root.children[0] as SvgNode).children[0] as SvgNode;
		expect(rect.attrs).toMatchObject({ stroke: "red", "stroke-width": "2", fill: "url(#g)" });
		expect(r.ids).toEqual(["a", "g"]);
	});

	it("rejects scripts", () => {
		expect(problems(wrap("<script>alert(1)</script>"))).toMatch(/scripts are not allowed/);
		expect(problems(wrap("<SCRIPT>alert(1)</SCRIPT>"))).toMatch(/scripts are not allowed/);
		expect(problems(wrap('<script href="x.js"/>'))).toMatch(/scripts/);
		expect(problems(wrap('<foreignObject><div xmlns="http://www.w3.org/1999/xhtml">hi</div></foreignObject>'))).toMatch(/foreignObject/);
		expect(problems(wrap("<style>rect{fill:red}</style>"))).toMatch(/style/);
		expect(problems(wrap('<animate attributeName="href" to="javascript:alert(1)"/>'))).toMatch(/animation/);
		expect(problems(wrap('<set attributeName="onclick" to="alert(1)"/>'))).toMatch(/animation/);
		expect(problems('<!DOCTYPE svg [<!ENTITY x "y">]><svg viewBox="0 0 1 1"/>')).toMatch(/DOCTYPE/);
		expect(problems(wrap("<![CDATA[<script>]]>"))).toMatch(/CDATA/);
		expect(problems(wrap("<iframe/>"))).toMatch(/iframe/);
	});

	it("rejects event handlers", () => {
		expect(problems('<svg viewBox="0 0 1 1" onload="alert(1)"/>')).toMatch(/event handler onload/);
		expect(problems(wrap('<rect ONCLICK="alert(1)" width="1" height="1"/>'))).toMatch(/event handler/);
		expect(problems(wrap('<circle onmouseover = \'x()\' r="1"/>'))).toMatch(/event handler/);
		expect(problems(wrap('<g onfocusin="x()"/>'))).toMatch(/event handler/);
	});

	it("rejects external references", () => {
		expect(problems(wrap('<use href="https://evil.example/s.svg#x"/>'))).toMatch(/external reference/);
		expect(problems(wrap('<use xlink:href="other.svg#x"/>'))).toMatch(/external reference/);
		expect(problems(wrap('<image href="https://evil.example/a.png"/>'))).toMatch(/image/);
		expect(problems(wrap('<a href="https://evil.example"><rect width="1" height="1"/></a>'))).toMatch(/links/);
		expect(problems(wrap('<rect fill="url(https://evil.example/p.svg#g)" width="1" height="1"/>'))).toMatch(/external reference/);
		expect(problems(wrap('<rect style="fill:url(http://x/y)" width="1" height="1"/>'))).toMatch(/external reference/);
		expect(problems(wrap('<rect filter="url(data:image/svg+xml;base64,AAA)" width="1" height="1"/>'))).toMatch(/data URLs|external/);
		expect(problems(wrap('<path d="M0 0" fill="javascript:alert(1)"/>'))).toMatch(/script URLs/);
		expect(problems(wrap('<path d="M0 0" fill="jav&#x61;script:alert(1)"/>'))).toMatch(/script URLs/);
		expect(problems(wrap('<rect transform="url(#a)" width="1" height="1"/>'))).toMatch(/url\(\) is not allowed here/);
		expect(problems(wrap('<rect fill="url(#missing)" width="1" height="1"/>'))).toMatch(/points to no element/);
		expect(problems(wrap('<rect href="#a" width="1" height="1"/>'))).toMatch(/href on <rect>/);
		expect(problems(wrap('<feImage href="#a"/>'))).toMatch(/feImage/);
	});

	it("rejects malformed markup and unknown parts", () => {
		expect(problems("<div>hi</div>")).toMatch(/must start with <svg>|<div> is not allowed/);
		expect(problems(wrap("<rect width=1/>"))).toMatch(/quoted/);
		expect(problems(wrap("<g><rect/>"))).toMatch(/does not match an open tag/);
		expect(problems('<svg viewBox="0 0 1 1"><g>')).toMatch(/not closed/);
		expect(problems(wrap("<blink/>"))).toMatch(/<blink> is not allowed/);
		expect(problems(wrap('<rect data-x="1"/>'))).toMatch(/attribute data-x/);
		expect(problems("<svg/>")).toMatch(/viewBox/);
		expect(problems(wrap('<rect id="1bad"/>'))).toMatch(/id "1bad"/);
		expect(sanitizeSvg("x".repeat(40_000)).ok).toBe(false);
	});

	it("animations must target ids in the drawing", () => {
		const svg = wrap('<rect id="box" width="10" height="10"/>');
		expect(SvgProps.safeParse({ svg, animations: [{ target: "box", at: 0 }] }).success).toBe(true);
		expect(SvgProps.safeParse({ svg, animations: [{ target: "nope", at: 0 }] }).success).toBe(false);
	});
});

describe("graph formulas", () => {
	it("computes common formulas", () => {
		const f = (src: string, x: number) => {
			const r = parseMath(src);
			if (!r.ok) throw new Error(r.problem);
			return r.fn(x);
		};
		expect(f("2x^2 - 3x + 1", 2)).toBe(3);
		expect(f("y = sin(x)/x", Math.PI / 2)).toBeCloseTo(2 / Math.PI);
		expect(f("-x^2", 3)).toBe(-9);
		expect(f("2(x+1)", 1)).toBe(4);
		expect(f("e^(-x)", 0)).toBe(1);
		expect(f("sqrt(abs(x))", -16)).toBe(4);
		expect(f("pi x", 1)).toBeCloseTo(Math.PI);
		expect(f("f(x) = 3 · x", 2)).toBe(6);
	});

	it("refuses anything that is not maths (never evaluated as code)", () => {
		for (const src of ["alert(1)", "x; y", "constructor", "constructor(x)", "toString(x)", "hasOwnProperty(x)", "__proto__", "x.y", "this", "process.exit()", "(x", "sin x", "x +", "[1]", "`x`", "window"]) {
			expect(parseMath(src).ok, src).toBe(false);
		}
	});
});

describe("equation formulas (KaTeX)", () => {
	it("accepts normal maths and refuses unsafe commands", () => {
		expect(texProblem("\\frac{a}{b} + \\sqrt{x^2}")).toBeNull();
		expect(texProblem("6\\,CO_2 \\xrightarrow{h\\nu} C_6H_{12}O_6")).toBeNull();
		expect(texProblem("\\href{javascript:alert(1)}{x}")).toMatch(/not allowed/);
		expect(texProblem("\\url{https://x}")).toMatch(/not allowed/);
		expect(texProblem("\\includegraphics{a.png}")).toMatch(/not allowed/);
		expect(texProblem("\\htmlClass{x}{y}")).toMatch(/not allowed/);
		expect(texProblem("\\frac{1}{")).toBeTruthy();
		expect(texProblem("")).toBeTruthy();
	});
});
