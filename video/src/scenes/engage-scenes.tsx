import { useCurrentFrame, useVideoConfig } from "remotion";
import type { PropsOf } from "../../../src/shared/plan/schema";
import { outline, texture } from "../styles/styles";
import { appearStyle, borders, Heading, Pill, ramp, SceneFrame, Surface, useAppear, useLayout, useRevealFrames, useScene, useStyle } from "./kit";

/* Pause-and-think question and recap quiz. Both have silent thinking time (TimedScene.gaps). */

/** A ring that empties while the thinking time runs, with the seconds left in the middle. */
function Countdown({ from, duration, size = 190 }: { from: number; duration: number; size?: number }) {
	const s = useStyle();
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	const t = ramp(frame, from, from + duration);
	const left = Math.max(0, Math.ceil((from + duration - frame) / fps));
	const r = size / 2 - 12;
	const c = 2 * Math.PI * r;
	const on = frame >= from && frame < from + duration + 8;
	const pop = frame >= from + duration ? 1 + 0.15 * ramp(frame, from + duration, from + duration + 6) : 1;
	return (
		<div style={{ position: "relative", width: size, height: size, opacity: on ? 1 : 0, transform: `scale(${pop})` }}>
			<svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
				<circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={s.surfaceBorder} strokeWidth={14} opacity={0.5} />
				<circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={s.accent} strokeWidth={14} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * t} />
			</svg>
			<div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: s.headingFont, fontSize: size * 0.42, fontWeight: 800, color: s.accent, fontVariantNumeric: "tabular-nums" }}>{left}</div>
		</div>
	);
}

export function PauseScene({ question, answer, hint }: PropsOf<"pause">) {
	const s = useStyle();
	const frame = useCurrentFrame();
	const { timed } = useScene();
	const gap = timed.gaps[0] ?? { from: Math.round(timed.durationInFrames * 0.3), duration: Math.round(timed.durationInFrames * 0.3) };
	const answerAt = gap.from + gap.duration;
	const badge = useAppear(0, { damping: 14 });
	const q = useAppear(6, { damping: 200 });
	const hintP = useAppear(hint ? gap.from + Math.round(gap.duration / 2) : null, { damping: 200 });
	const a = useAppear(answerAt, { damping: 15 });
	const thinking = frame >= gap.from && frame < answerAt;
	// Tall frames: a taller answer area, and the hint under the countdown.
	const { vertical } = useLayout();
	return (
		<SceneFrame center>
			<div style={{ ...texture(s), display: "flex", flexDirection: "column", alignItems: "center", gap: 36, textAlign: "center" }}>
				<div style={{ transform: `scale(${badge})` }}>
					<Pill color={s.accent2} solid={!s.hand} size={30}>
						⏸ Pause and think
					</Pill>
				</div>
				<div style={{ ...appearStyle(q, 20), fontFamily: s.headingFont, fontSize: question.length > 110 ? 58 : 72, fontWeight: s.headingWeight, lineHeight: 1.2, maxWidth: 1500, transform: `translateY(${-a * 10}px)` }}>{question}</div>
				<div style={{ height: vertical ? 460 : 230, display: "flex", alignItems: "center", justifyContent: "center", position: "relative", width: "100%" }}>
					{thinking ? (
						<div style={{ display: "flex", flexDirection: vertical ? "column" : "row", alignItems: "center", gap: vertical ? 30 : 50 }}>
							<Countdown from={gap.from} duration={gap.duration} />
							{hint ? (
								<div style={{ ...appearStyle(hintP, 10), maxWidth: 800, textAlign: vertical ? "center" : "left", fontSize: 36, color: s.muted, lineHeight: 1.35 }}>
									<span style={{ color: s.accent3, fontWeight: 800 }}>Hint: </span>
									{hint}
								</div>
							) : null}
						</div>
					) : null}
					{frame >= answerAt ? (
						<div style={{ ...appearStyle(a, 30), position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
							<Surface edge={{ side: "left", color: s.positive }} style={{ padding: "30px 46px", maxWidth: 1400, textAlign: "left" }}>
								<div style={{ fontSize: 26, letterSpacing: 3, fontWeight: 800, color: s.positive, marginBottom: 10 }}>ANSWER</div>
								<div style={{ fontSize: answer.length > 160 ? 38 : 46, lineHeight: 1.3 }}>{answer}</div>
							</Surface>
						</div>
					) : null}
				</div>
			</div>
		</SceneFrame>
	);
}

const LETTERS = ["A", "B", "C", "D"];

export function QuizScene({ heading, questions }: PropsOf<"quiz">) {
	const s = useStyle();
	const frame = useCurrentFrame();
	const { timed } = useScene();
	const frames = useRevealFrames(questions.length);
	const k = frames.filter((f) => f <= frame).length - 1;
	const intro = useAppear(0, { damping: 200 });
	// Hooks first (the same ones on every frame), then the intro card before the first question.
	const q = questions[Math.max(0, k)]!;
	const start = frames[Math.max(0, k)]!;
	const gap = timed.gaps.find((g) => g.target === k) ?? timed.gaps.find((g) => g.from >= start);
	const answerAt = gap ? gap.from + gap.duration : start + 90;
	const revealed = k >= 0 && frame >= answerAt;
	const explain = useAppear(revealed && q.explain ? answerAt + 10 : null, { damping: 200 });
	if (k < 0)
		return (
			<SceneFrame center>
				<div style={{ ...texture(s), ...appearStyle(intro, 20), textAlign: "center" }}>
					<Heading size={96}>{heading ?? "Quick quiz"}</Heading>
					<div style={{ marginTop: 30, fontSize: 40, color: s.muted }}>{questions.length === 1 ? "One question" : `${questions.length} questions`}</div>
				</div>
			</SceneFrame>
		);
	const shown = ramp(frame, start, start + 10);
	// Tall frames: one option per row, and the question under its number.
	const { vertical } = useLayout();
	const long = vertical || q.options.some((o) => o.length > 32);
	const barT = gap ? ramp(frame, gap.from, gap.from + gap.duration) : 0;
	return (
		<SceneFrame heading={heading ?? "Quick quiz"}>
			<div style={{ ...texture(s), display: "flex", flexDirection: "column", gap: 30, opacity: shown, transform: `translateY(${(1 - shown) * 20}px)` }}>
				<div style={{ display: "flex", flexDirection: vertical ? "column" : "row", alignItems: "baseline", gap: vertical ? 8 : 24 }}>
					<span style={{ fontSize: 28, fontWeight: 800, color: s.accent, letterSpacing: 2, whiteSpace: "nowrap" }}>
						Q{k + 1}
						{questions.length > 1 ? ` / ${questions.length}` : ""}
					</span>
					<span style={{ fontSize: q.question.length > 90 ? 46 : 54, fontWeight: 700, lineHeight: 1.25 }}>{q.question}</span>
				</div>
				<div style={{ height: 10, borderRadius: 10, background: s.dark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.07)", overflow: "hidden", opacity: gap && frame >= gap.from && !revealed ? 1 : 0 }}>
					<div style={{ width: `${(1 - barT) * 100}%`, height: "100%", background: s.accent, borderRadius: 10 }} />
				</div>
				<div style={{ display: "grid", gridTemplateColumns: long ? "1fr" : "1fr 1fr", gap: long ? 16 : 24 }}>
					{q.options.map((o, i) => {
						const right = i === q.answer;
						const color = revealed && right ? s.positive : s.surfaceBorder;
						return (
							<div
								key={i}
								style={{
									display: "flex",
									alignItems: "center",
									gap: 24,
									padding: vertical ? "22px 28px" : long ? "16px 26px" : "24px 30px",
									borderRadius: Math.min(20, s.radius),
									background: revealed && right ? `${s.positive}${s.dark ? "30" : "1c"}` : s.surface,
									...borders(revealed && right ? `${Math.max(4, s.line.width * 2)}px solid ${s.positive}` : outline(s, color)),
									boxShadow: s.shadow,
									opacity: revealed && !right ? 0.45 : 1,
									transform: revealed && right ? `scale(${1 + 0.03 * ramp(frame, answerAt, answerAt + 6)})` : undefined,
								}}
							>
								<span style={{ width: 56, height: 56, flexShrink: 0, borderRadius: 99, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 28, background: revealed && right ? s.positive : "transparent", color: revealed && right ? s.onAccent : s.accent, ...borders(revealed && right ? "none" : `3px solid ${s.accent}`) }}>{revealed && right ? "✓" : LETTERS[i]}</span>
								<span style={{ fontSize: vertical ? 38 : long ? 34 : 40, lineHeight: 1.25 }}>{o}</span>
							</div>
						);
					})}
				</div>
				{q.explain ? (
					<div style={{ ...appearStyle(explain, 12), fontSize: 36, color: s.muted, lineHeight: 1.35 }}>
						<span style={{ color: s.positive, fontWeight: 800 }}>Why: </span>
						{q.explain}
					</div>
				) : null}
			</div>
		</SceneFrame>
	);
}
