import { interpolate, useCurrentFrame } from "remotion";
import type { PropsOf } from "../../../src/shared/plan/schema";
import { outline, texture } from "../styles/styles";
import { accentAt, appearStyle, borders, ease, ramp, SceneFrame, useAppear, useLayout, useRevealFrames, useStyle } from "./kit";

/* Algorithm trace (array boxes and pointers) and table build-up. */

type TraceStep = PropsOf<"trace">["steps"][number];
type Cell = number | string;

/** The array after each step: values by cell id, and which cell sits in each slot. */
export function traceStates(array: Cell[], steps: TraceStep[]): { values: Cell[]; order: number[] }[] {
	const states: { values: Cell[]; order: number[] }[] = [{ values: [...array], order: array.map((_, i) => i) }];
	for (const st of steps) {
		const prev = states.at(-1)!;
		const order = [...prev.order];
		const values = [...prev.values];
		if (st.swap) {
			const [a, b] = st.swap;
			[order[a], order[b]] = [order[b]!, order[a]!];
		}
		if (st.set) values[order[st.set.index]!] = st.set.value;
		states.push({ values, order });
	}
	return states;
}

export function TraceScene({ heading, array, steps }: PropsOf<"trace">) {
	const s = useStyle();
	const frame = useCurrentFrame();
	const frames = useRevealFrames(steps.length, ["focus"]);
	const { vertical, contentW: CONTENT_W, stageH } = useLayout();
	const H = vertical ? Math.min(stageH(heading), 900) : stageH(heading);
	const n = array.length;
	const gap = n <= 8 ? 18 : 12;
	// Boxes shrink to keep the row inside the width (tall frames are narrow).
	const box = Math.min(n <= 8 ? 140 : n <= 10 ? 120 : 104, Math.floor((CONTENT_W - (n - 1) * gap) / n));
	const rowW = n * box + (n - 1) * gap;
	const left = (CONTENT_W - rowW) / 2;
	const slotX = (slot: number) => left + slot * (box + gap);
	const rowY = Math.round(H * (vertical ? 0.3 : 0.24));
	// k = index of the current step (-1 before the first focus).
	const k = frames.filter((f) => f <= frame).length - 1;
	const states = traceStates(array, steps);
	const now = states[k + 1]!;
	const before = states[Math.max(0, k)]!;
	const step = k >= 0 ? steps[k] : undefined;
	const since = k >= 0 ? frame - frames[k]! : 0;
	const move = k >= 0 ? ease(ramp(since, 4, 24)) : 1;
	const slotOf = (order: number[], id: number) => order.indexOf(id);
	const prevStep = k > 0 ? steps[k - 1] : undefined;
	const intro = useAppear(0, { damping: 200 });
	const note = useAppear(k >= 0 ? frames[k]! + 4 : null, { damping: 200 });
	return (
		<SceneFrame heading={heading} center={!heading}>
			<div style={{ ...texture(s), position: "relative", width: CONTENT_W, height: H }}>
				{steps.length > 1 ? (
					<div style={{ position: "absolute", right: 0, top: 0, fontSize: 28, color: s.muted, fontVariantNumeric: "tabular-nums", opacity: k >= 0 ? 1 : 0 }}>
						Step {k + 1} of {steps.length}
					</div>
				) : null}
				{array.map((_, id) => {
					const from = slotOf(before.order, id);
					const to = slotOf(now.order, id);
					const slot = from + (to - from) * move;
					const swapped = from !== to;
					// Swapped cells hop over each other.
					const lift = swapped ? Math.sin(move * Math.PI) * (from < to ? -90 : 90) : 0;
					const inRange = !step?.range || (to >= step.range[0] && to <= step.range[1]);
					const comparing = !!step?.compare && step.compare.includes(to);
					const done = !!step?.done.includes(to);
					const found = step?.found === to;
					const setNow = step?.set?.index === to;
					const flash = setNow ? interpolate(since, [0, 6, 20], [0, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 0;
					const pulse = found ? 1 + 0.08 * Math.sin(Math.min(1, since / 12) * Math.PI) : 1;
					const fill = found ? s.positive : done ? `${s.positive}${s.hand ? "33" : "dd"}` : comparing ? `${s.accent2}22` : s.surface;
					const border = found || done ? s.positive : comparing ? s.accent2 : s.surfaceBorder;
					return (
						<div
							key={id}
							style={{
								position: "absolute",
								left: slotX(slot),
								top: rowY + lift - (comparing ? 10 : 0),
								width: box,
								height: box,
								opacity: intro * (inRange ? 1 : 0.28),
								transform: `scale(${pulse})`,
								display: "flex",
								alignItems: "center",
								justifyContent: "center",
								borderRadius: s.hand ? 8 : Math.min(22, s.radius),
								background: fill,
								...borders(`${comparing || found || done ? Math.max(4, s.line.width * 2) : Math.max(2, s.line.width)}px ${s.line.style} ${border}`),
								boxShadow: flash ? `0 0 0 ${10 * flash}px ${s.accent}55` : s.shadow,
								fontFamily: s.monoFont,
								fontWeight: 700,
								fontSize: box * 0.36,
								color: (found || done) && !s.hand ? s.onAccent : s.text,
							}}
						>
							{String(now.values[id])}
						</div>
					);
				})}
				{array.map((_, slot) => (
					<div key={slot} style={{ position: "absolute", left: slotX(slot), top: rowY + box + 12, width: box, textAlign: "center", fontFamily: s.monoFont, fontSize: 24, color: s.muted, opacity: intro }}>
						{slot}
					</div>
				))}
				{(step?.pointers ?? []).map((p, i) => {
					const old = prevStep?.pointers.find((q) => q.name === p.name);
					const sl = old ? old.index + (p.index - old.index) * ease(ramp(since, 0, 14)) : p.index;
					const twin = (step?.pointers ?? []).slice(0, i).filter((q) => q.index === p.index).length;
					const color = accentAt(s, i);
					const appear = old ? 1 : ramp(since, 0, 10);
					return (
						<div key={p.name} style={{ position: "absolute", left: slotX(sl), top: rowY + box + 52 + twin * 76, width: box, display: "flex", flexDirection: "column", alignItems: "center", opacity: appear }}>
							<svg width={30} height={26} style={{ overflow: "visible" }}>
								<path d="M15 2 L28 24 H2 Z" fill={color} />
							</svg>
							<div style={{ marginTop: 2, padding: "4px 14px", borderRadius: 999, background: s.hand ? "transparent" : color, border: s.hand ? `3px solid ${color}` : "none", color: s.hand ? color : s.onAccent, fontFamily: s.monoFont, fontSize: 26, fontWeight: 700 }}>{p.name}</div>
						</div>
					);
				})}
				{step?.found !== undefined ? (
					<div style={{ position: "absolute", left: slotX(step.found), top: rowY - 70, width: box, textAlign: "center", opacity: ramp(since, 6, 16) }}>
						<span style={{ padding: "6px 16px", borderRadius: 999, background: s.positive, color: s.onAccent, fontSize: 24, fontWeight: 800, letterSpacing: 2 }}>FOUND</span>
					</div>
				) : null}
				{step?.note ? (
					<div style={{ ...appearStyle(note, 14), position: "absolute", left: 0, right: 0, bottom: 10, textAlign: "center", fontSize: 44, lineHeight: 1.3 }}>
						{step.note}
					</div>
				) : null}
			</div>
		</SceneFrame>
	);
}

export function TableScene({ heading, columns, rows, highlight }: PropsOf<"table">) {
	const s = useStyle();
	const frame = useCurrentFrame();
	const frames = useRevealFrames(rows.length);
	const { vertical, contentW: CONTENT_W, stageH } = useLayout();
	const H = stageH(heading);
	// Tall frames: narrow columns, so smaller text and taller rows for wrapped words.
	const rowH = Math.min(vertical ? 120 : 92, (H - 100) / rows.length);
	const size = vertical ? (columns.length >= 4 ? 26 : columns.length === 3 ? 32 : 38) : columns.length >= 6 ? 28 : columns.length >= 4 ? 33 : 40;
	const padX = vertical ? 18 : 26;
	const head = useAppear(0, { damping: 200 });
	const hiOn = highlight && frames[highlight.row] !== undefined ? ramp(frame, frames[highlight.row]! + 14, frames[highlight.row]! + 24) : 0;
	const cellBorder = outline(s, s.surfaceBorder);
	return (
		<SceneFrame heading={heading} center={!heading}>
			<div style={{ ...texture(s), width: CONTENT_W, borderRadius: s.radius, overflow: "hidden", boxShadow: s.shadow, ...borders(cellBorder), background: s.surface }}>
				<div style={{ display: "flex", background: s.hand ? "transparent" : s.accent, color: s.hand ? s.accent : s.onAccent, opacity: head, borderBottom: s.hand ? `${s.line.width + 1}px ${s.line.style} ${s.accent}` : "none" }}>
					{columns.map((c, i) => (
						<div key={i} style={{ flex: 1, minWidth: 0, padding: `22px ${padX}px`, fontSize: size, fontWeight: 800, letterSpacing: s.hand ? 0 : 0.5 }}>
							{c}
						</div>
					))}
				</div>
				{rows.map((r, ri) => {
					const p = ramp(frame, frames[ri]!, frames[ri]! + 12);
					const rowHot = highlight?.row === ri && highlight.col === undefined;
					return (
						<div
							key={ri}
							style={{
								display: "flex",
								height: rowH,
								alignItems: "center",
								opacity: p,
								transform: `translateX(${(1 - ease(p)) * -40}px)`,
								background: rowHot && hiOn ? `${s.accent2}${s.dark ? "33" : "22"}` : ri % 2 ? (s.dark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.025)") : "transparent",
								borderTop: ri ? cellBorder : "none",
							}}
						>
							{columns.map((_, ci) => {
								const hot = highlight?.row === ri && highlight.col === ci;
								return (
									<div key={ci} style={{ flex: 1, minWidth: 0, height: "100%", display: "flex", alignItems: "center", padding: `0 ${padX}px`, fontSize: size, lineHeight: 1.2, fontWeight: ci === 0 ? 700 : 400, background: hot && hiOn ? `${s.accent2}${s.dark ? "44" : "2a"}` : "transparent", boxShadow: hot && hiOn ? `inset 0 0 0 ${4 * hiOn}px ${s.accent2}` : "none" }}>
										{r[ci] ?? ""}
									</div>
								);
							})}
						</div>
					);
				})}
			</div>
		</SceneFrame>
	);
}
