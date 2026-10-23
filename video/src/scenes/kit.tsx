import { createContext, useContext, type CSSProperties, type ReactNode } from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { cueFrame, msToFrames, type TimedScene } from "../../../src/shared/plan/timing";
import type { FigureMeta } from "../../../src/shared/source";
import { glow, outline, texture, type VisualStyle } from "../styles/styles";

/** What every scene can read: its timing (sentences, cues), the visual style and where source figures live. */
type SceneCtx = { timed: TimedScene; style: VisualStyle; figureBase?: string; figureMeta?: Record<string, FigureMeta> };
const Ctx = createContext<SceneCtx | null>(null);

export function SceneProvider({ value, children }: { value: SceneCtx; children: ReactNode }) {
	return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useScene(): SceneCtx {
	const v = useContext(Ctx);
	if (!v) throw new Error("Scene used outside SceneProvider");
	return v;
}

export const useStyle = () => useScene().style;

/** 0 → 1 spring that starts at `at` (scene-relative frame). Before `at` it is 0. */
export function useAppear(at: number | null, opts: { damping?: number; mass?: number } = {}): number {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	if (at === null) return 0;
	return spring({ frame: frame - at, fps, config: { damping: opts.damping ?? 18, mass: opts.mass ?? 0.7 } });
}

/** Frame at which item `target` should appear. Falls back to the scene start. */
export function useRevealAt(target: number, actions: ("reveal" | "focus" | "highlight")[] = ["reveal"]): number {
	const { timed } = useScene();
	return cueFrame(timed.cues, target, actions) ?? 0;
}

/** Index of the most recent focus/highlight cue at the current frame, or -1. */
export function useActiveCue(action: "focus" | "highlight"): number {
	const frame = useCurrentFrame();
	const { timed } = useScene();
	let active = -1;
	for (const c of timed.cues) if (c.action === action && c.frame <= frame && c.target !== undefined) active = c.target;
	return active;
}

/**
 * Frame shape. Vertical (9:16) videos for Shorts, TikTok and Reels keep clear of the
 * phone's own buttons and captions: more room at the top and bottom, narrower sides.
 */
export const isVertical = (w: number, h: number) => h > w;

/** The frame a scene is laid out for, when it differs from the composition (a scene drawn small inside a thumbnail). */
const FrameSize = createContext<{ width: number; height: number } | null>(null);
export const FrameSizeProvider = FrameSize.Provider;
const PAD = { wide: { top: 96, side: 140, bottom: 96 }, tall: { top: 210, side: 72, bottom: 330 } } as const;

export function useLayout() {
	const config = useVideoConfig();
	const { width, height } = useContext(FrameSize) ?? config;
	const vertical = isVertical(width, height);
	const pad = vertical ? PAD.tall : PAD.wide;
	const contentW = width - pad.side * 2;
	const innerH = height - pad.top - pad.bottom;
	return {
		vertical,
		pad,
		/** Content box width inside SceneFrame. */
		contentW,
		/** Height left for the scene's drawing, under a heading or without one (wide frames: the long-standing 720 / 880). */
		stageH: (heading?: string) => (vertical ? (heading ? innerH - 200 : innerH) : heading ? 720 : 880),
	};
}

/** Fades from a hidden state: opacity plus a small slide. */
export function appearStyle(p: number, dy = 24): CSSProperties {
	return { opacity: p, transform: `translateY(${(1 - p) * dy}px)` };
}

/**
 * Scene wrapper: padding, enter transition from the plan, a short exit fade,
 * and an optional heading that writes in first.
 */
export function SceneFrame({ heading, children, center, bleed }: { heading?: string; children: ReactNode; center?: boolean; bleed?: boolean }) {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	const { timed, style } = useScene();
	const { type, durationMs } = timed.scene.transition;
	const enterFrames = Math.max(1, msToFrames(durationMs, fps));
	const p = type === "none" ? 1 : interpolate(frame, [0, enterFrames], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
	const exit = interpolate(frame, [timed.durationInFrames - 10, timed.durationInFrames], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
	const transform = type === "slide" ? `translateX(${(1 - p) * 80}px)` : type === "zoom" ? `scale(${0.94 + 0.06 * p})` : undefined;
	const headP = useAppear(Math.round(enterFrames / 2));
	const { vertical, pad } = useLayout();
	return (
		// bleed: no padding, the scene draws edge to edge (photos).
		<AbsoluteFill style={{ opacity: p * exit, transform, padding: bleed ? 0 : `${pad.top}px ${pad.side}px ${pad.bottom}px`, color: style.text, fontFamily: style.bodyFont }}>
			{heading ? (
				<div style={{ ...appearStyle(headP, 16), marginBottom: vertical ? 64 : 56 }}>
					<Heading size={vertical ? 72 : 64}>{heading}</Heading>
				</div>
			) : null}
			{/* Tall frames centre the content, so a short scene does not leave the bottom half empty. */}
			<div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: center || vertical ? "center" : "flex-start", minHeight: 0 }}>{children}</div>
		</AbsoluteFill>
	);
}

export function Heading({ children, size = 64 }: { children: ReactNode; size?: number }) {
	const style = useStyle();
	return (
		<div style={{ ...texture(style), display: "inline-flex", flexDirection: "column", gap: 14 }}>
			<div style={{ fontFamily: style.headingFont, fontWeight: style.headingWeight, fontSize: size, letterSpacing: style.hand ? 0 : -1.5, lineHeight: 1.1, ...glow(style, style.text) }}>
				{children}
			</div>
			<Underline width={Math.min(260, size * 3)} />
		</div>
	);
}

/** Accent stroke that draws itself in. */
export function Underline({ width = 200, delay = 6 }: { width?: number; delay?: number }) {
	const style = useStyle();
	const frame = useCurrentFrame();
	const draw = interpolate(frame, [delay, delay + 18], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
	return (
		<svg width={width} height={14} style={{ overflow: "visible" }}>
			<path
				d={style.hand ? `M2 8 Q ${width * 0.3} 2 ${width * 0.55} 7 T ${width - 2} 6` : `M2 7 H ${width - 2}`}
				stroke={style.accent}
				strokeWidth={style.hand ? 6 : 7}
				strokeLinecap="round"
				fill="none"
				pathLength={1}
				strokeDasharray={1}
				strokeDashoffset={1 - draw}
			/>
		</svg>
	);
}

/**
 * Card surface in the current style. Borders are set per side (never the `border`
 * shorthand) so an accent edge and a style switch cannot fight over the same property.
 */
export function Surface({
	children,
	style: extra,
	edge,
	bare,
}: {
	children: ReactNode;
	style?: CSSProperties;
	/** A thick coloured edge on one side. */
	edge?: { side: "top" | "left"; color: string };
	/** No outline (for dark code panels in the clean style). */
	bare?: boolean;
}) {
	const s = useStyle();
	const line = bare ? "none" : outline(s);
	const side = (name: "top" | "left") => (edge?.side === name ? `${Math.max(6, s.line.width * 2.5)}px solid ${edge.color}` : line);
	return (
		<div
			style={{
				background: s.surface,
				borderTop: side("top"),
				borderRight: line,
				borderBottom: line,
				borderLeft: side("left"),
				borderRadius: s.radius,
				boxShadow: s.shadow,
				...extra,
			}}
		>
			{children}
		</div>
	);
}

export const ACCENTS = (s: VisualStyle) => [s.accent, s.accent2, s.accent3, s.positive];
export const accentAt = (s: VisualStyle, i: number) => ACCENTS(s)[i % 4]!;


/** Frame (scene-relative) of a sentence edge plus an offset; the lead-in when the sentence does not exist. */
export function sentenceFrame(timed: TimedScene, at: number, edge: "start" | "end", offsetMs: number, fps: number): number {
	const s = timed.sentences[at];
	const base = s ? (edge === "end" ? s.from + s.duration : s.from) : msToFrames(400, fps);
	return Math.max(0, base + msToFrames(offsetMs, fps));
}

/** 0 → 1 linear ramp between two frames. */
export function ramp(frame: number, from: number, to: number): number {
	return interpolate(frame, [from, Math.max(from + 1, to)], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
}

/** Ease in-out for ramps. */
export const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

/** Reveal frames of items 0..n-1 (scene start when an item has no cue). */
export function useRevealFrames(n: number, actions: ("reveal" | "focus" | "highlight")[] = ["reveal"]): number[] {
	const { timed } = useScene();
	return Array.from({ length: n }, (_, k) => cueFrame(timed.cues, k, actions) ?? 0);
}

/** Per-side borders (never the shorthand, so React never mixes the two), with an optional thicker bottom. */
export const borders = (all: string, bottom?: string): CSSProperties => ({ borderTop: all, borderRight: all, borderLeft: all, borderBottom: bottom ?? all });

/** A rounded label pill. */
export function Pill({ children, color, solid, size = 26 }: { children: ReactNode; color: string; solid?: boolean; size?: number }) {
	const s = useStyle();
	return (
		<span
			style={{
				display: "inline-flex",
				alignItems: "center",
				gap: 10,
				fontSize: size,
				fontWeight: 700,
				letterSpacing: s.hand ? 0.5 : 2,
				textTransform: "uppercase",
				color: solid ? s.onAccent : color,
				background: solid ? color : s.hand ? "transparent" : `${color}1c`,
				border: s.hand ? `${s.line.width}px ${s.line.style} ${color}` : "none",
				padding: `${size * 0.32}px ${size * 0.8}px`,
				borderRadius: 999,
				whiteSpace: "nowrap",
			}}
		>
			{children}
		</span>
	);
}
