import "katex/dist/katex.min.css";
import * as React from "react";
import { Component, type ComponentType, type CSSProperties, type ReactNode } from "react";
import * as Remotion from "remotion";
import { CODE_IMPORTS, compileCode, LOOP_LIMIT, SHADOWED } from "../../../src/shared/plan/code";
import { codeSceneAt, type CodeVideoData } from "../../../src/shared/plan/code-data";
import { LOOK_FONTS, type LookFont } from "../../../src/shared/plan/look";
import { texHtml } from "../../../src/shared/plan/tex";
import { waitOnce } from "../plan/wait-once";

/**
 * Runs the AI's video code. Only ever loaded in a sandbox: the Studio preview
 * iframe (es-preview://), the hidden check window, or the headless render page
 * (locked with lockPage). The code itself was checked by compileCode, which
 * also adds the loop guards used here.
 */

export type VideoComponent = ComponentType<{ video: CodeVideoData }>;
export type LoadResult = { ok: true; Video: VideoComponent } | { ok: false; problems: string[] };

/* ---------- The "studio" module ---------- */

let figureBase: string | undefined;
let measure: CanvasRenderingContext2D | null = null;

const fonts = Object.fromEntries(Object.entries(LOOK_FONTS).map(([k, f]) => [k, f.stack])) as Record<LookFont, string>;

/** A figure's URL from its file name in the scene props (undefined when figures are not available). */
const figureUrl = (file: string): string | undefined => (figureBase && /^[a-z0-9]{1,12}-\d{3,4}\.(png|jpe?g|webp|gif)$/.test(file) ? `${figureBase}${file}` : undefined);

/** A LaTeX formula drawn with KaTeX (trust off). */
function Tex({ tex, style }: { tex: string; style?: CSSProperties }) {
	return <div style={style} dangerouslySetInnerHTML={{ __html: texHtml(String(tex)) }} />;
}

/** The largest font size (at most `max`) at which the text fits in `maxWidth` on `lines` lines. */
function fitFontSize(text: string, opts: { maxWidth: number; max: number; min?: number; fontFamily?: string; fontWeight?: number | string; lines?: number }): number {
	const min = opts.min ?? 12;
	const lines = Math.max(1, opts.lines ?? 1);
	measure ??= globalThis.document?.createElement("canvas").getContext("2d") ?? null;
	if (!measure) return opts.max;
	measure.font = `${opts.fontWeight ?? 400} 100px ${opts.fontFamily ?? fonts.modern}`;
	const width = measure.measureText(String(text)).width / 100;
	if (!width) return opts.max;
	// A little room for wrapping at word edges.
	const size = (opts.maxWidth * lines * (lines > 1 ? 0.92 : 1)) / width;
	return Math.max(min, Math.min(opts.max, Math.floor(size)));
}

const STUDIO = { fonts, figureUrl, Tex, sceneAt: codeSceneAt, fitFontSize };

/** The modules the code may import, with only the allowed names. */
function modules(): Record<string, unknown> {
	const pick = (src: Record<string, unknown>, names: readonly string[]) => Object.fromEntries(names.map((n) => [n, src[n]]));
	return {
		react: { ...pick(React as unknown as Record<string, unknown>, CODE_IMPORTS.react), default: pick(React as unknown as Record<string, unknown>, CODE_IMPORTS.react) },
		remotion: pick(Remotion as unknown as Record<string, unknown>, CODE_IMPORTS.remotion),
		studio: pick(STUDIO, CODE_IMPORTS.studio),
	};
}

/* ---------- Loop guard ---------- */

let loops = 0;
const loop = () => {
	if (++loops > LOOP_LIMIT) throw new Error("A loop ran too long (it may never end).");
};
/** Called before each drawn frame. */
export const resetLoops = () => {
	loops = 0;
};

/* ---------- Loading ---------- */

const cache = new Map<string, LoadResult>();

/** Compiles, checks and runs the module code once per source. Never throws. */
export function loadVideoCode(source: string): LoadResult {
	const hit = cache.get(source);
	if (hit) return hit;
	const c = compileCode(source);
	let r: LoadResult;
	if (!c.ok) r = { ok: false, problems: c.problems };
	else {
		try {
			const exports: { default?: unknown } = {};
			// The code goes in a block, so its own names may reuse the shadowed ones ("const top = 40").
			const run = new Function("__modules", "__exports", "__loop", "__h", "__Fragment", ...SHADOWED, `"use strict";\n{\n${c.js}\n}`);
			resetLoops();
			run(modules(), exports, loop, React.createElement, React.Fragment, ...SHADOWED.map(() => undefined));
			r = typeof exports.default === "function" ? { ok: true, Video: exports.default as VideoComponent } : { ok: false, problems: ["The default export must be a function component: export default function Video({ video })."] };
		} catch (err) {
			r = { ok: false, problems: [`The code failed while loading: ${(err as Error)?.message ?? String(err)}`] };
		}
	}
	if (cache.size > 20) cache.clear();
	cache.set(source, r);
	return r;
}

/** Sets where figure files are loaded from (the code calls figureUrl). */
export const setFigureBase = (base: string | undefined) => {
	figureBase = base;
};

/**
 * The headless render page has no policy of its own: before AI code runs there,
 * a Content-Security-Policy is added that allows the page itself and the local
 * media server only. No other network, frames or workers.
 */
export function lockPage(mediaUrls: (string | undefined)[]): void {
	const doc = globalThis.document;
	if (!doc || !/^https?:$/.test(globalThis.location?.protocol ?? "") || doc.querySelector("meta[data-es-lock]")) return;
	const origins = [...new Set(mediaUrls.flatMap((u) => (u && /^https?:/.test(u) ? [new URL(u).origin] : [])))].join(" ");
	const meta = doc.createElement("meta");
	meta.httpEquiv = "Content-Security-Policy";
	meta.dataset.esLock = "1";
	meta.content = `connect-src 'self' ${origins}; img-src 'self' data: blob: ${origins}; media-src 'self' data: blob: ${origins}; font-src 'self' data: ${origins}; frame-src 'none'; worker-src 'none'; object-src 'none'; form-action 'none'`;
	doc.head.appendChild(meta);
}

/* ---------- Error guard ---------- */

type GuardProps = { at: number; fallback: ReactNode; onError?: (message: string, at: number) => void; children: ReactNode };

/**
 * Catches a crash of the code. The built-in scene is drawn for the rest of that
 * scene; the next scene tries the code again.
 */
export class CodeGuard extends Component<GuardProps, { error: boolean; at: number }> {
	state = { error: false, at: this.props.at };
	static getDerivedStateFromProps(props: GuardProps, state: { error: boolean; at: number }) {
		return props.at !== state.at ? { error: false, at: props.at } : null;
	}
	static getDerivedStateFromError() {
		return { error: true };
	}
	componentDidCatch(err: unknown) {
		const message = (err as Error)?.message ?? String(err);
		console.warn(`AI video code failed in scene ${this.props.at + 1}: ${message}`);
		this.props.onError?.(message, this.props.at);
	}
	render() {
		return this.state.error ? this.props.fallback : this.props.children;
	}
}

/* ---------- Where code may run ---------- */

let allowed = false;
/**
 * Called once by each sandboxed entry point (the render bundle, the preview
 * iframe, the check page). The app window never calls it, so there a "code"
 * video always shows the built-in scenes, even if a plan arrives there.
 */
export const allowVideoCode = () => {
	allowed = true;
};
export const videoCodeAllowed = () => allowed;

/** Waits (delayRender) for the fonts the code can name through `fonts`. */
export function useCodeFonts() {
	const families = Object.values(fonts).map((f) => f.split(",")[0]!.trim());
	waitOnce("fonts:code", "Loading fonts for the video code", () => Promise.all(families.flatMap((f) => [document.fonts.load(`400 40px ${f}`), document.fonts.load(`700 40px ${f}`)])));
}
