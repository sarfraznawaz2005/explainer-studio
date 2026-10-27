import { createContext, type CSSProperties } from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { captionBand, groupAt, type CaptionGroup, type CaptionStyle } from "../../../src/shared/plan/captions";
import { isNarrow } from "../../../src/shared/plan/frame";
import type { VisualStyle } from "../styles/styles";

/**
 * Burned-in captions: the group of words the voice is saying, in one of three
 * looks. White words with a dark edge (or on a dark pill) read on any picture.
 */

/** The caption band, for scene layouts: they keep their content above it. Null: no captions. */
export const CaptionSpace = createContext<{ bottom: number; height: number } | null>(null);

/** Black or white, whichever reads better on a colour. */
function inkOn(hex: string): string {
	const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex);
	if (!m) return "#ffffff";
	const [r, g, b] = [m[1], m[2], m[3]].map((x) => parseInt(x!, 16) / 255) as [number, number, number];
	return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.55 ? "#111111" : "#ffffff";
}

/** A dark edge around light words, so they read on light and dark pictures alike (shadows: a stroke shows the inner lines of variable fonts). */
const EDGE: CSSProperties = { textShadow: ["0.04em 0 0", "-0.04em 0 0", "0 0.04em 0", "0 -0.04em 0", "0.03em 0.03em 0", "-0.03em 0.03em 0", "0.03em -0.03em 0", "-0.03em -0.03em 0", "0 0.06em 0.18em"].map((o) => `${o} rgba(0,0,0,0.88)`).join(", ") };

export function CaptionLayer({ groups, kind, style, rtl }: { groups: CaptionGroup[]; kind: Exclude<CaptionStyle, "off">; style: VisualStyle; rtl: boolean }) {
	const frame = useCurrentFrame();
	const { width, height, fps } = useVideoConfig();
	const g = groupAt(groups, frame);
	if (!g) return null;
	const band = captionBand(kind, width, height);
	const narrow = isNarrow(width, height);
	const short = Math.min(width, height);
	const text = g.words.map((w) => w.text).join(" ");
	const base = Math.round(short * (narrow ? 0.064 : 0.05) * (kind === "pop" ? 1.15 : 1));
	// One line when it fits (about 0.56 em a letter in bold); two at most.
	const maxW = width * (narrow ? 0.86 : 0.8);
	const size = Math.max(Math.round(base * 0.62), Math.min(base, Math.floor(maxW / Math.max(1, text.length * 0.56))));
	const spoken = g.words.findLastIndex((w) => w.from <= frame);
	const appear = spring({ frame: frame - g.from, fps, config: { damping: 15, mass: 0.5 } });
	const font: CSSProperties = { fontFamily: style.bodyFont, fontWeight: kind === "pop" ? 900 : 800, fontSize: size, lineHeight: 1.18, letterSpacing: 0 };
	const box: CSSProperties = {
		position: "absolute",
		left: 0,
		right: 0,
		bottom: band.bottom,
		height: band.height,
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
		direction: rtl ? "rtl" : "ltr",
		pointerEvents: "none",
	};
	const line: CSSProperties = { maxWidth: maxW, textAlign: "center", ...font };
	if (kind === "pill")
		return (
			<div style={box} data-captions="pill">
				<div style={{ ...line, color: "#ffffff", background: "rgba(12,12,18,0.8)", padding: "0.18em 0.6em 0.22em", borderRadius: "0.5em", opacity: Math.min(1, appear * 1.5), transform: `translateY(${(1 - appear) * 10}px)` }}>{text}</div>
			</div>
		);
	if (kind === "karaoke")
		return (
			<div style={box} data-captions="karaoke">
				<div style={{ ...line, opacity: Math.min(1, appear * 1.5) }}>
					{g.words.map((w, i) => {
						const on = i === spoken;
						return (
							<span key={i}>
								{i ? " " : ""}
								<span style={{ ...(on ? {} : EDGE), color: on ? inkOn(style.accent) : "#ffffff", background: on ? style.accent : "transparent", borderRadius: "0.25em", padding: "0 0.12em", opacity: i <= spoken ? 1 : 0.72 }}>{w.text}</span>
							</span>
						);
					})}
				</div>
			</div>
		);
	// Pop: the group comes in at 110% and settles; the word being said is bigger and in the accent colour.
	const scale = interpolate(appear, [0, 1], [1.1, 1]);
	return (
		<div style={box} data-captions="pop">
			<div style={{ ...line, opacity: Math.min(1, appear * 2), transform: `scale(${scale})` }}>
				{g.words.map((w, i) => {
					const on = i === spoken;
					const pop = on ? spring({ frame: frame - w.from, fps, config: { damping: 12, mass: 0.4 } }) : 0;
					return (
						<span key={i}>
							{i ? " " : ""}
							<span style={{ ...EDGE, display: "inline-block", color: on ? style.accent : "#ffffff", transform: `scale(${1 + 0.08 * pop})` }}>{w.text}</span>
						</span>
					);
				})}
			</div>
		</div>
	);
}
