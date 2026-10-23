import { interpolate, useCurrentFrame } from "remotion";
import type { PropsOf } from "../../../src/shared/plan/schema";
import { texture } from "../styles/styles";
import { accentAt, appearStyle, SceneFrame, Surface, Underline, useAppear, useRevealAt, useRevealFrames, useScene, useStyle } from "./kit";

/* Kinetic text, quote, summary checklist and key-term glossary. */

const plain = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").trim();

/** Splits a line into words and marks the emphasis words (case and punctuation ignored). */
export function emphasized(line: string, emphasis: string[]): { word: string; hot: boolean }[] {
	const hot = new Set(emphasis.map(plain));
	const words = line.split(/\s+/).filter(Boolean);
	const out: { word: string; hot: boolean }[] = [];
	for (let i = 0; i < words.length; i++) {
		// Two-word phrases first, then single words.
		if (words[i + 1] && hot.has(plain(`${words[i]} ${words[i + 1]}`))) {
			out.push({ word: `${words[i]} ${words[i + 1]}`, hot: true });
			i++;
		} else out.push({ word: words[i]!, hot: hot.has(plain(words[i]!)) });
	}
	return out;
}

function KineticWord({ word, hot, at, size }: { word: string; hot: boolean; at: number; size: number }) {
	const s = useStyle();
	const frame = useCurrentFrame();
	const p = useAppear(at, { damping: 13, mass: 0.6 });
	const mark = interpolate(frame, [at + 6, at + 18], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
	return (
		<span
			style={{
				position: "relative",
				display: "inline-flex",
				flexDirection: "column",
				alignItems: "center",
				fontFamily: s.headingFont,
				fontWeight: 800,
				fontSize: size,
				lineHeight: 1.12,
				letterSpacing: s.hand ? 0 : -size * 0.03,
				color: hot ? s.accent : s.text,
				opacity: p,
				transform: `translateY(${(1 - p) * size * 0.5}px) scale(${0.8 + 0.2 * p})`,
			}}
		>
			{hot && !s.hand ? (
				<span style={{ position: "absolute", left: -8, right: -8, bottom: size * 0.1, height: size * 0.3, background: `${s.accent}30`, borderRadius: 8, transform: `scaleX(${mark})`, transformOrigin: "left" }} />
			) : null}
			<span style={{ position: "relative" }}>{word}</span>
			{hot && s.hand ? (
				<span style={{ position: "absolute", bottom: -10 }}>
					<Underline width={Math.max(60, word.length * size * 0.45)} delay={at + 6} />
				</span>
			) : null}
		</span>
	);
}

function KineticLine({ text, emphasis, at, size, exitAt }: { text: string; emphasis: string[]; at: number; size: number; exitAt: number | null }) {
	const frame = useCurrentFrame();
	const out = exitAt === null ? 0 : interpolate(frame, [exitAt, exitAt + 10], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
	return (
		<div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", columnGap: size * 0.28, rowGap: 6, opacity: 1 - out, transform: `translateY(${-out * 80}px)` }}>
			{emphasized(text, emphasis).map((w, i) => (
				<KineticWord key={i} word={w.word} hot={w.hot} at={at + i * 3} size={size} />
			))}
		</div>
	);
}

export function KineticScene({ lines, emphasis, mode }: PropsOf<"kinetic">) {
	const s = useStyle();
	const frames = useRevealFrames(lines.length);
	const frame = useCurrentFrame();
	if (mode === "punch") {
		// One big line at a time; the previous one flies out as the next lands.
		const current = Math.max(0, frames.filter((f) => f <= frame).length - 1);
		return (
			<SceneFrame center>
				<div style={{ ...texture(s), position: "relative", height: 640 }}>
					{lines.map((l, i) =>
						i === current || i === current - 1 ? (
							<div key={i} style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center" }}>
								<KineticLine text={l} emphasis={emphasis} at={frames[i]!} size={l.length > 40 ? 104 : 140} exitAt={i < current ? frames[current]! - 4 : null} />
							</div>
						) : null,
					)}
				</div>
			</SceneFrame>
		);
	}
	const size = lines.length === 1 ? 140 : lines.length === 2 ? 116 : lines.length === 3 ? 96 : 76;
	return (
		<SceneFrame center>
			<div style={{ ...texture(s), display: "flex", flexDirection: "column", gap: size * 0.32, textAlign: "center" }}>
				{lines.map((l, i) => (
					<KineticLine key={i} text={l} emphasis={emphasis} at={frames[i]!} size={size} exitAt={null} />
				))}
			</div>
		</SceneFrame>
	);
}

export function QuoteScene({ text, author, source }: PropsOf<"quote">) {
	const s = useStyle();
	const frame = useCurrentFrame();
	const { timed } = useScene();
	const mark = useAppear(0, { damping: 14 });
	const words = text.split(/\s+/).filter(Boolean);
	// Words appear across most of the narration, so the quote is read along with the voice.
	const last = timed.sentences.at(-1);
	const end = Math.max(30, Math.min(timed.durationInFrames - 40, (last ? last.from + last.duration : 60) * 0.7));
	const shown = interpolate(frame, [8, end], [0, words.length], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
	const by = useAppear(author || source ? Math.round(end) : null, { damping: 200 });
	const size = text.length > 220 ? 52 : text.length > 120 ? 62 : 76;
	return (
		<SceneFrame center>
			<div style={{ ...texture(s), position: "relative", maxWidth: 1450, margin: "0 auto" }}>
				<div style={{ position: "absolute", left: -100, top: -170, fontFamily: "Georgia, serif", fontSize: 420, lineHeight: 1, color: s.accent, opacity: 0.25 * mark, transform: `scale(${0.7 + 0.3 * mark})` }}>“</div>
				<div style={{ position: "relative", fontFamily: s.headingFont, fontSize: size, lineHeight: 1.32, fontWeight: Math.max(400, s.headingWeight - 100), fontStyle: s.hand ? "normal" : "italic" }}>
					{words.map((w, i) => (
						<span key={i} style={{ opacity: interpolate(shown - i, [0, 1], [0.12, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }}>
							{w}{" "}
						</span>
					))}
				</div>
				{author || source ? (
					<div style={{ ...appearStyle(by, 14), marginTop: 48, display: "flex", alignItems: "center", gap: 22, fontSize: 38 }}>
						<div style={{ width: 70, height: 5, borderRadius: 4, background: s.accent2 }} />
						{author ? <span style={{ fontWeight: 700 }}>{author}</span> : null}
						{source ? <span style={{ color: s.muted, fontStyle: "italic" }}>{source}</span> : null}
					</div>
				) : null}
			</div>
		</SceneFrame>
	);
}

function CheckRow({ index, text, count }: { index: number; text: string; count: number }) {
	const s = useStyle();
	const frame = useCurrentFrame();
	const at = useRevealAt(index);
	const p = useAppear(at);
	const tick = interpolate(frame, [at + 8, at + 20], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
	const box = count > 5 ? 52 : 62;
	const filled = tick > 0.5 && !s.hand;
	return (
		<div style={{ ...appearStyle(p, 24), display: "flex", alignItems: "center", gap: 32 }}>
			<svg width={box} height={box} viewBox="0 0 60 60" style={{ flexShrink: 0, overflow: "visible" }}>
				<rect x="3" y="3" width="54" height="54" rx={s.hand ? 6 : 14} fill={filled ? s.positive : "none"} stroke={s.positive} strokeWidth={4} strokeDasharray={s.line.style === "dashed" ? "7 6" : undefined} />
				<path d="M16 31 L26 41 L45 19" fill="none" stroke={filled ? s.onAccent : s.positive} strokeWidth={7} strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - tick} />
			</svg>
			<div style={{ fontSize: count > 5 ? 42 : 48, lineHeight: 1.28 }}>{text}</div>
		</div>
	);
}

export function SummaryScene({ heading, items }: PropsOf<"summary">) {
	const s = useStyle();
	return (
		<SceneFrame heading={heading ?? "Summary"}>
			<div style={{ ...texture(s), display: "flex", flexDirection: "column", gap: items.length > 5 ? 26 : 38 }}>
				{items.map((t, i) => (
					<CheckRow key={i} index={i} text={t} count={items.length} />
				))}
			</div>
		</SceneFrame>
	);
}

function GlossaryCard({ index, term, meaning, at, compact }: { index: number; term: string; meaning: string; at: number; compact: boolean }) {
	const s = useStyle();
	const p = useAppear(at);
	const color = accentAt(s, index);
	return (
		<div style={appearStyle(p, 26)}>
			<Surface
				edge={{ side: "left", color }}
				style={{ padding: compact ? "26px 34px" : "30px 44px", display: "flex", flexDirection: compact ? "column" : "row", gap: compact ? 10 : 40, alignItems: compact ? "flex-start" : "baseline" }}
			>
				<div style={{ fontFamily: s.headingFont, fontWeight: 800, fontSize: compact ? 42 : 50, color, minWidth: compact ? undefined : 330 }}>{term}</div>
				<div style={{ fontSize: compact ? 32 : 38, lineHeight: 1.35 }}>{meaning}</div>
			</Surface>
		</div>
	);
}

export function GlossaryScene({ heading, terms }: PropsOf<"glossary">) {
	const s = useStyle();
	const frames = useRevealFrames(terms.length);
	const two = terms.length > 3;
	return (
		<SceneFrame heading={heading ?? "Key terms"}>
			<div style={{ ...texture(s), display: "grid", gridTemplateColumns: two ? "1fr 1fr" : "1fr", gap: two ? 30 : 34 }}>
				{terms.map((t, i) => (
					<GlossaryCard key={i} index={i} term={t.term} meaning={t.meaning} at={frames[i]!} compact={two} />
				))}
			</div>
		</SceneFrame>
	);
}
