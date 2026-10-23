import { createElement, Fragment, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { Img, interpolate, interpolateColors, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { AnimState, PropsOf, SvgAnimation } from "../../../src/shared/plan/schema";
import { sanitizeSvg, viewBoxOf, type SvgNode } from "../../../src/shared/plan/svg";
import { msToFrames, type TimedScene } from "../../../src/shared/plan/timing";
import { outline, texture, type VisualStyle } from "../styles/styles";
import { accentAt, appearStyle, borders, CONTENT_W, ease, ramp, SceneFrame, sentenceFrame, stageHeight, useAppear, useRevealFrames, useScene, useStyle } from "./kit";

/* Source figure (Ken Burns + callouts), labelled diagram and svg-custom drawings. */

/* ---------- Safe SVG drawing ---------- */

/** Colour words the AI may use so drawings follow the visual style. */
function tokenColor(v: string, s: VisualStyle): string {
	const map: Record<string, string> = { accent: s.accent, accent2: s.accent2, accent3: s.accent3, positive: s.positive, ink: s.text, muted: s.muted, paper: s.surface, line: s.surfaceBorder, bg: s.bg };
	return map[v.trim()] ?? v;
}

const COLOR_ATTRS = new Set(["fill", "stroke", "stop-color", "flood-color"]);
const KEEP_NAMES = new Set(["viewBox", "preserveAspectRatio", "gradientUnits", "gradientTransform", "spreadMethod", "patternUnits", "patternContentUnits", "patternTransform", "clipPathUnits", "maskUnits", "maskContentUnits", "markerWidth", "markerHeight", "markerUnits", "refX", "refY", "stdDeviation", "filterUnits", "primitiveUnits", "pathLength", "textLength", "lengthAdjust"]);
const camel = (n: string) => (KEEP_NAMES.has(n) ? n : n.replace(/[-:]([a-z])/g, (_, c: string) => c.toUpperCase()));

const DEFAULTS = { opacity: 1, x: 0, y: 0, scale: 1, rotate: 0, draw: 1 };
type Live = { opacity: number; x: number; y: number; scale: number; rotate: number; draw: number; fill?: string; animated: Set<string> };

/** The animated state of one element at a frame: animations run in start order, each from its `from` to its `to`. */
export function animStateAt(anims: SvgAnimation[], frame: number, fps: number, timed: TimedScene): Live {
	const state: Live = { ...DEFAULTS, animated: new Set() };
	const timedAnims = anims
		.map((a) => ({ a, start: sentenceFrame(timed, a.at, a.edge, a.offsetMs, fps), dur: msToFrames(a.durationMs, fps) }))
		.sort((p, q) => p.start - q.start);
	const started = new Set<string>();
	for (const { a, start, dur } of timedAnims) {
		const keys = [...new Set([...Object.keys(a.from), ...Object.keys(a.to)])] as (keyof AnimState)[];
		keys.forEach((k) => state.animated.add(k));
		if (frame < start) {
			// Until its first animation starts, a property waits in that animation's starting state.
			for (const k of keys) if (!started.has(k)) applyKey(state, k, a.from[k] ?? a.to[k], undefined, 0);
			keys.forEach((k) => started.add(k));
			continue;
		}
		keys.forEach((k) => started.add(k));
		const raw = dur ? Math.min(1, (frame - start) / dur) : 1;
		const t = a.ease === "linear" ? raw : a.ease === "spring" ? spring({ frame: frame - start, fps, config: { damping: 12, mass: 0.6 }, durationInFrames: Math.max(1, dur) }) : ease(raw);
		for (const k of keys) applyKey(state, k, a.from[k], a.to[k], t);
	}
	return state;
}

function applyKey(state: Live, k: keyof AnimState, from: number | string | undefined, to: number | string | undefined, t: number) {
	if (k === "fill") {
		const f = (from as string | undefined) ?? state.fill;
		const g = (to as string | undefined) ?? f;
		state.fill = f && g ? interpolateColors(Math.min(1, Math.max(0, t)), [0, 1], [f, g]) : (g ?? f);
		return;
	}
	const cur = state[k] as number;
	const a = (from as number | undefined) ?? cur;
	const b = (to as number | undefined) ?? a;
	(state[k] as number) = a + (b - a) * t;
}

type DrawCtx = { s: VisualStyle; prefix: string; anims: Map<string, SvgAnimation[]>; frame: number; fps: number; timed: TimedScene };

function renderNode(n: SvgNode | string, key: number, ctx: DrawCtx, inheritedDraw?: number): ReactNode {
	if (typeof n === "string") return n;
	const props: Record<string, unknown> = { key };
	for (const [name, value] of Object.entries(n.attrs)) {
		let v = value;
		if (name === "id") v = `${ctx.prefix}-${value}`;
		else if (name === "href") v = `#${ctx.prefix}-${value.slice(1)}`;
		else v = v.replace(/url\(\s*['"]?#([\w-]+)['"]?\s*\)/g, (_, id: string) => `url(#${ctx.prefix}-${id})`);
		if (COLOR_ATTRS.has(name)) v = tokenColor(v, ctx.s);
		props[camel(name)] = v;
	}
	if (n.tag === "svg") {
		props.style = { fontFamily: ctx.s.bodyFont, overflow: "visible" } satisfies CSSProperties;
	}
	const anims = n.attrs.id ? ctx.anims.get(n.attrs.id) : undefined;
	const live = anims ? animStateAt(anims, ctx.frame, ctx.fps, ctx.timed) : null;
	const draw = live?.animated.has("draw") ? live.draw : inheritedDraw;
	const shape = ["path", "line", "polyline", "polygon", "rect", "circle", "ellipse"].includes(n.tag);
	if (draw !== undefined && shape) {
		props.pathLength = 1;
		props.strokeDasharray = 1;
		props.strokeDashoffset = 1 - draw;
	}
	if (live?.fill) props.fill = live.fill;
	const children = n.children.map((c, i) => renderNode(c, i, ctx, draw));
	const el = createElement(n.tag, props, ...children);
	if (!live || n.tag === "svg") return el;
	const style: CSSProperties = {
		opacity: live.opacity,
		transform: `translate(${live.x}px, ${live.y}px) rotate(${live.rotate}deg) scale(${live.scale})`,
		transformBox: "fill-box",
		transformOrigin: "center",
	};
	return (
		<g key={key} style={style}>
			{el}
		</g>
	);
}

/** Draws a sanitised SVG, fitted into a box. Invalid markup draws nothing (the plan schema already refuses it). */
export function SvgDrawing({ markup, animations = [], width, height, prefix }: { markup: string; animations?: SvgAnimation[]; width: number; height: number; prefix: string }) {
	const s = useStyle();
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	const { timed } = useScene();
	const parsed = useMemo(() => sanitizeSvg(markup), [markup]);
	const anims = useMemo(() => {
		const m = new Map<string, SvgAnimation[]>();
		for (const a of animations) m.set(a.target, [...(m.get(a.target) ?? []), a]);
		return m;
	}, [animations]);
	if (!parsed.ok) return null;
	const [, , vw, vh] = viewBoxOf(parsed.root);
	const scale = Math.min(width / vw, height / vh);
	const root: SvgNode = { ...parsed.root, attrs: { ...parsed.root.attrs, width: String(Math.round(vw * scale)), height: String(Math.round(vh * scale)) } };
	if (!root.attrs.viewBox) root.attrs.viewBox = `0 0 ${vw} ${vh}`;
	return <Fragment>{renderNode(root, 0, { s, prefix, anims, frame, fps, timed })}</Fragment>;
}

/** Safe id prefix for one scene's drawing (scene ids are short plain strings). */
const idPrefix = (sceneId: string) => `es-${sceneId.replace(/[^\w-]/g, "_")}`;

export function SvgScene({ heading, svg, animations, caption }: PropsOf<"svg">) {
	const s = useStyle();
	const { timed } = useScene();
	const H = stageHeight(heading) - (caption ? 70 : 0);
	const cap = useAppear(caption ? 20 : null, { damping: 200 });
	return (
		<SceneFrame heading={heading} center={!heading}>
			<div style={{ ...texture(s), display: "flex", flexDirection: "column", alignItems: "center", gap: 24 }}>
				<SvgDrawing markup={svg} animations={animations} width={CONTENT_W} height={H} prefix={idPrefix(timed.scene.id)} />
				{caption ? <div style={{ ...appearStyle(cap, 10), fontSize: 36, color: s.muted, textAlign: "center" }}>{caption}</div> : null}
			</div>
		</SceneFrame>
	);
}

/* ---------- Source figures ---------- */

function FigurePlaceholder({ file, width, height }: { file: string; width: number; height: number }) {
	const s = useStyle();
	return (
		<div style={{ width, height, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 18, borderRadius: s.radius, ...borders(`3px dashed ${s.surfaceBorder}`), color: s.muted, background: s.surface }}>
			<svg width={110} height={90} viewBox="0 0 110 90" fill="none" stroke={s.muted} strokeWidth={5} strokeLinejoin="round">
				<rect x={4} y={4} width={102} height={82} rx={10} />
				<circle cx={34} cy={30} r={10} />
				<path d="M 8 78 L 40 50 L 60 66 L 78 46 L 104 74" />
			</svg>
			<div style={{ fontSize: 30 }}>Figure {file}</div>
		</div>
	);
}

/** A source figure image; a placeholder when there is no figure folder or the file cannot be read. */
function FigureImage({ file, maxW, maxH }: { file: string; maxW: number; maxH: number }) {
	const { figureBase } = useScene();
	const [failed, setFailed] = useState(false);
	if (!figureBase || failed) return <FigurePlaceholder file={file} width={Math.min(maxW, 1200)} height={Math.min(maxH, 680)} />;
	return <Img src={`${figureBase}${encodeURIComponent(file)}`} onError={() => setFailed(true)} maxRetries={1} style={{ display: "block", maxWidth: maxW, maxHeight: maxH, width: "auto", height: "auto" }} />;
}

export function FigureScene({ figure, caption, callouts, focus }: PropsOf<"figure">) {
	const s = useStyle();
	const frame = useCurrentFrame();
	const { timed } = useScene();
	const frames = useRevealFrames(callouts.length);
	const H = stageHeight() - (caption ? 80 : 0);
	// Slow push-in (Ken Burns) towards the focus point, or the middle of the callouts.
	const fx = focus?.x ?? (callouts.length ? callouts.reduce((n, c) => n + c.x, 0) / callouts.length : 50);
	const fy = focus?.y ?? (callouts.length ? callouts.reduce((n, c) => n + c.y, 0) / callouts.length : 50);
	const zoom = 1 + ((focus?.zoom ?? 1.12) - 1) * ease(ramp(frame, 0, timed.durationInFrames));
	const intro = useAppear(0, { damping: 200 });
	const cap = useAppear(caption ? 14 : null, { damping: 200 });
	return (
		<SceneFrame center>
			<div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 26 }}>
				<div style={{ ...appearStyle(intro, 20), position: "relative", display: "inline-block", overflow: "hidden", borderRadius: Math.min(18, s.radius), ...borders(outline(s)), boxShadow: s.shadow, background: "#ffffff" }}>
					<div style={{ position: "relative", transform: `scale(${zoom})`, transformOrigin: `${fx}% ${fy}%` }}>
						<FigureImage file={figure} maxW={CONTENT_W - 60} maxH={H} />
						{callouts.map((c, i) => (
							<Callout key={i} index={i} at={frames[i]!} x={c.x} y={c.y} text={c.text} zoom={zoom} />
						))}
					</div>
				</div>
				{caption ? <div style={{ ...appearStyle(cap, 10), ...texture(s), fontSize: 34, color: s.muted, textAlign: "center", maxWidth: 1500 }}>{caption}</div> : null}
			</div>
		</SceneFrame>
	);
}

function Callout({ index, at, x, y, text, zoom }: { index: number; at: number; x: number; y: number; text: string; zoom: number }) {
	const s = useStyle();
	const frame = useCurrentFrame();
	const p = useAppear(at, { damping: 13 });
	const color = accentAt(s, index);
	const flip = x > 62;
	const ring = ((frame - at) % 45) / 45;
	if (frame < at) return null;
	return (
		<div style={{ position: "absolute", left: `${x}%`, top: `${y}%`, transform: `scale(${1 / zoom})`, transformOrigin: "0 0" }}>
			<div style={{ position: "absolute", left: -34, top: -34, width: 68, height: 68, borderRadius: 99, border: `3px solid ${color}`, opacity: (1 - ring) * 0.8, transform: `scale(${0.4 + ring * 0.8})` }} />
			<div style={{ position: "absolute", left: -22, top: -22, width: 44, height: 44, borderRadius: 99, background: color, color: s.onAccent, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, fontWeight: 800, transform: `scale(${p})`, boxShadow: "0 0 0 4px #ffffff" }}>{index + 1}</div>
			<div style={{ position: "absolute", top: -26, left: flip ? undefined : 36, right: flip ? 36 : undefined, opacity: p, whiteSpace: "nowrap", padding: "8px 18px", borderRadius: 12, background: "rgba(20,20,30,0.86)", color: "#ffffff", fontFamily: s.bodyFont, fontSize: 28, fontWeight: 600 }}>{text}</div>
		</div>
	);
}

/* ---------- Labelled diagram ---------- */

/** Label positions in a column: sorted by height, pushed apart so cards never overlap (percent of the picture). */
export function spreadLabels(ys: number[], gap = 13): number[] {
	const order = ys.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y);
	const out = new Array<number>(ys.length);
	let last = -Infinity;
	for (const o of order) {
		const y = Math.max(o.y, last + gap);
		out[o.i] = y;
		last = y;
	}
	// If the column ran off the bottom, shift it up.
	const over = Math.max(0, last - 96);
	return out.map((y) => Math.max(4, y - over));
}

export function DiagramScene({ heading, figure, svg, labels }: PropsOf<"diagram">) {
	const s = useStyle();
	const frame = useCurrentFrame();
	const { timed } = useScene();
	const frames = useRevealFrames(labels.length);
	const H = stageHeight(heading);
	const picW = 960;
	const picH = H - 30;
	const left = labels.map((l, i) => ({ l, i })).filter((o) => o.l.x < 50);
	const right = labels.map((l, i) => ({ l, i })).filter((o) => o.l.x >= 50);
	const ly = new Array<number>(labels.length);
	spreadLabels(left.map((o) => o.l.y)).forEach((y, j) => (ly[left[j]!.i] = y));
	spreadLabels(right.map((o) => o.l.y)).forEach((y, j) => (ly[right[j]!.i] = y));
	const intro = useAppear(0, { damping: 200 });
	const cardW = 300;
	return (
		<SceneFrame heading={heading} center={!heading}>
			<div style={{ ...texture(s), display: "flex", justifyContent: "center" }}>
				<div style={{ ...appearStyle(intro, 16), position: "relative", display: "inline-block" }}>
					{svg ? <SvgDrawing markup={svg} width={picW} height={picH} prefix={idPrefix(timed.scene.id)} /> : <FigureImage file={figure!} maxW={picW} maxH={picH} />}
					<svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible" }}>
						{labels.map((l, i) => {
							const draw = ramp(frame, frames[i]!, frames[i]! + 12);
							const edge = l.x < 50 ? -2 : 102;
							return <polyline key={i} points={`${l.x},${l.y} ${l.x < 50 ? Math.min(l.x, 4) : Math.max(l.x, 96)},${ly[i]} ${edge},${ly[i]}`} fill="none" stroke={accentAt(s, i)} strokeWidth={3} vectorEffect="non-scaling-stroke" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - draw} />;
						})}
					</svg>
					{labels.map((l, i) => (
						<DiagramLabel key={i} index={i} at={frames[i]!} x={l.x} y={l.y} cardY={ly[i]!} text={l.text} detail={l.detail} cardW={cardW} />
					))}
				</div>
			</div>
		</SceneFrame>
	);
}

function DiagramLabel({ index, at, x, y, cardY, text, detail, cardW }: { index: number; at: number; x: number; y: number; cardY: number; text: string; detail?: string; cardW: number }) {
	const s = useStyle();
	const frame = useCurrentFrame();
	const p = useAppear(at + 6, { damping: 15 });
	const dot = interpolate(frame - at, [0, 6, 12], [0, 1.3, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
	const color = accentAt(s, index);
	const onLeft = x < 50;
	return (
		<>
			<div style={{ position: "absolute", left: `${x}%`, top: `${y}%`, width: 20, height: 20, marginLeft: -10, marginTop: -10, borderRadius: 99, background: color, transform: `scale(${dot})`, boxShadow: `0 0 0 4px ${s.dark ? s.bg : "#ffffff"}` }} />
			<div style={{ position: "absolute", top: `${cardY}%`, width: cardW, left: onLeft ? -cardW - 24 : undefined, right: onLeft ? undefined : -cardW - 24, transform: `translateY(-50%) translateX(${(1 - p) * (onLeft ? -20 : 20)}px)`, opacity: p }}>
				<div style={{ background: s.surface, ...borders(outline(s, color)), borderRadius: Math.min(14, s.radius), padding: "12px 18px", boxShadow: s.shadow, textAlign: onLeft ? "right" : "left" }}>
					<div style={{ fontSize: 30, fontWeight: 800, color }}>{text}</div>
					{detail ? <div style={{ fontSize: 22, color: s.muted, lineHeight: 1.3, marginTop: 4 }}>{detail}</div> : null}
				</div>
			</div>
		</>
	);
}
