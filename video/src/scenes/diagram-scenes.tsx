import { interpolate, useCurrentFrame } from "remotion";
import type { PropsOf } from "../../../src/shared/plan/schema";
import { texture } from "../styles/styles";
import { ACCENTS, appearStyle, SceneFrame, Surface, useAppear, useRevealAt, useStyle } from "./kit";

function Arrow({ at, vertical }: { at: number; vertical: boolean }) {
	const s = useStyle();
	const frame = useCurrentFrame();
	const draw = interpolate(frame, [at - 10, at], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
	const len = vertical ? 44 : 70;
	return (
		<svg width={vertical ? 40 : len + 20} height={vertical ? len + 20 : 40} style={{ flexShrink: 0, alignSelf: "center", overflow: "visible", transform: vertical ? "rotate(90deg)" : undefined }}>
			<path d={`M4 20 H ${len}`} stroke={s.muted} strokeWidth={5} strokeLinecap="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - draw} />
			<path d={`M ${len - 14} 8 L ${len + 4} 20 L ${len - 14} 32`} stroke={s.muted} strokeWidth={5} fill="none" strokeLinecap="round" strokeLinejoin="round" opacity={draw > 0.9 ? 1 : 0} />
		</svg>
	);
}

function Step({ index, label, detail, vertical, count }: { index: number; label: string; detail?: string; vertical: boolean; count: number }) {
	const s = useStyle();
	const at = useRevealAt(index);
	const p = useAppear(at);
	const color = ACCENTS(s)[index % 4]!;
	const compact = !vertical && count > 4;
	return (
		<>
			{index > 0 ? <Arrow at={at} vertical={vertical} /> : null}
			<div style={{ ...appearStyle(p, 30), flex: vertical ? undefined : 1, minWidth: 0, display: "flex" }}>
				<Surface edge={{ side: vertical ? "left" : "top", color }} style={{ flex: 1, padding: compact ? "30px 26px" : "36px 40px" }}>
					<div style={{ display: "flex", flexDirection: vertical ? "row" : "column", gap: vertical ? 30 : 16, alignItems: vertical ? "center" : "flex-start" }}>
						<div style={{ fontSize: 28, fontWeight: 700, color, letterSpacing: 2 }}>STEP {index + 1}</div>
						<div style={{ fontSize: compact ? 38 : 46, fontWeight: 700, lineHeight: 1.15 }}>{label}</div>
						{detail ? <div style={{ fontSize: compact ? 27 : 32, color: s.muted, lineHeight: 1.35 }}>{detail}</div> : null}
					</div>
				</Surface>
			</div>
		</>
	);
}

export function FlowScene({ heading, steps, direction }: PropsOf<"flow">) {
	const s = useStyle();
	const vertical = direction === "vertical";
	return (
		<SceneFrame heading={heading} center={!heading}>
			<div
				style={{
					...texture(s),
					display: "flex",
					flexDirection: vertical ? "column" : "row",
					alignItems: "stretch",
					gap: vertical ? 10 : 18,
					margin: "auto 0",
				}}
			>
				{steps.map((st, i) => (
					<Step key={i} index={i} label={st.label} detail={st.detail} vertical={vertical} count={steps.length} />
				))}
			</div>
		</SceneFrame>
	);
}

function Column({ side, title, points, color }: { side: 0 | 1; title: string; points: string[]; color: string }) {
	const s = useStyle();
	const at = useRevealAt(side);
	const p = useAppear(at);
	return (
		<div style={{ ...appearStyle(p, 40), flex: 1, minWidth: 0 }}>
			<Surface style={{ padding: "44px 52px", height: "100%" }}>
				<div style={{ fontFamily: s.headingFont, fontSize: 56, fontWeight: s.headingWeight, color, marginBottom: 32 }}>{title}</div>
				<div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
					{points.map((pt, i) => (
						<PointRow key={i} at={at + 8 + i * 6} color={color} text={pt} />
					))}
				</div>
			</Surface>
		</div>
	);
}

function PointRow({ at, color, text }: { at: number; color: string; text: string }) {
	const p = useAppear(at);
	return (
		<div style={{ ...appearStyle(p, 14), display: "flex", gap: 22, alignItems: "flex-start", fontSize: 40, lineHeight: 1.3 }}>
			<div style={{ flexShrink: 0, width: 16, height: 16, borderRadius: 99, background: color, marginTop: 16 }} />
			<div>{text}</div>
		</div>
	);
}

export function CompareScene({ heading, left, right, verdict }: PropsOf<"compare">) {
	const s = useStyle();
	const rightAt = useRevealAt(1);
	const vs = useAppear(rightAt - 6, { damping: 12 });
	const verdictP = useAppear(verdict ? rightAt + 30 : null);
	return (
		<SceneFrame heading={heading}>
			<div style={{ ...texture(s), display: "flex", flexDirection: "column", gap: 36, flex: 1, minHeight: 0 }}>
				<div style={{ display: "flex", gap: 40, alignItems: "stretch", position: "relative" }}>
					<Column side={0} title={left.title} points={left.points} color={s.accent} />
					<div
						style={{
							position: "absolute",
							left: "50%",
							top: "50%",
							transform: `translate(-50%, -50%) scale(${vs})`,
							width: 96,
							height: 96,
							borderRadius: 99,
							background: s.dark ? s.bg : s.text,
							color: s.dark ? s.accent2 : s.bg,
							border: s.dark ? `4px solid ${s.accent2}` : "none",
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							fontSize: 36,
							fontWeight: 800,
							zIndex: 2,
						}}
					>
						VS
					</div>
					<Column side={1} title={right.title} points={right.points} color={s.accent2} />
				</div>
				{verdict ? (
					<div style={{ ...appearStyle(verdictP, 16), fontSize: 40, textAlign: "center", color: s.muted }}>
						<span style={{ color: s.positive, fontWeight: 700 }}>In short: </span>
						{verdict}
					</div>
				) : null}
			</div>
		</SceneFrame>
	);
}
