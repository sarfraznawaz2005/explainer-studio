import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import type { PropsOf } from "../../../src/shared/plan/schema";
import { texture } from "../styles/styles";
import { ACCENTS, appearStyle, SceneFrame, Surface, Underline, useAppear, useRevealAt, useScene, useStyle } from "./kit";

export function TitleScene({ title, subtitle, kicker }: PropsOf<"title">) {
	const s = useStyle();
	const t = useAppear(4, { damping: 200 });
	const sub = useAppear(18, { damping: 200 });
	const k = useAppear(0, { damping: 200 });
	return (
		<SceneFrame center>
			<div style={{ ...texture(s), display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 30 }}>
				{kicker ? (
					<div
						style={{
							...appearStyle(k, 10),
							fontSize: 30,
							fontWeight: 600,
							letterSpacing: s.hand ? 1 : 4,
							textTransform: "uppercase",
							color: s.accent,
							padding: s.hand ? 0 : "10px 22px",
							borderRadius: 999,
							background: s.hand ? "transparent" : `${s.accent}14`,
						}}
					>
						{kicker}
					</div>
				) : null}
				<div style={{ ...appearStyle(t, 40), fontFamily: s.headingFont, fontWeight: 800, fontSize: 118, lineHeight: 1.04, letterSpacing: s.hand ? 0 : -4, maxWidth: 1500 }}>
					{title}
				</div>
				<Underline width={320} delay={14} />
				{subtitle ? <div style={{ ...appearStyle(sub, 20), fontSize: 44, color: s.muted, maxWidth: 1300, lineHeight: 1.35 }}>{subtitle}</div> : null}
			</div>
		</SceneFrame>
	);
}

export function ChapterScene({ number, title, goal }: PropsOf<"chapter">) {
	const s = useStyle();
	const frame = useCurrentFrame();
	const n = useAppear(0, { damping: 14 });
	const t = useAppear(8, { damping: 200 });
	const g = useAppear(20, { damping: 200 });
	const bar = interpolate(frame, [6, 30], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
	return (
		<SceneFrame center>
			<div style={{ ...texture(s), display: "flex", alignItems: "center", gap: 80 }}>
				<div
					style={{
						fontFamily: s.headingFont,
						fontSize: 300,
						fontWeight: 800,
						lineHeight: 1,
						color: s.accent,
						transform: `scale(${0.6 + 0.4 * n})`,
						opacity: n,
						fontVariantNumeric: "tabular-nums",
					}}
				>
					{String(number).padStart(2, "0")}
				</div>
				<div style={{ width: 8, height: 280 * bar, background: s.accent2, borderRadius: 8 }} />
				<div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
					<div style={{ ...appearStyle(t, 0), fontSize: 30, letterSpacing: 4, textTransform: "uppercase", color: s.muted, transform: `translateX(${(1 - t) * 30}px)` }}>
						Chapter {number}
					</div>
					<div style={{ fontFamily: s.headingFont, fontSize: 92, fontWeight: s.headingWeight, lineHeight: 1.05, letterSpacing: s.hand ? 0 : -3, opacity: t, maxWidth: 1000 }}>{title}</div>
					{goal ? <div style={{ ...appearStyle(g, 14), fontSize: 38, color: s.muted, maxWidth: 1000, lineHeight: 1.35 }}>{goal}</div> : null}
				</div>
			</div>
		</SceneFrame>
	);
}

function Bullet({ index, text }: { index: number; text: string }) {
	const s = useStyle();
	const p = useAppear(useRevealAt(index));
	const color = ACCENTS(s)[index % 4]!;
	return (
		<div style={{ ...appearStyle(p, 30), display: "flex", alignItems: "flex-start", gap: 34 }}>
			<div
				style={{
					flexShrink: 0,
					marginTop: 6,
					width: 58,
					height: 58,
					borderRadius: s.hand ? "50%" : 16,
					border: s.hand ? `4px solid ${color}` : "none",
					background: s.hand ? "transparent" : color,
					color: s.hand ? color : s.onAccent,
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					fontSize: 30,
					fontWeight: 700,
					transform: `scale(${0.5 + 0.5 * p})`,
				}}
			>
				{index + 1}
			</div>
			<div style={{ fontSize: 50, lineHeight: 1.3 }}>{text}</div>
		</div>
	);
}

export function BulletsScene({ heading, items }: PropsOf<"bullets">) {
	const s = useStyle();
	return (
		<SceneFrame heading={heading}>
			<div style={{ ...texture(s), display: "flex", flexDirection: "column", gap: items.length > 5 ? 30 : 46 }}>
				{items.map((t, i) => (
					<Bullet key={i} index={i} text={t} />
				))}
			</div>
		</SceneFrame>
	);
}

export function DefinitionScene({ term, partOfSpeech, definition, example }: PropsOf<"definition">) {
	const s = useStyle();
	const { timed } = useScene();
	const termP = useAppear(6, { damping: 200 });
	const defP = useAppear(timed.sentences[0] ? timed.sentences[0].from + 6 : 20, { damping: 200 });
	const exAt = timed.sentences.at(-1)?.from ?? 40;
	const exP = useAppear(example ? exAt : null, { damping: 200 });
	return (
		<SceneFrame center>
			<div style={{ ...texture(s), display: "flex", flexDirection: "column", gap: 44, maxWidth: 1450 }}>
				<div style={{ ...appearStyle(termP, 20), display: "flex", alignItems: "baseline", gap: 30 }}>
					<div style={{ fontFamily: s.headingFont, fontSize: 120, fontWeight: 800, letterSpacing: s.hand ? 0 : -4, color: s.accent }}>{term}</div>
					{partOfSpeech ? <div style={{ fontSize: 40, fontStyle: "italic", color: s.muted }}>{partOfSpeech}</div> : null}
				</div>
				<div style={appearStyle(defP, 24)}>
					<Surface edge={{ side: "left", color: s.accent }} style={{ padding: "44px 56px" }}>
						<div style={{ fontSize: 54, lineHeight: 1.35 }}>{definition}</div>
					</Surface>
				</div>
				{example ? (
					<div style={{ ...appearStyle(exP, 20), display: "flex", gap: 24, alignItems: "baseline", fontSize: 42, color: s.muted }}>
						<span style={{ color: s.accent2, fontWeight: 700, textTransform: "uppercase", letterSpacing: 3, fontSize: 30 }}>Example</span>
						<span style={{ lineHeight: 1.4 }}>{example}</span>
					</div>
				) : null}
			</div>
		</SceneFrame>
	);
}

/** Shown when a plan is invalid or a scene type is unknown, instead of a blank frame. */
export function ProblemCard({ message }: { message: string }) {
	return (
		<AbsoluteFill style={{ alignItems: "center", justifyContent: "center", background: "#1b1b22", color: "#fca5a5", fontFamily: "Inter, sans-serif", fontSize: 36, padding: 120, textAlign: "center" }}>
			{message}
		</AbsoluteFill>
	);
}
