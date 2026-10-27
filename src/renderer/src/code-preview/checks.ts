import type { CheckIssue } from "@shared/code-preview";
import type { computeTimeline } from "@shared/plan/timing";

/**
 * What the test draw looks for in a drawn frame of AI video code, besides
 * crashes: NaN values, an empty picture, and text that is hard to read (outside
 * the frame, at its edge, too small, on top of other text, cut off, low
 * contrast). The motion pass looks for frozen stretches and text shown too
 * briefly. Every warning ends with a "Fix:" line for the AI.
 * Thresholds follow common video practice (see the hyperframes audits, Apache-2.0).
 */

export type Out = { errors: CheckIssue[]; warnings: CheckIssue[]; kinds: Map<string, number>; seen?: Set<string> };

export const tick = () => new Promise((r) => setTimeout(r, 0));
export const short = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** How see-through an element really is (its own opacity times its parents', up to the frame). Hidden = 0. */
function opacityOf(el: Element, stop: Element): number {
	let o = 1;
	for (let e: Element | null = el; e && e !== stop; e = e.parentElement) {
		const cs = getComputedStyle(e);
		if (cs.visibility === "hidden") return 0;
		o *= Number(cs.opacity) || 0;
	}
	return o;
}

/**
 * One piece of text on screen: its glyph boxes (one per line), not the box around it.
 * `seen` are the parts of the lines left visible by boxes that hide overflow;
 * `masked` is text under a CSS mask (a fade that hides it on purpose, as a chat scrolling up).
 */
type TextRun = { text: string; el: Element; rect: DOMRect; lines: DOMRect[]; seen: DOMRect[]; opacity: number; math: boolean; masked: boolean };

function textRuns(frameBox: HTMLElement, max = 300): TextRun[] {
	const out: TextRun[] = [];
	const walker = document.createTreeWalker(frameBox, NodeFilter.SHOW_TEXT);
	const range = document.createRange();
	for (let n = walker.nextNode(); n && out.length < max; n = walker.nextNode()) {
		const text = n.textContent?.replace(/\s+/g, " ").trim();
		const el = n.parentElement;
		if (!text || !el) continue;
		range.selectNodeContents(n);
		const rect = range.getBoundingClientRect();
		if (rect.width === 0 || rect.height === 0) continue;
		const lines = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
		let clip = new DOMRect(-1e6, -1e6, 2e6, 2e6);
		let masked = false;
		for (let e: Element | null = el; e && e !== frameBox; e = e.parentElement) {
			const cs = getComputedStyle(e);
			if (cs.maskImage && cs.maskImage !== "none") masked = true;
			if (cs.overflowX !== "visible" || cs.overflowY !== "visible") clip = intersect(clip, e.getBoundingClientRect());
		}
		// Some fonts (hand-drawn ones) report a line box far taller than their letters:
		// for overlaps, a line is its middle 1 em, not the whole box.
		const em = emOf(el);
		const ink = (l: DOMRect) => (l.height > em ? new DOMRect(l.left, l.top + (l.height - em) / 2, l.width, em) : l);
		const seen = lines.map((l) => intersect(ink(l), clip)).filter((r) => r.width > 0 && r.height > 0);
		// Formulas (KaTeX) stack small pieces on purpose: only the frame edge applies to them.
		out.push({ text, el, rect, lines, seen, opacity: opacityOf(el, frameBox), math: !!el.closest(".katex"), masked });
	}
	return out;
}

/** An element's font size in screen pixels (through CSS transforms and SVG scaling). */
function emOf(el: Element): number {
	const size = parseFloat(getComputedStyle(el).fontSize) || 16;
	if (el instanceof HTMLElement && el.offsetWidth > 0) return size * (el.getBoundingClientRect().width / el.offsetWidth);
	if (el instanceof SVGGraphicsElement) {
		const m = el.getScreenCTM();
		if (m) return size * Math.hypot(m.a, m.b);
	}
	return size;
}

function intersect(a: DOMRect, b: DOMRect): DOMRect {
	const left = Math.max(a.left, b.left);
	const top = Math.max(a.top, b.top);
	return new DOMRect(left, top, Math.max(0, Math.min(a.right, b.right) - left), Math.max(0, Math.min(a.bottom, b.bottom) - top));
}

const area = (r: DOMRect) => r.width * r.height;
const overlap = (a: DOMRect, b: DOMRect) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
/** Font size from the glyph box (about 1.2 × the size for most fonts). Works through transforms and SVG scaling. */
const sizeOf = (t: TextRun) => Math.max(...t.lines.map((l) => l.height)) / 1.2;

type RGBA = [number, number, number, number];
function parseColor(s: string): RGBA | null {
	const m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(s);
	if (!m) return null;
	const a = m[4] === undefined ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : Number(m[4]);
	return [Number(m[1]), Number(m[2]), Number(m[3]), a];
}
const luminance = ([r, g, b]: RGBA) => {
	const f = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
	return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
export const contrast = (a: RGBA, b: RGBA) => {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
	return (hi + 0.05) / (lo + 0.05);
};
const blend = (fg: RGBA, bg: RGBA, alpha: number): RGBA => [fg[0] * alpha + bg[0] * (1 - alpha), fg[1] * alpha + bg[1] * (1 - alpha), fg[2] * alpha + bg[2] * (1 - alpha), 1];

/**
 * The solid colour behind a point, from the elements stacked there (top first),
 * starting at the text's own element. Null when it cannot be known for sure:
 * a picture, a gradient or something see-through is in the way.
 */
function backdrop(stack: Element[], from: number, frameBox: HTMLElement): RGBA | null {
	for (let i = from; i < stack.length; i++) {
		const e = stack[i]!;
		if (!frameBox.contains(e)) return null;
		if (e instanceof HTMLImageElement || e instanceof HTMLCanvasElement || e instanceof SVGImageElement) return null;
		const cs = getComputedStyle(e);
		if (cs.backgroundImage !== "none") return null;
		const shape = e instanceof SVGGeometryElement;
		const c = parseColor(shape ? cs.fill : cs.backgroundColor);
		if (!c) {
			if (shape && cs.fill !== "none") return null;
			continue;
		}
		if (c[3] === 0) continue;
		const o = opacityOf(e, frameBox) * c[3] * (shape ? Number(cs.fillOpacity) || 0 : 1);
		if (o === 0) continue;
		if (o < 0.9) return null;
		return c;
	}
	return null;
}

/**
 * Warnings of one kind are capped, so one repeated problem does not hide the
 * others; the same problem with the same text (seen again in a later frame) is
 * told once.
 */
const KIND_CAP = 3;
function warn(out: Out, kind: string, issue: CheckIssue, about?: string) {
	const n = out.kinds.get(kind) ?? 0;
	if (n >= KIND_CAP) return;
	if (about !== undefined) {
		out.seen ??= new Set();
		const key = kind + "|" + about;
		if (out.seen.has(key)) return;
		out.seen.add(key);
	}
	out.kinds.set(kind, n + 1);
	out.warnings.push(issue);
}

const px = (n: number) => `${Math.round(n)}`;

/** Problems in one drawn frame: NaN values, an empty picture, and text that is hard to read. */
export function inspect(frameBox: HTMLElement, frame: number, scene: number, settled: boolean, out: Out) {
	const box = frameBox.getBoundingClientRect();
	const all = [...frameBox.querySelectorAll("*")];
	const bad = all.find((el) => [...el.attributes].some((a) => /\bNaN\b|\bInfinity\b/.test(a.value)));
	if (bad) {
		const a = [...bad.attributes].find((x) => /\bNaN\b|\bInfinity\b/.test(x.value))!;
		out.errors.push({ frame, scene, message: `A value is NaN or Infinity: <${bad.tagName.toLowerCase()} ${a.name}="${short(a.value, 120)}">. Fix: check the maths (division by zero, a missing prop, an empty list).` });
	}
	if (!settled) return;
	const text = frameBox.innerText.trim();
	const shapes = frameBox.querySelector("svg, img, canvas");
	const filled = all.filter((el) => {
		const cs = getComputedStyle(el);
		return (cs.backgroundImage !== "none" || !/rgba\(0, 0, 0, 0\)|transparent/.test(cs.backgroundColor)) && el.getBoundingClientRect().width > 0;
	}).length;
	if (!text && !shapes && filled <= 1) warn(out, "empty", { frame, scene, message: "The frame shows nothing but a background. Fix: show this scene's content while the voice talks about it." });

	const W = box.width;
	const H = box.height;
	const shortSide = Math.min(W, H);
	const runs = textRuns(frameBox);
	const shown = runs.filter((t) => t.opacity > 0.3);
	const at = (r: DOMRect) => `x ${px(r.left - box.left)} to ${px(r.right - box.left)}, y ${px(r.top - box.top)} to ${px(r.bottom - box.top)}`;

	// Outside the frame (any visible text, formulas too).
	const outside = new Set<TextRun>();
	for (const t of runs) {
		const r = t.rect;
		if (t.opacity <= 0.05) continue;
		if (r.left < box.left - 4 || r.right > box.right + 4 || r.top < box.top - 4 || r.bottom > box.bottom + 4) {
			outside.add(t);
			warn(out, "outside", { frame, scene, message: `Text "${short(t.text)}" goes outside the ${px(W)}×${px(H)} frame (it reaches ${at(r)}). Fix: make it smaller (fitFontSize) or let it wrap, inside a safe margin.` }, t.text);
		}
	}

	// Touching the frame edge.
	const edge = Math.max(8, shortSide * 0.015);
	for (const t of shown) {
		if (outside.has(t)) continue;
		const r = t.rect;
		const d = Math.min(r.left - box.left, box.right - r.right, r.top - box.top, box.bottom - r.bottom);
		if (d < edge) warn(out, "edge", { frame, scene, message: `Text "${short(t.text)}" touches the frame edge (${px(Math.max(0, d))} px away; it reaches ${at(r)}). Fix: keep text at least ${px(shortSide * 0.04)} px from every edge.` }, t.text);
	}

	// Too small to read on the frame's short side (phones, for tall frames).
	const minSize = shortSide * 0.02;
	for (const t of shown) {
		if (t.math || t.text.length < 2) continue;
		const s = sizeOf(t);
		if (s < minSize) warn(out, "small", { frame, scene, message: `Text "${short(t.text)}" is about ${px(s)} px high, too small to read on a ${px(W)}×${px(H)} frame. Fix: use at least ${Math.ceil(minSize)} px.` }, t.text);
	}

	// Two texts on top of each other.
	const plain = shown.filter((t) => !t.math);
	pairs: for (let i = 0; i < plain.length; i++)
		for (let j = i + 1; j < plain.length; j++) {
			const a = plain[i]!;
			const b = plain[j]!;
			// The same words twice (a shadow or an outline layer) are a style, not a clash.
			if (a.el === b.el || a.text === b.text || a.el.contains(b.el) || b.el.contains(a.el)) continue;
			for (const la of a.seen)
				for (const lb of b.seen)
					if (overlap(la, lb) > 0.3 * Math.min(area(la), area(lb))) {
						warn(out, "overlap", { frame, scene, message: `Text "${short(a.text, 40)}" and text "${short(b.text, 40)}" are drawn on top of each other (near ${at(la)}). Fix: give each text its own space (flex or grid with a gap), or move one.` }, a.text + "|" + b.text);
						if ((out.kinds.get("overlap") ?? 0) >= KIND_CAP) break pairs;
						continue pairs;
					}
		}

	// Cut off by a box that hides overflow (the frame itself is the "outside" check).
	for (const t of plain) {
		if (outside.has(t) || t.masked) continue;
		for (let e: Element | null = t.el; e && e !== frameBox; e = e.parentElement) {
			const cs = getComputedStyle(e);
			const cx = cs.overflowX !== "visible";
			const cy = cs.overflowY !== "visible";
			if (!cx && !cy) continue;
			const c = e.getBoundingClientRect();
			if (Math.abs(c.width - W) < 2 && Math.abs(c.height - H) < 2) break;
			const r = t.rect;
			if ((cx && (r.left < c.left - 4 || r.right > c.right + 4)) || (cy && (r.top < c.top - 4 || r.bottom > c.bottom + 4))) warn(out, "clipped", { frame, scene, message: `Text "${short(t.text)}" is cut off by its box (the box is ${px(c.width)}×${px(c.height)} px; the text needs ${px(r.width)}×${px(r.height)}). Fix: make the text smaller (fitFontSize) or the box bigger.` }, t.text);
			break;
		}
	}

	// Contrast with the solid colour behind the text. The frame is scaled into the
	// (small) window for a moment, so every point of it can be looked up.
	const fully = plain.filter((t) => t.opacity > 0.9).slice(0, 12);
	if (fully.length && (out.kinds.get("contrast") ?? 0) < KIND_CAP) {
		const scale = Math.min(window.innerWidth / W, window.innerHeight / H, 1) * 0.98;
		const before = frameBox.style.transform;
		const origin = frameBox.style.transformOrigin;
		frameBox.style.transformOrigin = "0 0";
		frameBox.style.transform = `scale(${scale})`;
		try {
			const host = frameBox.getBoundingClientRect();
			for (const t of fully) {
				const cs = getComputedStyle(t.el);
				if (cs.textShadow !== "none" || parseFloat(cs.webkitTextStrokeWidth) > 0) continue;
				const fg = parseColor(t.el instanceof SVGElement ? cs.fill : cs.color);
				if (!fg) continue;
				const l = t.lines[0]!;
				const x = host.left + (l.left + l.width / 2 - box.left) * scale;
				const y = host.top + (l.top + l.height / 2 - box.top) * scale;
				const stack = document.elementsFromPoint(x, y);
				const from = stack.indexOf(t.el);
				if (from < 0) continue;
				const bg = backdrop(stack, from, frameBox);
				if (!bg) continue;
				const ratio = contrast(blend(fg, bg, fg[3] * t.opacity), bg);
				const need = sizeOf(t) >= shortSide * 0.03 ? 3 : 4.5;
				if (ratio < need) warn(out, "contrast", { frame, scene, message: `Text "${short(t.text)}" is hard to read: contrast ${ratio.toFixed(1)}:1 with the colour behind it (needs ${need}:1). Fix: make the text or its background lighter or darker.` }, t.text);
			}
		} finally {
			frameBox.style.transform = before;
			frameBox.style.transformOrigin = origin;
		}
	}
}

/** The motion pass draws at most this many frames for the whole video. */
const MOTION_SAMPLES = 360;

/** A short fingerprint of what is drawn (FNV-1a). */
function fingerprint(s: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
	return h >>> 0;
}

/** Text on screen, digits ignored (a counting number is still the same text). */
const textKey = (t: string) => t.replace(/\d/g, "#");

/**
 * Draws each scene every half second (less often for long videos) and looks for
 * stretches where nothing changes for more than 3 seconds, and for text that is
 * not on screen long enough to read (0.75 × (0.5 s + 0.3 s a word)).
 */
export async function motionPass(draw: (frame: number, scene: number) => void, frameBox: HTMLElement, timeline: ReturnType<typeof computeTimeline>, out: Out) {
	const { fps } = timeline;
	const step = Math.max(Math.round(fps / 2), Math.ceil(timeline.durationInFrames / MOTION_SAMPLES));
	for (const [scene, s] of timeline.scenes.entries()) {
		const end = s.from + s.durationInFrames;
		const samples: { frame: number; print: number; texts: Map<string, string> }[] = [];
		for (let f = s.from; f < end; f += step) {
			draw(f, scene);
			await tick();
			const box = frameBox.getBoundingClientRect();
			const texts = new Map<string, string>();
			for (const t of textRuns(frameBox, 120)) if (t.opacity > 0.3 && !t.math && overlap(t.rect, box) > 0) texts.set(textKey(t.text), t.text);
			samples.push({ frame: f, print: fingerprint(frameBox.innerHTML), texts });
			if (out.errors.length >= 20) return;
		}
		if (!samples.length) continue;
		// Nothing changes.
		for (let i = 1, start = 0; i <= samples.length; i++) {
			if (i < samples.length && samples[i]!.print === samples[start]!.print) continue;
			const still = samples[i - 1]!.frame - samples[start]!.frame;
			if (still > 3 * fps) {
				warn(out, "frozen", { frame: samples[start]!.frame, scene, message: `Nothing moves or changes for ${(still / fps).toFixed(1)} s (frames ${samples[start]!.frame} to ${samples[i - 1]!.frame}). Fix: keep long holds alive: reveal or highlight the next idea when the voice says it, or add slow motion (a drift, a scale, a moving accent).` });
				break;
			}
			start = i;
		}
		// Text too short to read. Its time on screen is at most the gap between the samples around it.
		const frameAt = (i: number) => (i < 0 ? s.from : i >= samples.length ? end : samples[i]!.frame);
		const keys = new Map<string, number[]>();
		samples.forEach((smp, i) => smp.texts.forEach((_, k) => keys.set(k, [...(keys.get(k) ?? []), i])));
		for (const [k, idx] of keys) {
			const words = k.split(" ").length;
			if (words < 3) continue;
			// A typewriter shows the start of a longer text first.
			if ([...keys.keys()].some((o) => o.length > k.length && o.startsWith(k))) continue;
			let longest = 0;
			for (let a = 0; a < idx.length; ) {
				let b = a;
				while (b + 1 < idx.length && idx[b + 1] === idx[b]! + 1) b++;
				longest = Math.max(longest, frameAt(idx[b]! + 1) - frameAt(idx[a]! - 1));
				a = b + 1;
			}
			const need = 0.75 * (0.5 + 0.3 * words) * fps;
			if (longest < need) {
				const first = samples[idx[0]!]!;
				warn(out, "brief", { frame: first.frame, scene, message: `Text "${short(first.texts.get(k)!)}" is on screen for at most ${(longest / fps).toFixed(1)} s; reading its ${words} words needs about ${(need / fps).toFixed(1)} s. Fix: keep it on screen longer, or use fewer words.` }, k);
			}
		}
	}
}
