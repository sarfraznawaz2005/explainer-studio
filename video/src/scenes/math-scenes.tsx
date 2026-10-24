import "katex/dist/katex.min.css";
import { interpolate, useCurrentFrame } from "remotion";
import { parseMath } from "../../../src/shared/plan/math-expr";
import type { PropsOf } from "../../../src/shared/plan/schema";
import { texHtml } from "../../../src/shared/plan/tex";
import { texture, type VisualStyle } from "../styles/styles";
import { accentAt, appearStyle, ease, ramp, SceneFrame, Surface, useAppear, useLayout, useRevealFrames, useScene, useStyle } from "./kit";

/* Pie chart, number counter, equation derivation (KaTeX) and graph plot. */

const fmt = (v: number, decimals = 0) => v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

export const pieColors = (s: VisualStyle) => [s.accent, s.accent2, s.accent3, s.positive, `${s.accent}99`, `${s.accent2}99`, `${s.accent3}99`, `${s.positive}99`, s.muted, `${s.muted}88`, s.text, `${s.text}66`];

/** A donut slice from angle a0 to a1 (radians, 0 = up, clockwise). */
function slicePath(cx: number, cy: number, r: number, inner: number, a0: number, a1: number): string {
	const pt = (a: number, rr: number) => [cx + Math.sin(a) * rr, cy - Math.cos(a) * rr];
	const large = a1 - a0 > Math.PI ? 1 : 0;
	const [x0, y0] = pt(a0, r);
	const [x1, y1] = pt(a1, r);
	const [x2, y2] = pt(a1, inner);
	const [x3, y3] = pt(a0, inner);
	return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} L ${x2} ${y2} A ${inner} ${inner} 0 ${large} 0 ${x3} ${y3} Z`;
}

export function PieChart({ data, unit, highlight: hi, height }: { data: { label: string; value: number }[]; unit?: string; highlight?: number; height: number }) {
	const s = useStyle();
	const frame = useCurrentFrame();
	const frames = useRevealFrames(data.length);
	const colors = pieColors(s);
	const total = data.reduce((n, d) => n + Math.max(0, d.value), 0) || 1;
	const { vertical, contentW } = useLayout();
	// Tall frames: the donut on top, the legend under it.
	const legendH = vertical ? data.length * (data.length > 7 ? 54 : 70) + 40 : 0;
	const pieH = vertical ? Math.min(contentW, height - legendH) : height;
	const R = Math.min(pieH / 2 - 20, vertical ? 400 : 320);
	const cx = vertical ? contentW / 2 : R + 40;
	const cy = pieH / 2;
	let acc = 0;
	const slices = data.map((d, i) => {
		const a0 = (acc / total) * Math.PI * 2;
		acc += Math.max(0, d.value);
		const a1 = (acc / total) * Math.PI * 2;
		const grow = ease(ramp(frame, frames[i]!, frames[i]! + 18));
		return { a0, a1: a0 + (a1 - a0) * grow, full: a1, i, on: grow > 0 };
	});
	const hiOut = hi !== undefined && frames[hi] !== undefined ? ease(ramp(frame, frames[hi]! + 18, frames[hi]! + 30)) : 0;
	const centre = hi !== undefined && data[hi] ? `${Math.round((Math.max(0, data[hi]!.value) / total) * 100)}%` : `${fmt(total)}${unit ? ` ${unit}` : ""}`;
	return (
		<div style={{ position: "relative", width: contentW, height: vertical ? undefined : height, display: "flex", flexDirection: vertical ? "column" : "row", alignItems: vertical ? "stretch" : "center", gap: vertical ? 40 : 0 }}>
			<svg width={cx * 2} height={pieH} style={{ flexShrink: 0, overflow: "visible" }}>
				{slices.map((sl) => {
					if (!sl.on) return null;
					const mid = (sl.a0 + sl.full) / 2;
					const out = sl.i === hi ? hiOut * 26 : 0;
					const c = colors[sl.i % colors.length]!;
					return (
						<path
							key={sl.i}
							d={slicePath(cx, cy, R, R * 0.52, sl.a0, Math.max(sl.a0 + 0.001, sl.a1))}
							transform={`translate(${Math.sin(mid) * out} ${-Math.cos(mid) * out})`}
							fill={s.hand ? `${c}33` : c}
							stroke={s.hand ? c : s.bg}
							strokeWidth={s.hand ? 4 : 4}
						/>
					);
				})}
				<text x={cx} y={cy + 4} textAnchor="middle" dominantBaseline="middle" fontFamily={s.headingFont} fontWeight={800} fontSize={hi !== undefined ? 76 : 56} fill={hi !== undefined ? colors[hi % colors.length] : s.text} opacity={frame >= (frames.at(-1) ?? 0) ? 1 : 0}>
					{centre}
				</text>
			</svg>
			<div style={{ marginLeft: vertical ? 0 : 70, display: "flex", flexDirection: "column", gap: data.length > 7 ? 12 : 20, flex: vertical ? undefined : 1, minWidth: 0 }}>
				{data.map((d, i) => (
					<PieRow key={i} at={frames[i]!} color={colors[i % colors.length]!} label={d.label} value={d.value} pct={(Math.max(0, d.value) / total) * 100} unit={unit} hot={i === hi} compact={data.length > 7} />
				))}
			</div>
		</div>
	);
}

function PieRow({ at, color, label, value, pct, unit, hot, compact }: { at: number; color: string; label: string; value: number; pct: number; unit?: string; hot: boolean; compact: boolean }) {
	const s = useStyle();
	const p = useAppear(at);
	return (
		<div style={{ ...appearStyle(p, 14, s.motion), display: "flex", alignItems: "center", gap: 22, fontSize: compact ? 30 : 38 }}>
			<div style={{ width: compact ? 26 : 32, height: compact ? 26 : 32, borderRadius: s.hand ? 99 : 8, background: color, flexShrink: 0 }} />
			<div style={{ flex: 1, minWidth: 0, fontWeight: hot ? 800 : 500, color: hot ? color : s.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</div>
			<div style={{ fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>
				{fmt(value, Number.isInteger(value) ? 0 : 1)}
				{unit ? <span style={{ fontSize: "0.65em", color: s.muted, marginLeft: 6 }}>{unit}</span> : null}
			</div>
			<div style={{ width: 120, textAlign: "right", color: s.muted, fontVariantNumeric: "tabular-nums" }}>{Math.round(pct)}%</div>
		</div>
	);
}

function Counter({ index, at, value, from, label, prefix, unit, decimals, count }: PropsOf<"counter">["counters"][number] & { index: number; at: number; count: number }) {
	const s = useStyle();
	const frame = useCurrentFrame();
	const p = useAppear(at, { damping: 15 });
	const t = 1 - Math.pow(1 - ramp(frame, at + 4, at + 46), 3);
	const v = from + (value - from) * t;
	const color = accentAt(s, index);
	const { vertical } = useLayout();
	// Tall frames stack the counters, so each keeps the full width.
	const size = vertical ? (count === 1 ? 170 : count === 2 ? 140 : count === 3 ? 110 : 90) : count === 1 ? 190 : count === 2 ? 150 : count === 3 ? 116 : 94;
	const roomy = vertical || count <= 2;
	return (
		<div style={{ ...appearStyle(p, 30, s.motion), flex: 1, minWidth: 0 }}>
			<Surface edge={{ side: "top", color }} style={{ padding: vertical && count > 2 ? "30px 40px" : roomy ? "56px 50px" : "46px 30px", textAlign: "center" }}>
				<div style={{ fontFamily: s.headingFont, fontWeight: 800, fontSize: size, lineHeight: 1, color, fontVariantNumeric: "tabular-nums", letterSpacing: s.hand ? 0 : -size * 0.03, whiteSpace: "nowrap" }}>
					{prefix ?? ""}
					{fmt(v, decimals)}
					{unit ? <span style={{ fontSize: "0.42em", marginLeft: 10, color: s.muted, letterSpacing: 0 }}>{unit}</span> : null}
				</div>
				<div style={{ marginTop: vertical && count > 2 ? 16 : 28, fontSize: roomy ? 40 : 32, lineHeight: 1.3, color: s.text }}>{label}</div>
			</Surface>
		</div>
	);
}

export function CounterScene({ heading, counters }: PropsOf<"counter">) {
	const s = useStyle();
	const frames = useRevealFrames(counters.length);
	const { vertical } = useLayout();
	return (
		<SceneFrame heading={heading} center={!heading}>
			<div style={{ ...texture(s), display: "flex", flexDirection: vertical ? "column" : "row", gap: counters.length > 2 ? 30 : 50, alignItems: "stretch", margin: "auto 0" }}>
				{counters.map((c, i) => (
					<Counter key={i} index={i} at={frames[i]!} count={counters.length} {...c} />
				))}
			</div>
		</SceneFrame>
	);
}

function EquationLine({ tex, note, at, current, size, stacked }: { tex: string; note?: string; at: number; current: boolean; size: number; stacked: boolean }) {
	const s = useStyle();
	const p = useAppear(at, { damping: 200 });
	const html = texHtml(tex);
	const cell = { ...appearStyle(p, 22, s.motion), opacity: p * (current ? 1 : 0.5) };
	if (stacked)
		// Tall frames: the note goes under its formula.
		return (
			<div style={{ ...cell, display: "flex", gap: 30 }}>
				<div style={{ width: 8, flexShrink: 0, borderRadius: 8, background: current ? s.accent : "transparent" }} />
				<div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 8 }}>
					{/* KaTeX output: made by KaTeX from a checked formula with trust off, never from raw plan text. */}
					<div className="es-tex" style={{ fontSize: size, color: s.text }} dangerouslySetInnerHTML={{ __html: html }} />
					{note ? <div style={{ fontSize: Math.max(32, size * 0.62), color: current ? s.accent : s.muted, lineHeight: 1.3, fontFamily: s.bodyFont }}>{note}</div> : null}
				</div>
			</div>
		);
	return (
		<>
			<div style={{ ...cell, width: 8, alignSelf: "stretch", borderRadius: 8, background: current ? s.accent : "transparent" }} />
			{/* KaTeX output: made by KaTeX from a checked formula with trust off, never from raw plan text. */}
			<div className="es-tex" style={{ ...cell, fontSize: size, color: s.text }} dangerouslySetInnerHTML={{ __html: html }} />
			<div style={{ ...cell, fontSize: size * 0.62, color: current ? s.accent : s.muted, lineHeight: 1.3, fontFamily: s.bodyFont }}>{note ?? ""}</div>
		</>
	);
}

export function EquationScene({ heading, steps }: PropsOf<"equation">) {
	const s = useStyle();
	const frame = useCurrentFrame();
	const frames = useRevealFrames(steps.length);
	const current = Math.max(0, frames.filter((f) => f <= frame).length - 1);
	const notes = steps.some((st) => st.note);
	const longest = Math.max(...steps.map((st) => st.tex.length));
	// Long formulas next to notes get a smaller size so both fit on the line.
	const base = steps.length > 5 ? 40 : steps.length > 3 ? 48 : 58;
	const { vertical, contentW } = useLayout();
	// Tall frames: a formula has the full width but it is narrow, so long ones get smaller (about 0.2em per TeX source character; commands draw little).
	const size = vertical ? Math.max(34, Math.min(Math.round(base * 1.3), Math.floor((contentW - 40) / (0.2 * longest)))) : notes && longest > 50 ? Math.round(base * 0.82) : base;
	return (
		<SceneFrame heading={heading} center={!heading}>
			<style>{".es-tex .katex-display{margin:0;text-align:left}.es-tex .katex-display>.katex{text-align:left}"}</style>
			{vertical ? (
				<div style={{ ...texture(s), display: "flex", flexDirection: "column", gap: steps.length > 4 ? 28 : 44, margin: "auto 0" }}>
					{steps.map((st, i) => (
						<EquationLine key={i} tex={st.tex} note={st.note} at={frames[i]!} current={i === current} size={size} stacked />
					))}
				</div>
			) : (
				<div style={{ ...texture(s), display: "grid", gridTemplateColumns: notes ? "8px max-content minmax(260px, 1fr)" : "8px max-content 0", columnGap: 40, rowGap: steps.length > 5 ? 10 : 22, alignItems: "center", margin: "auto 0" }}>
					{steps.map((st, i) => (
						<EquationLine key={i} tex={st.tex} note={st.note} at={frames[i]!} current={i === current} size={size} stacked={false} />
					))}
				</div>
			)}
		</SceneFrame>
	);
}

/** Nice tick step for a range: 1, 2 or 5 times a power of ten. */
export function tickStep(span: number, target = 8): number {
	const raw = span / target;
	const pow = Math.pow(10, Math.floor(Math.log10(raw)));
	const m = raw / pow;
	return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * pow;
}

/** y range that fits the curves, ignoring spikes (tan, 1/x). */
export function fitY(fns: ((x: number) => number)[], x0: number, x1: number): [number, number] {
	const ys: number[] = [];
	for (const f of fns)
		for (let i = 0; i <= 200; i++) {
			const v = f(x0 + ((x1 - x0) * i) / 200);
			if (Number.isFinite(v)) ys.push(v);
		}
	if (!ys.length) return [-5, 5];
	ys.sort((a, b) => a - b);
	let lo = ys[Math.floor(ys.length * 0.03)]!;
	let hi = ys[Math.ceil(ys.length * 0.97) - 1]!;
	if (hi - lo < 1e-9) {
		lo -= 1;
		hi += 1;
	}
	const pad = (hi - lo) * 0.12;
	return [lo - pad, hi + pad];
}

export function GraphScene({ heading, functions, x, y, points, tracer, xLabel, yLabel }: PropsOf<"graph">) {
	const s = useStyle();
	const frame = useCurrentFrame();
	const { timed } = useScene();
	const frames = useRevealFrames(functions.length + points.length);
	const fns = functions.map((f) => {
		const r = parseMath(f.expr);
		return r.ok ? r.fn : () => NaN;
	});
	const [x0, x1] = x;
	const [y0, y1] = y ?? fitY(fns, x0, x1);
	const { vertical, contentW, stageH } = useLayout();
	const W = contentW - 120;
	// Tall frames: a plot about as tall as it is wide, not the full height.
	const H = vertical ? Math.min(stageH(heading) - 80, Math.round(W * 1.15)) : stageH(heading) - 80;
	const L = 90;
	const T = 20;
	const sx = (v: number) => L + ((v - x0) / (x1 - x0)) * W;
	const sy = (v: number) => T + H - ((v - y0) / (y1 - y0)) * H;
	const colors = [s.accent, s.accent2, s.accent3];
	// Each curve is sampled; jumps out of range start a new piece (so tan(x) does not draw vertical lines).
	const curve = (f: (x: number) => number) => {
		const N = 360;
		let d = "";
		let pen = false;
		for (let i = 0; i <= N; i++) {
			const xv = x0 + ((x1 - x0) * i) / N;
			const yv = f(xv);
			const ok = Number.isFinite(yv) && yv > y0 - (y1 - y0) * 2 && yv < y1 + (y1 - y0) * 2;
			if (!ok) {
				pen = false;
				continue;
			}
			d += `${pen ? "L" : "M"} ${sx(xv).toFixed(1)} ${sy(yv).toFixed(1)} `;
			pen = true;
		}
		return d;
	};
	const xs = tickStep(x1 - x0);
	const ys = tickStep(y1 - y0, 6);
	const ticks = (a: number, b: number, step: number) => {
		const out: number[] = [];
		for (let v = Math.ceil(a / step) * step; v <= b + 1e-9; v += step) out.push(Math.round(v / step) * step);
		return out;
	};
	const axisX = y0 <= 0 && y1 >= 0 ? sy(0) : T + H;
	const axisY = x0 <= 0 && x1 >= 0 ? sx(0) : L;
	const axes = useAppear(0, { damping: 200 });
	const lastFn = functions.length - 1;
	const traceFrom = (frames[lastFn] ?? 0) + 30;
	const traceTo = timed.durationInFrames - 20;
	const tx = x0 + (x1 - x0) * ease(ramp(frame, traceFrom, traceTo));
	const ty = fns[lastFn]!(tx);
	const label = (v: number) => (Math.abs(v) >= 1000 || (Math.abs(v) < 0.01 && v !== 0) ? v.toExponential(1) : String(Math.round(v * 100) / 100));
	return (
		<SceneFrame heading={heading} center={!heading}>
			<div style={{ ...texture(s), position: "relative" }}>
				<svg width={contentW} height={H + 80} style={{ overflow: "visible", fontFamily: s.bodyFont }}>
					<clipPath id={`plot-${timed.scene.id}`}>
						<rect x={L} y={T} width={W} height={H} />
					</clipPath>
					<g opacity={axes}>
						{ticks(x0, x1, xs).map((v) => (
							<g key={`x${v}`}>
								<line x1={sx(v)} x2={sx(v)} y1={T} y2={T + H} stroke={s.surfaceBorder} strokeWidth={1.5} opacity={0.6} />
								<text x={sx(v)} y={Math.min(T + H, axisX) + 36} textAnchor="middle" fontSize={24} fill={s.muted}>
									{label(v)}
								</text>
							</g>
						))}
						{ticks(y0, y1, ys).map((v) => (
							<g key={`y${v}`}>
								<line x1={L} x2={L + W} y1={sy(v)} y2={sy(v)} stroke={s.surfaceBorder} strokeWidth={1.5} opacity={0.6} />
								<text x={Math.max(L, axisY) - 14} y={sy(v) + 8} textAnchor="end" fontSize={24} fill={s.muted}>
									{label(v)}
								</text>
							</g>
						))}
						<line x1={L} x2={L + W} y1={axisX} y2={axisX} stroke={s.text} strokeWidth={3} />
						<line x1={axisY} x2={axisY} y1={T} y2={T + H} stroke={s.text} strokeWidth={3} />
						<text x={L + W} y={axisX - 16} textAnchor="end" fontSize={30} fontStyle="italic" fill={s.text}>
							{xLabel ?? "x"}
						</text>
						<text x={axisY + 16} y={T + 30} fontSize={30} fontStyle="italic" fill={s.text}>
							{yLabel ?? "y"}
						</text>
					</g>
					<g clipPath={`url(#plot-${timed.scene.id})`}>
						{functions.map((_, i) => {
							const draw = ease(ramp(frame, frames[i]!, frames[i]! + 40));
							return <path key={i} d={curve(fns[i]!)} fill="none" stroke={colors[i]} strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - draw} />;
						})}
					</g>
					{functions.map((f, i) => {
						const on = ramp(frame, frames[i]! + 30, frames[i]! + 42);
						const lx = x0 + (x1 - x0) * (0.88 - i * 0.1);
						const lv = fns[i]!(lx);
						if (!Number.isFinite(lv) || lv < y0 || lv > y1) return null;
						return (
							<text key={i} x={sx(lx)} y={sy(lv) - 22} textAnchor="middle" fontSize={32} fontWeight={700} fill={colors[i]} opacity={on}>
								{f.label ?? `y = ${f.expr}`}
							</text>
						);
					})}
					{points.map((pt, k) => {
						const at = frames[functions.length + k]!;
						const p = interpolate(frame - at, [0, 8, 14], [0, 1.25, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
						const pv = fns[pt.fn]!(pt.x);
						if (!Number.isFinite(pv)) return null;
						return (
							<g key={k} opacity={Math.min(1, p)}>
								<line x1={sx(pt.x)} x2={sx(pt.x)} y1={sy(pv)} y2={axisX} stroke={colors[pt.fn]} strokeWidth={2} strokeDasharray="6 8" />
								<circle cx={sx(pt.x)} cy={sy(pv)} r={13 * p} fill={s.bg} stroke={colors[pt.fn]} strokeWidth={6} />
								<text x={sx(pt.x) + 22} y={sy(pv) - 18} fontSize={30} fontWeight={700} fill={s.text}>
									{pt.label ?? `(${label(pt.x)}, ${label(pv)})`}
								</text>
							</g>
						);
					})}
					{tracer && frame >= traceFrom && Number.isFinite(ty) && ty >= y0 && ty <= y1 ? (
						<g>
							<circle cx={sx(tx)} cy={sy(ty)} r={16} fill={colors[lastFn]} opacity={0.25} />
							<circle cx={sx(tx)} cy={sy(ty)} r={9} fill={colors[lastFn]} />
							<text x={sx(tx)} y={sy(ty) + (sy(ty) < T + 60 ? 52 : -26)} textAnchor="middle" fontSize={26} fill={s.text} fontWeight={600}>
								({label(tx)}, {label(ty)})
							</text>
						</g>
					) : null}
				</svg>
			</div>
		</SceneFrame>
	);
}
