import katex from "katex";

/**
 * KaTeX for the equation scene. `trust: false` keeps \href, \url, \includegraphics
 * and \html* commands from doing anything; they are also refused outright here so
 * a plan with them is invalid instead of showing red error text.
 */
export const TEX_MAX_CHARS = 300;
const UNSAFE = /\\(href|url|includegraphics|html[A-Za-z]*|class|id|style|data)\b/;

const OPTIONS = { throwOnError: true, trust: false, strict: "ignore", output: "html", maxExpand: 200, maxSize: 20 } as const;

/** A problem with a formula, or null when KaTeX can draw it. */
export function texProblem(tex: string): string | null {
	if (!tex.trim()) return "the formula is empty";
	if (tex.length > TEX_MAX_CHARS) return `the formula is longer than ${TEX_MAX_CHARS} characters`;
	const bad = UNSAFE.exec(tex);
	if (bad) return `\\${bad[1]} is not allowed`;
	try {
		katex.renderToString(tex, OPTIONS);
		return null;
	} catch (err) {
		return (err as Error).message.replace(/^KaTeX parse error:\s*/, "").slice(0, 200);
	}
}

/** KaTeX HTML for a checked formula. Display mode (centred, full size). */
export function texHtml(tex: string): string {
	try {
		return katex.renderToString(tex, { ...OPTIONS, displayMode: true });
	} catch {
		return katex.renderToString("\\text{?}", OPTIONS);
	}
}
