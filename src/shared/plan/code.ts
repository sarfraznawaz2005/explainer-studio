import { parse, type Node } from "acorn";
import { transform } from "sucrase";
import { z } from "zod";

/**
 * "AI free-form" style: the AI writes the whole video picture as one React
 * component (TSX). This file is the gate every piece of AI code goes through
 * before it runs anywhere:
 *  1. compile: TSX to plain JS (sucrase); a syntax error names the line;
 *  2. scan: the JS is read as a tree (acorn) and anything that could reach
 *     outside the picture is refused (network, storage, timers, eval, DOM...);
 *     only the modules and names in CODE_IMPORTS can be imported;
 *  3. loop guards are added, so an endless loop throws instead of hanging.
 * The result still runs only inside a sandbox (see video/src/code/runtime.ts):
 * the scan is a second wall, not the only one.
 */

/** The AI's code for one video. */
export const VideoCode = z.object({
	/** A short name for the design, for the Studio ("Chalk on slate"). */
	name: z.string().trim().max(60).catch("AI design"),
	/** One sentence: the idea behind the design. */
	idea: z.string().trim().max(300).catch(""),
	/** The TSX source: one file with `export default function Video({ video })`. */
	source: z.string().min(1).max(200_000),
});
export type VideoCode = z.infer<typeof VideoCode>;

/**
 * Quick changes to an AI design that need no AI call: the design reads them
 * from video.tweaks (the prompt asks it to), and the Studio sets them.
 */
export const CodeTweaks = z.object({
	/** The main accent colour, or none to keep the design's own. */
	accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
	/** Text size, times the design's own (0.85 to 1.15). */
	text: z.number().min(0.85).max(1.15).default(1),
	/** Margins and gaps, times the design's own. */
	space: z.number().min(0.8).max(1.25).default(1),
	/** Motion speed: entrances and other animations run this much faster. */
	speed: z.number().min(0.5).max(2).default(1),
});
export type CodeTweaks = z.infer<typeof CodeTweaks>;
export const NO_TWEAKS: CodeTweaks = { text: 1, space: 1, speed: 1 };
/** True when the design's code reads the tweaks (older designs do not). */
export const usesTweaks = (source: string) => /\btweaks\b/.test(source);

/** What the AI's code may import, by module, and the names in each. */
export const CODE_IMPORTS = {
	react: ["Fragment", "useMemo", "useCallback", "useRef", "useContext", "createContext", "memo", "Children", "cloneElement", "isValidElement", "useId"],
	remotion: ["AbsoluteFill", "Sequence", "Series", "Loop", "Freeze", "Img", "useCurrentFrame", "useVideoConfig", "interpolate", "interpolateColors", "spring", "measureSpring", "Easing", "random"],
	studio: ["fonts", "figureUrl", "Tex", "sceneAt", "fitFontSize"],
} as const satisfies Record<string, readonly string[]>;
export type CodeModule = keyof typeof CODE_IMPORTS;

/** Global names the code may never use: they reach the network, storage, the page, the clock or other code. */
const BANNED_NAMES = new Set([
	"eval",
	"Function",
	"globalThis",
	"window",
	"document",
	"fetch",
	"XMLHttpRequest",
	"WebSocket",
	"EventSource",
	"importScripts",
	"Worker",
	"SharedWorker",
	"ServiceWorker",
	"navigator",
	"localStorage",
	"sessionStorage",
	"indexedDB",
	"caches",
	"cookieStore",
	"require",
	"process",
	"module",
	"setTimeout",
	"setInterval",
	"setImmediate",
	"requestAnimationFrame",
	"requestIdleCallback",
	"queueMicrotask",
	"Date",
	"performance",
	"Proxy",
	"Reflect",
	"WebAssembly",
	"Atomics",
	"SharedArrayBuffer",
	"postMessage",
	"Image",
	"Audio",
	"Notification",
	"BroadcastChannel",
	"MessageChannel",
	"crypto",
	"__modules",
	"__exports",
	"__loop",
]);

/** Property names that lead to other code or to the object system's internals. */
const BANNED_PROPS = new Set(["constructor", "prototype", "__proto__", "__defineGetter__", "__defineSetter__", "__lookupGetter__", "__lookupSetter__", "dangerouslySetInnerHTML", "innerHTML", "outerHTML", "ownerDocument", "defaultView", "contentWindow"]);

/** HTML tags that load other pages or code, or play media of their own. */
const BANNED_TAGS = new Set(["script", "iframe", "frame", "frameset", "object", "embed", "link", "meta", "base", "form", "a", "video", "audio", "source", "track", "portal", "foreignObject", "style"]);

/** SVG tags that animate on the wall clock, not on the frame number. */
const CLOCK_TAGS = new Set(["animate", "animateTransform", "animateMotion", "animateColor", "set"]);

/** React hooks that keep state between draws: the picture would depend on what was drawn before. */
const STATE_HOOKS = new Map(["useState", "useReducer"].map((h) => [h, `${h} keeps state between frames, so a frame would depend on the frames drawn before it. Fix: work out every value from useCurrentFrame() and the data (useMemo for heavy work).`]));

/** CSS properties that run on the wall clock. Always wrong in a frame-by-frame render. */
const CLOCK_CSS = new Set(["transitionProperty", "transitionDuration", "transitionDelay", "transitionTimingFunction", "transitionBehavior", "animationName", "animationDuration", "animationDelay", "animationIterationCount", "animationTimingFunction", "animationDirection", "animationFillMode", "animationPlayState", "animationComposition", "animationTimeline"]);
/** "transition" and "animation" are common words too: refused only when the value looks like CSS timing. */
const CLOCK_CSS_SHORT = new Set(["transition", "animation"]);
const CSS_TIMING = /\d(?:\.\d+)?m?s\b|\binfinite\b/;
const CLOCK_CSS_FIX = "CSS transitions and animations run on the clock, not on the frame, so the render would not match the preview. Fix: animate with interpolate() or spring() on useCurrentFrame().";

/**
 * Globals that are shadowed (set to undefined) around the code at run time.
 * Some are common words ("top", "parent", "name") the code may use as its own
 * variable names, so they are not refused by the scan.
 */
export const SHADOWED = [...[...BANNED_NAMES].filter((n) => n !== "eval" && !n.startsWith("__")), "self", "top", "parent", "frames", "opener", "location", "history", "chrome", "electron", "origin", "open", "close", "print", "alert", "confirm", "prompt"];

/** Loop passes allowed per drawn frame before the code is stopped. */
export const LOOP_LIMIT = 2_000_000;

export const CODE_MAX_CHARS = 200_000;

export type CompileResult = { ok: true; js: string } | { ok: false; problems: string[] };

type AnyNode = Node & Record<string, unknown>;

function lineOf(src: string, pos: number): number {
	let n = 1;
	for (let i = 0; i < pos && i < src.length; i++) if (src.charCodeAt(i) === 10) n++;
	return n;
}

/** Every child node of a node (acorn has no walker without another package). */
function children(n: AnyNode): AnyNode[] {
	const out: AnyNode[] = [];
	for (const [k, v] of Object.entries(n)) {
		if (k === "type" || k === "start" || k === "end" || k === "loc" || k === "range") continue;
		if (Array.isArray(v)) for (const x of v) if (x && typeof x === "object" && typeof (x as AnyNode).type === "string") out.push(x as AnyNode);
		if (v && typeof v === "object" && !Array.isArray(v) && typeof (v as AnyNode).type === "string") out.push(v as AnyNode);
	}
	return out;
}

const staticKey = (n: AnyNode): string | null => (n.type === "Literal" && typeof n.value === "string" ? (n.value as string) : n.type === "TemplateLiteral" && (n.expressions as unknown[]).length === 0 ? ((n.quasis as AnyNode[])[0]!.value as { cooked: string }).cooked : null);

/** True when a node has a string literal anywhere inside. */
const hasString = (n: AnyNode): boolean => (n.type === "Literal" && typeof n.value === "string") || n.type === "TemplateLiteral" || children(n).some(hasString);

/** Reads the JS tree and lists everything that is not allowed. Also collects loops and imports for the rewrite. */
function scan(js: string, tree: AnyNode) {
	const problems: string[] = [];
	const loops: AnyNode[] = [];
	const imports: AnyNode[] = [];
	const exports: AnyNode[] = [];
	const bad = (n: AnyNode, why: string) => {
		if (problems.length < 20) problems.push(`Line ${lineOf(js, n.start)}: ${why}`);
	};
	const walk = (n: AnyNode, parent: AnyNode | null) => {
		switch (n.type) {
			case "Identifier": {
				const name = n.name as string;
				// Property keys (a.window, { window: 1 }) are names, not the global.
				const isKey = parent && ((parent.type === "MemberExpression" && parent.property === n && !parent.computed) || ((parent.type === "Property" || parent.type === "MethodDefinition" || parent.type === "PropertyDefinition") && parent.key === n && !parent.computed));
				if (isKey) {
					if (BANNED_PROPS.has(name)) bad(n, `"${name}" is not allowed.`);
				} else if (BANNED_NAMES.has(name)) bad(n, `"${name}" is not allowed in video code (no network, storage, page, clock or eval).`);
				break;
			}
			case "MemberExpression": {
				const obj = n.object as AnyNode;
				const prop = n.property as AnyNode;
				const key = n.computed ? staticKey(prop) : (prop.name as string);
				if (key && BANNED_PROPS.has(key)) bad(n, `"${key}" is not allowed.`);
				const hook = key ? STATE_HOOKS.get(key) : undefined;
				if (hook && !n.computed && obj.type === "Identifier") bad(n, hook);
				if (obj.type === "Identifier" && obj.name === "Math" && key === "random") bad(n, "Math.random() gives a different picture on every draw. Use random(seed) from remotion.");
				// A key built from strings at run time could spell a blocked name.
				if (n.computed && (prop.type === "BinaryExpression" || (prop.type === "TemplateLiteral" && (prop.expressions as unknown[]).length > 0)) && hasString(prop)) bad(n, "Property names built from strings are not allowed. Use a plain name or a number index.");
				break;
			}
			case "Property": {
				const k = n.key as AnyNode;
				const name = n.computed ? null : k.type === "Identifier" ? (k.name as string) : typeof k.value === "string" ? (k.value as string) : null;
				const v = n.value as AnyNode;
				const text = v.type === "Literal" && typeof v.value === "string" ? v.value : v.type === "TemplateLiteral" ? (v.quasis as AnyNode[]).map((q) => (q.value as { cooked: string }).cooked).join("") : null;
				if (name && (CLOCK_CSS.has(name) || (CLOCK_CSS_SHORT.has(name) && text !== null && CSS_TIMING.test(text)))) bad(n, `"${name}": ${CLOCK_CSS_FIX}`);
				break;
			}
			case "Literal":
				if (n.regex === undefined && typeof n.value === "string" && parent?.type === "Property" && parent.key === n && BANNED_PROPS.has(n.value)) bad(n, `"${n.value}" is not allowed.`);
				break;
			case "ImportExpression":
				bad(n, "import() is not allowed.");
				break;
			case "MetaProperty":
				bad(n, `${(n.meta as AnyNode).name}.${(n.property as AnyNode).name} is not allowed.`);
				break;
			case "WithStatement":
				bad(n, "with is not allowed.");
				break;
			case "DebuggerStatement":
				bad(n, "debugger is not allowed.");
				break;
			case "ImportDeclaration": {
				imports.push(n);
				const from = (n.source as AnyNode).value as string;
				const allowed = (CODE_IMPORTS as Record<string, readonly string[]>)[from];
				if (!allowed) {
					bad(n, `Cannot import "${from}". Only ${Object.keys(CODE_IMPORTS).map((m) => `"${m}"`).join(", ")} can be imported.`);
					break;
				}
				for (const s of n.specifiers as AnyNode[]) {
					const hook = s.type === "ImportSpecifier" ? STATE_HOOKS.get((s.imported as AnyNode).name as string) : undefined;
					if (from === "react" && hook) {
						bad(s, hook);
						continue;
					}
					if (s.type !== "ImportSpecifier") {
						if (from !== "react") bad(s, `Import names from "${from}" one by one: import { ... } from "${from}".`);
						continue;
					}
					const name = (s.imported as AnyNode).name as string;
					if (!allowed.includes(name)) bad(s, `"${name}" is not available from "${from}". Available: ${allowed.join(", ")}.`);
				}
				return;
			}
			case "ExportNamedDeclaration":
				if (n.source) bad(n, "Re-exports are not allowed.");
				else if (!n.declaration) bad(n, "Export lists are not allowed. Write `export default function Video`.");
				exports.push(n);
				break;
			case "ExportAllDeclaration":
				bad(n, "Re-exports are not allowed.");
				break;
			case "ExportDefaultDeclaration":
				exports.push(n);
				break;
			case "CallExpression": {
				// JSX became __h("tag", ...): refuse tags that load other pages, code or media.
				const callee = n.callee as AnyNode;
				const first = (n.arguments as AnyNode[])[0];
				if (callee.type === "Identifier" && callee.name === "__h" && first?.type === "Literal" && typeof first.value === "string" && BANNED_TAGS.has(first.value)) bad(n, `<${first.value}> is not allowed. Draw with div, span, svg, img (Img) and CSS.`);
				else if (callee.type === "Identifier" && callee.name === "__h" && first?.type === "Literal" && typeof first.value === "string" && CLOCK_TAGS.has(first.value)) bad(n, `<${first.value}> animates on the clock and can loop forever, so the render would not match the preview. Fix: animate the attribute with interpolate() on useCurrentFrame().`);
				break;
			}
			case "ForStatement":
			case "WhileStatement":
			case "DoWhileStatement":
			case "ForInStatement":
			case "ForOfStatement":
				loops.push(n);
				break;
		}
		for (const c of children(n)) walk(c, n);
	};
	walk(tree, null);
	return { problems, loops, imports, exports };
}

/** Text edits applied from the end, so earlier positions stay valid. */
function applyEdits(src: string, edits: { at: number; end?: number; text: string }[]): string {
	let out = src;
	for (const e of [...edits].sort((a, b) => b.at - a.at || (b.end ?? b.at) - (a.end ?? a.at))) out = out.slice(0, e.at) + e.text + out.slice(e.end ?? e.at);
	return out;
}

/** The import as plain code: `const { a, b: c } = __modules["remotion"];`. */
function importLine(n: AnyNode): string {
	const from = JSON.stringify((n.source as AnyNode).value);
	const parts: string[] = [];
	const named: string[] = [];
	for (const s of n.specifiers as AnyNode[]) {
		const local = (s.local as AnyNode).name as string;
		if (s.type === "ImportSpecifier") {
			const imported = (s.imported as AnyNode).name as string;
			named.push(imported === local ? local : `${imported}: ${local}`);
		} else parts.push(`const ${local} = __modules[${from}];`);
	}
	if (named.length) parts.push(`const { ${named.join(", ")} } = __modules[${from}];`);
	return parts.join(" ");
}

/**
 * TSX source to checked JS that runs with `__modules`, `__exports`, `__loop`,
 * `__h` (createElement) and `__Fragment` in scope. Never throws.
 */
export function compileCode(source: string): CompileResult {
	if (source.length > CODE_MAX_CHARS) return { ok: false, problems: [`The code is too long (${source.length} characters, at most ${CODE_MAX_CHARS}).`] };
	let js: string;
	try {
		js = transform(source, { transforms: ["typescript", "jsx"], jsxPragma: "__h", jsxFragmentPragma: "__Fragment", production: true, disableESTransforms: true, keepUnusedImports: true }).code;
	} catch (err) {
		return { ok: false, problems: [`Syntax error: ${(err as Error).message}`] };
	}
	let tree: AnyNode;
	try {
		tree = parse(js, { ecmaVersion: "latest", sourceType: "module" }) as unknown as AnyNode;
	} catch (err) {
		return { ok: false, problems: [`Syntax error: ${(err as Error).message}`] };
	}
	const { problems, loops, imports, exports } = scan(js, tree);
	const def = exports.filter((e) => e.type === "ExportDefaultDeclaration");
	if (def.length !== 1) problems.push("The file must have exactly one `export default function Video({ video })`.");
	if (problems.length) return { ok: false, problems };

	const edits: { at: number; end?: number; text: string }[] = [];
	for (const n of imports) edits.push({ at: n.start, end: n.end, text: importLine(n) });
	for (const n of exports) {
		const decl = n.declaration as AnyNode;
		if (n.type === "ExportNamedDeclaration") edits.push({ at: n.start, end: decl.start, text: "" });
		else if ((decl.type === "FunctionDeclaration" || decl.type === "ClassDeclaration") && decl.id) {
			edits.push({ at: n.start, end: decl.start, text: "" });
			edits.push({ at: n.end, text: `\n__exports.default = ${(decl.id as AnyNode).name as string};` });
		} else edits.push({ at: n.start, end: decl.start, text: "__exports.default = " });
	}
	for (const l of loops) {
		const body = l.body as AnyNode;
		if (body.type === "BlockStatement") edits.push({ at: body.start + 1, text: "__loop();" });
		else {
			edits.push({ at: body.start, text: "{__loop();" });
			edits.push({ at: body.end, text: "}" });
		}
	}
	return { ok: true, js: applyEdits(js, edits) };
}

/** The ```tsx block from a model reply (or the whole reply when it has no fence). */
export function extractCode(text: string): string {
	const fences = [...text.matchAll(/```(?:tsx|jsx|typescript|ts|javascript|js)?[ \t]*\n([\s\S]*?)```/g)].map((m) => m[1]!);
	if (fences.length) return fences.sort((a, b) => b.length - a.length)[0]!.trim();
	return text.trim();
}

/* ---------- The data the code gets ---------- */

/** Languages written right to left. */
const RTL = new Set(["ar", "fa", "he", "ps", "sd", "ur", "ug", "yi"]);
export const isRtl = (language: string) => RTL.has(language.split("-")[0]!.toLowerCase());

/**
 * The TypeScript types the AI writes against. Kept here, next to the data
 * builder, so the prompt and the data never drift apart (a unit test checks it).
 */
export const CODE_TYPES = `type VideoData = {
  width: number; height: number; fps: number; durationInFrames: number;
  title: string; level: string; language: string; rtl: boolean;
  /** Frames of the app's own brand intro at the start and outro at the end (0 = none). The app draws them over your picture. */
  intro: number; outro: number;
  /** The band the app's captions cover, in px: from the frame bottom, and its height (0 = no captions). Keep text out of it. */
  captions: { bottom: number; height: number };
  /** Quick changes the user makes in the app (no AI call). Use them: font sizes × text, margins and gaps × space, animation lengths and delays ÷ speed (not the voice-cue frames), accent ?? your main accent colour. */
  tweaks: { accent: string | null; text: number; space: number; speed: number };
  chapters: { title: string; from: number; durationInFrames: number }[];
  scenes: SceneData[];
};
type SceneData = {
  id: string; index: number; chapter: number;
  /** What the scene shows: "title", "bullets", "flow", "chart", "quiz", ... (see props). */
  type: string;
  /** Absolute first frame and length, in frames. */
  from: number; durationInFrames: number;
  /** The scene's content: texts, items, numbers, figure file names. Shape depends on type. */
  props: Record<string, any>;
  /** The voice: when each sentence starts and how long it lasts, in frames from the scene start. */
  sentences: { text: string; from: number; duration: number }[];
  /** Moments to show things, in frames from the scene start: reveal item \`target\`, focus or highlight it. */
  cues: { frame: number; action: "reveal" | "highlight" | "focus" | "sfx"; target?: number }[];
  /** Silent thinking time (quiz, pause scenes), in frames from the scene start. */
  gaps: { from: number; duration: number; target: number }[];
};`;
