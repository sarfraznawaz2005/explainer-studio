import { AbsoluteFill, interpolate, Sequence, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { TestCardProps } from "./compositions";

const INDIGO = "#6366f1";
const VIOLET = "#a855f7";
const FONT = "Inter, 'Segoe UI', system-ui, sans-serif";

/** Ten seconds that exercise the things real scenes use: springs, staggered reveals, SVG strokes and text. */
export function TestCard({ title, subtitle }: TestCardProps) {
	const frame = useCurrentFrame();
	const { fps, durationInFrames } = useVideoConfig();

	const enter = spring({ frame, fps, config: { damping: 200 } });
	const exit = interpolate(frame, [durationInFrames - 20, durationInFrames], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
	const glow = interpolate(frame, [0, durationInFrames], [0, 360]);

	return (
		<AbsoluteFill style={{ background: "#0c0c0f", fontFamily: FONT, color: "#ececf1", opacity: exit }}>
			<AbsoluteFill
				style={{
					background: `radial-gradient(60% 60% at 50% 40%, ${INDIGO}33, transparent 70%), conic-gradient(from ${glow}deg at 50% 50%, ${INDIGO}14, ${VIOLET}14, ${INDIGO}14)`,
				}}
			/>
			<AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 28 }}>
				<div
					style={{
						fontSize: 120,
						fontWeight: 700,
						letterSpacing: -4,
						transform: `translateY(${(1 - enter) * 40}px)`,
						opacity: enter,
					}}
				>
					{title}
				</div>
				<div style={{ fontSize: 44, color: "#9a9aa6", opacity: interpolate(frame, [12, 30], [0, 1], { extrapolateRight: "clamp" }) }}>{subtitle}</div>
				<Sequence from={30} layout="none">
					<Bars />
				</Sequence>
			</AbsoluteFill>
			<Sequence from={60} layout="none">
				<Ring />
			</Sequence>
			<Clock />
		</AbsoluteFill>
	);
}

function Bars() {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	const values = [0.45, 0.8, 0.6, 1, 0.7];
	return (
		<div style={{ display: "flex", alignItems: "flex-end", gap: 18, height: 180, marginTop: 30 }}>
			{values.map((v, i) => {
				const s = spring({ frame: frame - i * 6, fps, config: { damping: 14, mass: 0.6 } });
				return (
					<div
						key={i}
						style={{
							width: 56,
							height: 180 * v * s,
							borderRadius: 12,
							background: `linear-gradient(180deg, ${VIOLET}, ${INDIGO})`,
						}}
					/>
				);
			})}
		</div>
	);
}

function Ring() {
	const frame = useCurrentFrame();
	const { durationInFrames } = useVideoConfig();
	const r = 70;
	const c = 2 * Math.PI * r;
	const done = interpolate(frame, [0, durationInFrames - 30], [0, 1], { extrapolateRight: "clamp" });
	return (
		<svg width={180} height={180} style={{ position: "absolute", right: 90, bottom: 80 }}>
			<circle cx={90} cy={90} r={r} fill="none" stroke="#24242c" strokeWidth={12} />
			<circle
				cx={90}
				cy={90}
				r={r}
				fill="none"
				stroke={INDIGO}
				strokeWidth={12}
				strokeLinecap="round"
				strokeDasharray={c}
				strokeDashoffset={c * (1 - done)}
				transform="rotate(-90 90 90)"
			/>
			<text x={90} y={102} textAnchor="middle" fill="#ececf1" fontSize={34} fontWeight={600} fontFamily={FONT}>
				{Math.round(done * 100)}%
			</text>
		</svg>
	);
}

function Clock() {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	return (
		<div style={{ position: "absolute", left: 90, bottom: 90, fontSize: 32, color: "#63636e", fontVariantNumeric: "tabular-nums" }}>
			{(frame / fps).toFixed(1)}s · frame {frame}
		</div>
	);
}
