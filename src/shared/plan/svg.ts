/**
 * Sanitiser for `svg-custom` drawings written by the AI. Pure TypeScript (no DOM),
 * so the planner, the schema and the renderer all run the same check.
 *
 * An allowlist, not a blocklist: only listed elements and attributes pass.
 * Anything that can run code or load something is a problem and the drawing is
 * rejected (the AI gets the problems back and must redraw):
 *  - <script>, <foreignObject>, <style>, <image>, <a>, <iframe>, SMIL animation, DOCTYPE/ENTITY;
 *  - on* event handler attributes;
 *  - href/xlink:href that is not "#id" (and only on <use>), url(...) that is not url(#id),
 *    javascript:, data:, CSS expression() and @import.
 * The result is a plain tree that is drawn with React.createElement, never with innerHTML.
 */

export type SvgNode = { tag: string; attrs: Record<string, string>; children: (SvgNode | string)[] };
export type SanitizeResult = { ok: true; root: SvgNode; ids: string[] } | { ok: false; problems: string[] };

export const SVG_MAX_CHARS = 30_000;
const MAX_ELEMENTS = 800;
const MAX_DEPTH = 24;

const ELEMENTS = new Set([
	"svg",
	"g",
	"defs",
	"title",
	"desc",
	"rect",
	"circle",
	"ellipse",
	"line",
	"polyline",
	"polygon",
	"path",
	"text",
	"tspan",
	"linearGradient",
	"radialGradient",
	"stop",
	"clipPath",
	"mask",
	"pattern",
	"marker",
	"symbol",
	"use",
	"filter",
	"feGaussianBlur",
	"feOffset",
	"feMerge",
	"feMergeNode",
	"feFlood",
	"feComposite",
	"feBlend",
	"feColorMatrix",
	"feDropShadow",
]);

/** Elements that are dangerous or load things: named so the problem message is clear. */
const FORBIDDEN: Record<string, string> = {
	script: "scripts are not allowed",
	foreignobject: "<foreignObject> is not allowed (it can hold HTML)",
	style: "<style> is not allowed; use attributes such as fill and stroke",
	image: "<image> is not allowed (it loads a file)",
	a: "links (<a>) are not allowed",
	iframe: "<iframe> is not allowed",
	object: "<object> is not allowed",
	embed: "<embed> is not allowed",
	animate: "SMIL animation is not allowed; use the animations list",
	animatetransform: "SMIL animation is not allowed; use the animations list",
	animatemotion: "SMIL animation is not allowed; use the animations list",
	set: "SMIL animation is not allowed; use the animations list",
	feimage: "<feImage> is not allowed (it loads a file)",
};

const ATTRS = new Set([
	"id",
	"x",
	"y",
	"x1",
	"y1",
	"x2",
	"y2",
	"cx",
	"cy",
	"r",
	"rx",
	"ry",
	"fx",
	"fy",
	"dx",
	"dy",
	"width",
	"height",
	"d",
	"points",
	"transform",
	"viewBox",
	"preserveAspectRatio",
	"fill",
	"fill-opacity",
	"fill-rule",
	"stroke",
	"stroke-width",
	"stroke-linecap",
	"stroke-linejoin",
	"stroke-dasharray",
	"stroke-dashoffset",
	"stroke-opacity",
	"stroke-miterlimit",
	"opacity",
	"clip-rule",
	"clip-path",
	"mask",
	"filter",
	"marker-start",
	"marker-mid",
	"marker-end",
	"markerWidth",
	"markerHeight",
	"markerUnits",
	"refX",
	"refY",
	"orient",
	"font-size",
	"font-weight",
	"font-style",
	"font-family",
	"text-anchor",
	"dominant-baseline",
	"letter-spacing",
	"offset",
	"stop-color",
	"stop-opacity",
	"gradientUnits",
	"gradientTransform",
	"spreadMethod",
	"patternUnits",
	"patternContentUnits",
	"patternTransform",
	"clipPathUnits",
	"maskUnits",
	"maskContentUnits",
	"pathLength",
	"visibility",
	"display",
	"href",
	"xlink:href",
	"stdDeviation",
	"in",
	"in2",
	"result",
	"operator",
	"mode",
	"values",
	"type",
	"flood-color",
	"flood-opacity",
	"k1",
	"k2",
	"k3",
	"k4",
	"filterUnits",
	"primitiveUnits",
	"rotate",
	"textLength",
	"lengthAdjust",
]);
/** Accepted and dropped: namespace and version noise from drawing tools. */
const IGNORED = new Set(["xmlns", "xmlns:xlink", "xmlns:svg", "version", "xml:space", "class"]);
/** Attributes whose value may reference another element with url(#id). */
const URL_ATTRS = new Set(["fill", "stroke", "clip-path", "mask", "filter", "marker-start", "marker-mid", "marker-end"]);
const ID = /^[A-Za-z][\w-]{0,40}$/;

const ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'", nbsp: " " };
function decode(s: string, problems: string[]): string {
	return s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]+);/gi, (all, e: string) => {
		if (e[0] === "#") {
			const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
			return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : "";
		}
		const v = Object.hasOwn(ENTITIES, e.toLowerCase()) ? ENTITIES[e.toLowerCase()] : undefined;
		if (v === undefined) problems.push(`unknown entity ${all}`);
		return v ?? "";
	});
}

/** Checks one attribute value. Returns a problem or null. */
function checkValue(name: string, value: string): string | null {
	const v = value.replace(/[\s\u0000-\u001f]+/g, "").toLowerCase();
	if (v.includes("javascript:") || v.includes("vbscript:")) return `${name}: script URLs are not allowed`;
	if (v.includes("data:")) return `${name}: data URLs are not allowed`;
	if (v.includes("expression(") || v.includes("@import")) return `${name}: CSS expressions are not allowed`;
	const urls = value.match(/url\(([^)]*)\)/gi) ?? [];
	for (const u of urls) {
		const ref = u.slice(4, -1).trim().replace(/^['"]|['"]$/g, "");
		if (!URL_ATTRS.has(name)) return `${name}: url() is not allowed here`;
		if (!/^#[A-Za-z][\w-]{0,40}$/.test(ref)) return `${name}: external reference ${u} is not allowed (use url(#id))`;
	}
	if (/url\(/i.test(value) && !urls.length) return `${name}: bad url()`;
	return null;
}

/** style="fill:red; stroke-width:2" → attributes, with the same allowlist. */
function styleDecls(style: string): [string, string][] {
	return style
		.split(";")
		.map((d) => d.split(":"))
		.filter((p) => p.length >= 2)
		.map(([k, ...rest]) => [k!.trim().toLowerCase(), rest.join(":").trim()] as [string, string])
		.filter(([k, v]) => k && v);
}

const NAME = /^[A-Za-z_][\w:.-]*/;

export function sanitizeSvg(markup: string): SanitizeResult {
	const problems: string[] = [];
	if (markup.length > SVG_MAX_CHARS) return { ok: false, problems: [`the drawing is longer than ${SVG_MAX_CHARS} characters`] };
	let i = 0;
	const src = markup;
	const stack: SvgNode[] = [];
	let root: SvgNode | null = null;
	let count = 0;
	const ids: string[] = [];
	const refs: string[] = [];
	const add = (n: SvgNode | string) => {
		const parent = stack.at(-1);
		if (parent) parent.children.push(n);
		else if (typeof n === "string") {
			if (n.trim()) problems.push("text outside <svg>");
		} else if (root) problems.push("only one <svg> root is allowed");
		else root = n;
	};
	// A forbidden element is skipped with everything inside it.
	let skipDepth = 0;

	while (i < src.length && problems.length < 20) {
		const lt = src.indexOf("<", i);
		const textEnd = lt < 0 ? src.length : lt;
		if (textEnd > i) {
			const t = src.slice(i, textEnd);
			if (!skipDepth && stack.length) {
				const top = stack.at(-1)!;
				if (top.tag === "text" || top.tag === "tspan" || top.tag === "title" || top.tag === "desc") add(decode(t, problems));
				else if (t.trim()) problems.push(`text inside <${top.tag}> is not allowed`);
			} else if (!stack.length && t.trim()) problems.push("text outside <svg>");
			i = textEnd;
			continue;
		}
		if (src.startsWith("<!--", i)) {
			const end = src.indexOf("-->", i + 4);
			if (end < 0) {
				problems.push("unclosed comment");
				break;
			}
			i = end + 3;
			continue;
		}
		if (src.startsWith("<?", i)) {
			const end = src.indexOf("?>", i);
			const pi = src.slice(i, end < 0 ? src.length : end);
			if (!/^<\?xml[\s?]/i.test(pi + " ")) problems.push("processing instructions are not allowed");
			i = end < 0 ? src.length : end + 2;
			continue;
		}
		if (src.startsWith("<!", i)) {
			problems.push(src.slice(i, i + 9).toUpperCase().startsWith("<![CDATA[") ? "CDATA sections are not allowed" : "DOCTYPE and ENTITY declarations are not allowed");
			break;
		}
		if (src.startsWith("</", i)) {
			const end = src.indexOf(">", i);
			if (end < 0) {
				problems.push("unclosed end tag");
				break;
			}
			const name = src.slice(i + 2, end).trim();
			i = end + 1;
			if (skipDepth) {
				skipDepth--;
				continue;
			}
			const top = stack.pop();
			if (!top || top.tag !== name) {
				problems.push(`</${name}> does not match an open tag`);
				break;
			}
			continue;
		}
		// Start tag.
		const m = NAME.exec(src.slice(i + 1));
		if (!m) {
			problems.push("a '<' that does not start a tag");
			break;
		}
		const tag = m[0];
		let j = i + 1 + tag.length;
		const attrs: Record<string, string> = {};
		let selfClose = false;
		let closed = false;
		const lower = tag.toLowerCase();
		const forbidden = Object.hasOwn(FORBIDDEN, lower) ? FORBIDDEN[lower] : undefined;
		const known = ELEMENTS.has(tag);
		while (j < src.length) {
			while (j < src.length && /\s/.test(src[j]!)) j++;
			if (src.startsWith("/>", j)) {
				selfClose = true;
				closed = true;
				j += 2;
				break;
			}
			if (src[j] === ">") {
				closed = true;
				j++;
				break;
			}
			const an = NAME.exec(src.slice(j));
			if (!an) {
				problems.push(`bad attribute in <${tag}>`);
				j = src.length;
				break;
			}
			const name = an[0];
			j += name.length;
			while (j < src.length && /\s/.test(src[j]!)) j++;
			let value = "";
			if (src[j] === "=") {
				j++;
				while (j < src.length && /\s/.test(src[j]!)) j++;
				const q = src[j];
				if (q !== '"' && q !== "'") {
					problems.push(`attribute ${name} in <${tag}> must be quoted`);
					j = src.length;
					break;
				}
				const end = src.indexOf(q, j + 1);
				if (end < 0) {
					problems.push(`unclosed attribute ${name}`);
					j = src.length;
					break;
				}
				value = decode(src.slice(j + 1, end), problems);
				j = end + 1;
			}
			if (forbidden || !known) continue;
			const ln = name.toLowerCase();
			if (ln.startsWith("on")) {
				problems.push(`event handler ${name} on <${tag}> is not allowed`);
				continue;
			}
			if (IGNORED.has(ln)) continue;
			if (ln === "style") {
				for (const [k, v] of styleDecls(value)) {
					if (!ATTRS.has(k) || k === "href") problems.push(`style property ${k} is not allowed`);
					else {
						const p = checkValue(k, v);
						if (p) problems.push(p);
						else attrs[k] = v;
					}
				}
				continue;
			}
			if (ln === "href" || ln === "xlink:href") {
				if (tag !== "use") problems.push(`${name} on <${tag}> is not allowed`);
				else if (!/^#[A-Za-z][\w-]{0,40}$/.test(value.trim())) problems.push(`external reference ${name}="${value.slice(0, 60)}" is not allowed (use "#id")`);
				else {
					attrs.href = value.trim();
					refs.push(value.trim().slice(1));
				}
				continue;
			}
			if (!ATTRS.has(name)) {
				problems.push(`attribute ${name} on <${tag}> is not allowed`);
				continue;
			}
			const p = checkValue(name, value);
			if (p) {
				problems.push(p);
				continue;
			}
			if (name === "id") {
				if (!ID.test(value)) {
					problems.push(`id "${value.slice(0, 40)}" must start with a letter and use only letters, digits, - and _`);
					continue;
				}
				if (ids.includes(value)) problems.push(`duplicate id "${value}"`);
				ids.push(value);
			}
			for (const r of value.matchAll(/url\(\s*['"]?#([\w-]+)/g)) refs.push(r[1]!);
			attrs[name] = value;
		}
		if (!closed) {
			problems.push(`unclosed <${tag}>`);
			break;
		}
		i = j;
		if (skipDepth) {
			if (!selfClose) skipDepth++;
			continue;
		}
		if (forbidden || !known) {
			problems.push(forbidden ? forbidden : `<${tag}> is not allowed`);
			if (!selfClose) skipDepth = 1;
			continue;
		}
		if (!stack.length && tag !== "svg") {
			problems.push("the drawing must start with <svg>");
			break;
		}
		if (++count > MAX_ELEMENTS) {
			problems.push(`more than ${MAX_ELEMENTS} elements`);
			break;
		}
		if (stack.length >= MAX_DEPTH) {
			problems.push(`nested deeper than ${MAX_DEPTH} levels`);
			break;
		}
		const node: SvgNode = { tag, attrs, children: [] };
		add(node);
		if (!selfClose) stack.push(node);
	}
	if (!problems.length && stack.length) problems.push(`<${stack.at(-1)!.tag}> is not closed`);
	if (!problems.length && !root) problems.push("no <svg> element");
	const r = root as SvgNode | null;
	if (!problems.length && r && !r.attrs.viewBox && !(r.attrs.width && r.attrs.height)) problems.push("<svg> needs a viewBox (or width and height)");
	if (!problems.length && r?.attrs.viewBox && !/^\s*-?[\d.]+([\s,]+-?[\d.]+){3}\s*$/.test(r.attrs.viewBox)) problems.push("viewBox must be four numbers");
	for (const ref of refs) if (!ids.includes(ref)) problems.push(`reference #${ref} points to no element`);
	if (problems.length) return { ok: false, problems: [...new Set(problems)].slice(0, 12) };
	return { ok: true, root: r!, ids };
}

/** The drawing's viewBox as numbers. */
export function viewBoxOf(root: SvgNode): [number, number, number, number] {
	const vb = root.attrs.viewBox?.trim().split(/[\s,]+/).map(Number);
	if (vb && vb.length === 4 && vb.every(Number.isFinite)) return vb as [number, number, number, number];
	return [0, 0, parseFloat(root.attrs.width ?? "100") || 100, parseFloat(root.attrs.height ?? "100") || 100];
}
