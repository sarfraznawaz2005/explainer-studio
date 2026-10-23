import { interpolate, useCurrentFrame } from "remotion";
import type { PropsOf } from "../../../src/shared/plan/schema";
import { texture } from "../styles/styles";
import { highlight } from "./highlight";
import { appearStyle, SceneFrame, Surface, useActiveCue, useAppear, useLayout, useRevealAt, useScene, useStyle } from "./kit";
import { PieChart } from "./math-scenes";

const fmt = (v: number) => (Math.abs(v) >= 1000 ? v.toLocaleString("en-US", { maximumFractionDigits: 0 }) : String(Math.round(v * 10) / 10));

function Bar({ index, label, value, max, unit, highlighted, count }: { index: number; label: string; value: number; max: number; unit?: string; highlighted: boolean; count: number }) {
	const s = useStyle();
	const p = useAppear(useRevealAt(index), { damping: 16 });
	const tallest = useLayout().vertical ? 760 : 520;
	// Keep tiny values visible as a sliver so the bar is still readable.
	const h = (value > 0 ? Math.max(6, (value / max) * tallest) : 0) * p;
	const color = highlighted ? s.accent2 : s.accent;
	return (
		<div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", gap: 18, minWidth: 0 }}>
			<div style={{ fontSize: count > 8 ? 26 : 34, fontWeight: 700, opacity: p, color: highlighted ? s.accent2 : s.text, fontVariantNumeric: "tabular-nums" }}>
				{fmt(value * p)}
				{unit ? <span style={{ fontSize: "0.6em", color: s.muted, marginLeft: 6 }}>{unit}</span> : null}
			</div>
			<div
				style={{
					width: "70%",
					height: h,
					// One background value only: mixing background and backgroundImage lets React clear the gradient.
					background: s.hand ? `repeating-linear-gradient(45deg, ${color}55 0 6px, transparent 6px 18px)` : `linear-gradient(180deg, ${color}, ${color}cc)`,
					borderTop: s.hand ? `4px solid ${color}` : "none",
					borderLeft: s.hand ? `4px solid ${color}` : "none",
					borderRight: s.hand ? `4px solid ${color}` : "none",
					borderRadius: s.hand ? "6px 6px 0 0" : "14px 14px 4px 4px",
				}}
			/>
			<div style={{ fontSize: count > 8 ? 24 : 30, color: s.muted, textAlign: "center", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" }}>
				{label}
			</div>
		</div>
	);
}

function LineChart({ data, max, unit, highlight: hi }: { data: { label: string; value: number }[]; max: number; unit?: string; highlight?: number }) {
	const s = useStyle();
	const frame = useCurrentFrame();
	const { timed } = useScene();
	const W = 1500;
	const H = 520;
	const pts = data.map((d, i) => ({ x: (i / (data.length - 1)) * W, y: H - (Math.max(0, d.value) / max) * H }));
	// The line draws through each point as its reveal cue arrives.
	const reveals = data.map((_, i) => timed.cues.find((c) => c.action === "reveal" && c.target === i)?.frame ?? 0);
	let progress = 0;
	for (let i = 1; i < pts.length; i++) progress += interpolate(frame, [reveals[i - 1]!, Math.max(reveals[i - 1]! + 1, reveals[i]!)], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
	const total = pts.length - 1;
	const path = pts.map((p, i) => `${i ? "L" : "M"} ${p.x} ${p.y}`).join(" ");
	return (
		<svg viewBox={`-40 -60 ${W + 80} ${H + 140}`} style={{ width: "100%", flex: 1, overflow: "visible" }}>
			{[0.25, 0.5, 0.75, 1].map((f) => (
				<line key={f} x1={0} x2={W} y1={H - f * H} y2={H - f * H} stroke={s.surfaceBorder} strokeWidth={2} strokeDasharray="6 10" />
			))}
			<path d={path} fill="none" stroke={s.accent} strokeWidth={8} strokeLinecap="round" strokeLinejoin="round" pathLength={total} strokeDasharray={total} strokeDashoffset={total - progress} />
			{pts.map((p, i) => {
				const on = frame >= reveals[i]!;
				const big = i === hi;
				return (
					<g key={i} opacity={on ? 1 : 0}>
						<circle cx={p.x} cy={p.y} r={big ? 18 : 12} fill={big ? s.accent2 : s.bg} stroke={big ? s.accent2 : s.accent} strokeWidth={6} />
						<text x={p.x} y={p.y - 32} textAnchor="middle" fontSize={32} fontWeight={700} fill={big ? s.accent2 : s.text} fontFamily={s.bodyFont}>
							{fmt(data[i]!.value)}
							{unit ?? ""}
						</text>
						<text x={p.x} y={H + 56} textAnchor="middle" fontSize={28} fill={s.muted} fontFamily={s.bodyFont}>
							{data[i]!.label}
						</text>
					</g>
				);
			})}
		</svg>
	);
}

export function ChartScene({ heading, kind, unit, data, highlight: hi }: PropsOf<"chart">) {
	const s = useStyle();
	const max = Math.max(...data.map((d) => d.value), 1) * 1.08;
	const { stageH } = useLayout();
	if (kind === "pie")
		return (
			<SceneFrame heading={heading} center={!heading}>
				<div style={texture(s)}>
					<PieChart data={data} unit={unit} highlight={hi} height={stageH(heading)} />
				</div>
			</SceneFrame>
		);
	return (
		<SceneFrame heading={heading}>
			<div style={{ ...texture(s), flex: 1, display: "flex", alignItems: "stretch", gap: 18, borderBottom: kind === "bar" ? `3px solid ${s.surfaceBorder}` : undefined, paddingBottom: 0 }}>
				{kind === "bar" ? (
					data.map((d, i) => <Bar key={i} index={i} label={d.label} value={d.value} max={max} unit={unit} highlighted={i === hi} count={data.length} />)
				) : (
					<LineChart data={data} max={max} unit={unit} highlight={hi} />
				)}
			</div>
		</SceneFrame>
	);
}

export function CodeScene({ heading, language, code, steps }: PropsOf<"code">) {
	const s = useStyle();
	const lines = highlight(code, language);
	const active = useActiveCue("focus");
	const step = active >= 0 ? steps[active] : undefined;
	const box = useAppear(4, { damping: 200 });
	const focusAt = useRevealAt(Math.max(0, active), ["focus"]);
	const noteP = useAppear(step ? focusAt : null, { damping: 200 });
	const hasNotes = steps.some((st) => st.note);
	// Tall frames put the note under the code, so the code gets the full width.
	const { vertical, contentW } = useLayout();
	const side = hasNotes && !vertical;
	// Fit the longest line: monospace glyphs are about 0.6em wide. Code area width depends on the notes column.
	const codeWidth = side ? (contentW - 44) * (1.7 / 2.7) - 152 : contentW - 152;
	const longest = Math.max(1, ...lines.map((l) => l.reduce((n, t) => n + t.text.length, 0)));
	const size = Math.max(18, Math.min(lines.length > 16 ? 26 : lines.length > 11 ? 30 : 36, Math.floor(codeWidth / (0.6 * longest))));
	const color = (k: string) => (k === "text" ? s.code.text : s.code[k as keyof typeof s.code] as string);
	return (
		<SceneFrame heading={heading}>
			<div style={{ display: "flex", flexDirection: vertical ? "column" : "row", gap: 44, flex: vertical ? undefined : 1, minHeight: 0, alignItems: vertical ? "stretch" : "flex-start" }}>
				<div style={{ ...appearStyle(box, 24), flex: vertical ? undefined : 1.7, minWidth: 0 }}>
					<Surface bare={!s.dark && s.code.bg === "#16161d"} style={{ background: s.code.bg, padding: "34px 0", overflow: "hidden" }}>
						<div style={{ display: "flex", gap: 10, padding: "0 34px 22px" }}>
							{["#ff5f57", "#febc2e", "#28c840"].map((c) => (
								<div key={c} style={{ width: 16, height: 16, borderRadius: 99, background: s.hand ? s.surfaceBorder : c }} />
							))}
							<div style={{ marginLeft: "auto", fontSize: 22, color: s.code.comment, fontFamily: s.monoFont }}>{language}</div>
						</div>
						<div style={{ fontFamily: s.monoFont, fontSize: size, lineHeight: 1.6 }}>
							{lines.map((toks, i) => {
								const n = i + 1;
								const inFocus = !step || (n >= step.lines[0] && n <= step.lines[1]);
								return (
									<div key={i} style={{ display: "flex", padding: "0 34px", background: step && inFocus ? s.code.focus : "transparent", opacity: inFocus ? 1 : s.code.dim, whiteSpace: "pre" }}>
										<span style={{ width: 54, flexShrink: 0, color: s.code.comment, textAlign: "right", marginRight: 30, userSelect: "none" }}>{n}</span>
										<span>
											{toks.map((t, k) => (
												<span key={k} style={{ color: color(t.kind), fontStyle: t.kind === "comment" ? "italic" : undefined }}>
													{t.text}
												</span>
											))}
										</span>
									</div>
								);
							})}
						</div>
					</Surface>
				</div>
				<div style={{ ...texture(s), flex: vertical ? undefined : 1, minWidth: 0, minHeight: vertical ? 220 : undefined, display: hasNotes ? "flex" : "none", flexDirection: "column", gap: 20 }}>
					{step?.note ? (
						<div style={appearStyle(noteP, 20)}>
							<div style={{ fontSize: 26, letterSpacing: 3, color: s.accent, fontWeight: 700, marginBottom: 14 }}>
								STEP {active + 1} · LINE{step.lines[0] === step.lines[1] ? ` ${step.lines[0]}` : `S ${step.lines[0]}–${step.lines[1]}`}
							</div>
							<div style={{ fontSize: 42, lineHeight: 1.35 }}>{step.note}</div>
						</div>
					) : null}
				</div>
			</div>
		</SceneFrame>
	);
}
