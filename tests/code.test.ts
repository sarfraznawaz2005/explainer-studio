import { describe, expect, it } from "vitest";
import { CODE_IMPORTS, CODE_TYPES, compileCode, extractCode, isRtl, VideoCode } from "@shared/plan/code";
import { codeSceneAt, codeVideoData } from "@shared/plan/code-data";
import { VideoPlan } from "@shared/plan/schema";
import { computeTimeline } from "@shared/plan/timing";
import { plannerAiFromRunner } from "../src/main/planner/ai";
import { CODE_SYSTEM, codeCalls, codeHeader, codePrompt, writeVideoCode, type DrawFn } from "../src/main/planner/code";
import { loadVideoCode } from "../video/src/code/runtime";
import { SAMPLE_PLAN } from "../video/src/samples/web-page-journey";
import { CRASH_IN_SCENE_2, SAMPLE_CODE } from "../video/src/samples/code-samples";

const wrap = (body: string) => `${body}\nexport default function Video() { return null; }`;
const problems = (src: string) => {
	const r = compileCode(src);
	return r.ok ? [] : r.problems;
};

describe("AI video code: compile and scan", () => {
	it("compiles good TSX: imports become module lookups, the default export is kept", () => {
		const r = compileCode(SAMPLE_CODE);
		expect(r.ok, r.ok ? "" : r.problems.join("\n")).toBe(true);
		if (!r.ok) return;
		expect(r.js).toContain('= __modules["remotion"]');
		expect(r.js).toContain("__exports.default = Video;");
		expect(r.js).not.toMatch(/^\s*import /m);
		expect(r.js).toContain("__h(");
	});

	it.each([
		["fetch", 'const x = fetch("https://example.com");'],
		["eval", 'eval("1")'],
		["Function", 'const f = new Function("return 1");'],
		["window", "const w = window.location;"],
		["document", "document.title = 'x';"],
		["timers", "setTimeout(() => 1, 10);"],
		["the clock", "const now = Date.now();"],
		["Math.random", "const r = Math.random();"],
		["storage", "localStorage.setItem('a', 'b');"],
		["constructor", "const F = (() => 1).constructor;"],
		["constructor by string", "const F = (() => 1)['constructor'];"],
		["keys built from strings", "const k = 'constr'; const F = (() => 1)[k + 'uctor'];"],
		["__proto__", "const o = {}; o.__proto__ = null;"],
		["dynamic import", 'import("fs");'],
		["import.meta", "const u = import.meta.url;"],
		["an unknown module", 'import fs from "fs";'],
		["an unknown name", 'import { Audio } from "remotion";'],
		["iframes", "const x = <iframe src='https://example.com' />;"],
		["scripts", "const x = <script>{'1'}</script>;"],
		["links", "const x = <a href='https://example.com'>x</a>;"],
		["raw HTML", "const x = <div dangerouslySetInnerHTML={{ __html: '<img>' }} />;"],
		["new Image", "const i = new Image();"],
		["the runtime's own names", "const m = __modules;"],
	])("refuses %s", (_, body) => {
		expect(problems(wrap(body)).length).toBeGreaterThan(0);
	});

	it("allows normal code: own names like top and parent, number indexes, maps and loops", () => {
		const src = wrap(`
			const top = 40; const parent = { name: "x" }; const list = [1, 2, 3];
			let sum = 0; for (let i = 0; i < list.length; i++) sum += list[i + 0];
			const o = { a: 1 }; const key = "a"; const v = o[key];
			const style = { position: "absolute", top };`);
		expect(problems(src)).toEqual([]);
	});

	it("names the line of a syntax error and needs one default export", () => {
		expect(problems("const x = ;\nexport default function Video() { return null; }")[0]).toMatch(/Syntax error/);
		expect(problems("export function Video() { return null; }")[0]).toMatch(/export default/);
	});

	it("takes the code out of a model reply", () => {
		expect(extractCode("Here it is:\n```tsx\nexport default 1;\n```\nEnjoy")).toBe("export default 1;");
		expect(extractCode("export default 2;")).toBe("export default 2;");
		expect(VideoCode.parse({ source: "x", name: 5 }).name).toBe("AI design");
	});

	it("lists the allowed names in each module", () => {
		expect(CODE_IMPORTS.remotion).toContain("useCurrentFrame");
		expect(CODE_IMPORTS.remotion).not.toContain("Audio");
		expect(CODE_IMPORTS.react).not.toContain("useEffect");
	});
});

describe("AI video code: running", () => {
	it("loads the sample into a component", () => {
		const r = loadVideoCode(SAMPLE_CODE);
		expect(r.ok, r.ok ? "" : r.problems.join("\n")).toBe(true);
		expect(loadVideoCode(CRASH_IN_SCENE_2).ok).toBe(true);
	});

	it("hides the page globals from the code (they are undefined inside)", () => {
		const r = loadVideoCode('const seen = [typeof self, typeof location, typeof parent, typeof top, typeof opener].join(",");\nexport default function Video() { return seen; }');
		expect(r.ok).toBe(true);
		if (r.ok) expect((r.Video as unknown as () => string)()).toBe("undefined,undefined,undefined,undefined,undefined");
	});

	it("stops an endless loop instead of hanging", () => {
		const r = loadVideoCode("let n = 0;\nwhile (true) n++;\nexport default function Video() { return null; }");
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.problems[0]).toMatch(/loop ran too long/);
	});

	it("reports a code error as problems, never throws", () => {
		const r = loadVideoCode('const x = (null as any).y;\nexport default function Video() { return null; }');
		expect(r.ok).toBe(false);
	});
});

describe("AI video code: the data it gets", () => {
	it("has every scene with frames, props, sentences and cues", () => {
		const plan = VideoPlan.parse(SAMPLE_PLAN);
		const t = computeTimeline(plan);
		const v = codeVideoData(plan, t);
		expect(v.scenes).toHaveLength(t.scenes.length);
		expect(v.scenes[1]).toMatchObject({ index: 1, from: t.scenes[1]!.from, type: t.scenes[1]!.scene.type });
		expect(v.scenes[0]!.sentences[0]!.text).toBe(t.scenes[0]!.sentences[0]!.text);
		expect(codeSceneAt(v, t.scenes[2]!.from + 1)?.index).toBe(2);
		expect(JSON.parse(JSON.stringify(v))).toEqual(v);
		expect(isRtl("ur")).toBe(true);
		expect(isRtl("en")).toBe(false);
	});

	it("is stored in the plan", () => {
		const plan = VideoPlan.parse({ ...SAMPLE_PLAN, meta: { ...SAMPLE_PLAN.meta, style: "code", code: { name: "Neon pulse", idea: "x", source: SAMPLE_CODE } } });
		expect(plan.meta.code?.name).toBe("Neon pulse");
	});
});

describe("AI video code: writing, checking and fixing", () => {
	const plan = VideoPlan.parse(SAMPLE_PLAN);
	const brief = { title: "Web pages", level: "High school", tone: "Friendly", language: "en", wish: "like a comic book" };
	const fence = (src: string) => "```tsx\n// name: Comic panels\n// idea: Every scene is a comic panel.\n" + src + "\n```";
	const fakeAi = (replies: { text: string; cutOff?: boolean }[]) => {
		const seen: { system: string; messages: { role: string; content: string }[] }[] = [];
		const ai = plannerAiFromRunner((slot, purpose) => async (req) => {
			expect([slot, purpose]).toEqual(["planner", "plan.code"]);
			seen.push({ system: req.system, messages: req.messages.map((m) => ({ role: m.role, content: String(m.content) })) });
			const r = replies[seen.length - 1] ?? replies.at(-1)!;
			return { text: r.text, cutOff: r.cutOff, usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 } };
		});
		return { ai, seen };
	};
	const clean: DrawFn = async () => ({ errors: [], warnings: [], frames: 30 });

	it("tells the AI only the contract, the user's wish and the data", () => {
		const p = codePrompt(brief, plan);
		expect(p).toMatch(/like a comic book/);
		expect(p).toContain(JSON.stringify(codeVideoData(plan, computeTimeline(plan))).slice(0, 200));
		expect(CODE_SYSTEM).toContain("export default function Video");
		expect(CODE_SYSTEM).toContain(CODE_TYPES);
		for (const name of CODE_IMPORTS.studio) expect(CODE_SYSTEM).toContain(name);
		// No house style in the instructions.
		expect(CODE_SYSTEM).not.toMatch(/\b(pastel|minimal|flat design|corporate)\b/i);
		expect(codePrompt({ ...brief, wish: undefined }, plan)).toMatch(/no wishes/);
	});

	it("takes good code at once, with its name and idea", async () => {
		const { ai, seen } = fakeAi([{ text: fence(SAMPLE_CODE) }]);
		const code = await writeVideoCode(ai, brief, plan, clean);
		expect(code).toMatchObject({ name: "Comic panels", idea: "Every scene is a comic panel." });
		expect(seen).toHaveLength(1);
	});

	it("sends scan problems and test-draw errors back, and takes the fixed file", async () => {
		const draws: VideoPlan[] = [];
		const draw: DrawFn = async (p) => {
			draws.push(p);
			return draws.length === 1 ? { errors: [{ frame: 40, scene: 1, message: "boom" }], warnings: [], frames: 3 } : { errors: [], warnings: [], frames: 30 };
		};
		const bad = SAMPLE_CODE.replace("const top = 40;", "const top = 40; fetch('x');");
		const steps: string[] = [];
		const { ai, seen } = fakeAi([{ text: fence(bad) }, { text: fence(SAMPLE_CODE) }, { text: fence(SAMPLE_CODE) }]);
		const code = await writeVideoCode(ai, brief, plan, draw, (step, attempt) => steps.push(`${step}${attempt}`));
		expect(code.source).toContain("const top = 40;");
		expect(seen).toHaveLength(3);
		expect(seen[1]!.messages.at(-1)!.content).toMatch(/"fetch" is not allowed/);
		expect(seen[2]!.messages.at(-1)!.content).toMatch(/Frame 40 \(scene 2, type ".+"\): boom/);
		expect(draws[0]!.meta).toMatchObject({ style: "code", code: { name: "Comic panels" } });
		expect(steps).toEqual(["checking1", "fixing2", "checking2", "fixing3", "checking3"]);
	});

	it("sends warnings back once, then lets them pass", async () => {
		const draw: DrawFn = async () => ({ errors: [], warnings: [{ frame: 9, scene: 0, message: "Text goes outside" }], frames: 30 });
		const { ai, seen } = fakeAi([{ text: fence(SAMPLE_CODE) }]);
		await writeVideoCode(ai, brief, plan, draw);
		expect(seen).toHaveLength(2);
		expect(seen[1]!.messages.at(-1)!.content).toMatch(/Text goes outside/);
	});

	it("asks for a shorter file when the reply was cut off, and gives up after the last fix", async () => {
		const { ai, seen } = fakeAi([{ text: fence(SAMPLE_CODE.slice(0, 300)), cutOff: true }]);
		await expect(writeVideoCode(ai, brief, plan, clean)).rejects.toThrow(/after 4 tries/);
		expect(seen).toHaveLength(4);
		expect(seen[1]!.messages.at(-1)!.content).toMatch(/cut off/);
	});

	it("takes compiled code when the test draw cannot run", async () => {
		const { ai } = fakeAi([{ text: fence(SAMPLE_CODE) }]);
		const code = await writeVideoCode(ai, brief, plan, async () => Promise.reject(new Error("no window")));
		expect(code.name).toBe("Comic panels");
	});

	it("reads the name and idea lines and estimates repair rounds as extra", () => {
		expect(codeHeader("// name: Neon city\n// idea: Bright signs.\nexport default 1")).toEqual({ name: "Neon city", idea: "Bright signs." });
		expect(codeHeader("export default 1").name).toBe("AI design");
		const calls = codeCalls(brief, plan);
		expect(calls[0]!.extra).toBeFalsy();
		expect(calls.slice(1).every((c) => c.extra)).toBe(true);
		expect(calls).toHaveLength(4);
		expect(codeCalls(brief, null, 20)[0]!.input).toBeGreaterThan(5000);
	});
});
