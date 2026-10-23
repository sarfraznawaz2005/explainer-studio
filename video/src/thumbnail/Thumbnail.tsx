import { useMemo, type ReactNode } from "react";
import { AbsoluteFill, Sequence } from "remotion";
import { VideoPlan, type SceneType, type StyleId, type VideoPlanInput } from "../../../src/shared/plan/schema";
import { computeTimeline, type TimedScene } from "../../../src/shared/plan/timing";
import { SceneView, useFonts } from "../plan/PlanVideo";
import { SceneProvider } from "../scenes/kit";
import { styleFor, type BrandColors, type VisualStyle } from "../styles/styles";

/**
 * YouTube thumbnail, 1280×720. Three looks (A/B test them in YouTube Studio):
 *  a: the video's own style, big title left, a real frame of the most visual scene right.
 *  b: dark and bold, title over a glowing accent, the key visual faded in behind.
 *  c: solid accent colour, white title, "in N steps" sticker.
 * The key visual is the real scene, drawn at its last frame (everything revealed).
 */
export const THUMBNAIL = { id: "Thumbnail", width: 1280, height: 720, fps: 30, durationInFrames: 1 } as const;
export type ThumbVariant = "a" | "b" | "c";
export type ThumbnailProps = { plan: VideoPlanInput; variant: ThumbVariant; style?: StyleId; figureBase?: string; brand?: BrandColors };

/** The scene that shows the topic best: charts and diagrams first, plain text last. */
const VISUAL_ORDER: SceneType[] = ["chart", "graph", "diagram", "figure", "map", "cycle", "flow", "tree", "mindmap", "venn", "trace", "equation", "svg", "compare", "timeline", "code", "table", "counter", "analogy", "definition", "bullets"];
export function keyScene(scenes: TimedScene[]): TimedScene | undefined {
	for (const type of VISUAL_ORDER) {
		const s = scenes.find((t) => t.scene.type === type);
		if (s) return s;
	}
	return undefined;
}

/** Short, punchy title: at most 7 words, so it reads at phone size. */
export function thumbTitle(title: string): string {
	const clean = title.replace(/\s*[:–—-]\s.*$/, "").trim() || title;
	const words = clean.split(/\s+/);
	return words.length > 7 ? `${words.slice(0, 7).join(" ")}…` : clean;
}

const titleSize = (t: string, base: number) => (t.length <= 14 ? base : t.length <= 26 ? base * 0.82 : t.length <= 40 ? base * 0.68 : base * 0.56);

/** A 1920×1080 scene drawn at its last frame, scaled into a box. */
function KeyVisual({ timed, style, width, figureBase }: { timed: TimedScene; style: VisualStyle; width: number; figureBase?: string }) {
	const scale = width / 1920;
	const Background = style.Background;
	// 18 frames before the end: after every reveal, before the exit fade.
	const at = Math.max(0, timed.durationInFrames - Math.min(timed.durationInFrames - 1, 18));
	return (
		<div style={{ width, height: 1080 * scale, overflow: "hidden", position: "relative" }}>
			<div style={{ width: 1920, height: 1080, transform: `scale(${scale})`, transformOrigin: "top left", position: "absolute", inset: 0 }}>
				<AbsoluteFill style={{ background: style.bg }}>
					<Background />
					<Sequence from={-at} layout="none">
						<SceneProvider value={{ timed, style, figureBase }}>
							<SceneView scene={timed.scene} />
						</SceneProvider>
					</Sequence>
				</AbsoluteFill>
			</div>
		</div>
	);
}

function Kicker({ children, color, bg }: { children: ReactNode; color: string; bg: string }) {
	return (
		<div style={{ alignSelf: "flex-start", fontSize: 26, fontWeight: 700, letterSpacing: 3, textTransform: "uppercase", color, background: bg, padding: "10px 20px", borderRadius: 999 }}>
			{children}
		</div>
	);
}

export function Thumbnail({ plan: input, variant, style: override, figureBase, brand }: ThumbnailProps) {
	const parsed = useMemo(() => {
		const r = VideoPlan.safeParse(input);
		return r.success ? { plan: r.data, timeline: computeTimeline(r.data) } : null;
	}, [input]);
	const stamp = parsed?.plan.meta.brand;
	const colors = brand ?? (stamp ? { ...stamp.colors, font: stamp.font === "Inter" ? undefined : stamp.font } : undefined);
	const style = styleFor(override ?? parsed?.plan.meta.style ?? "clean", colors);
	useFonts(style);
	if (!parsed) return <AbsoluteFill style={{ background: "#16161d" }} />;
	const { plan, timeline } = parsed;
	const title = thumbTitle(plan.meta.title);
	const key = keyScene(timeline.scenes);
	const kicker = stamp?.series ? `Episode ${stamp.series.episode} · ${plan.meta.level}` : `${plan.meta.level} · explained`;
	const steps = plan.chapters.length;

	if (variant === "b")
		return (
			<AbsoluteFill style={{ background: "#0d0d18", fontFamily: style.headingFont, overflow: "hidden" }}>
				{key ? (
					<div style={{ position: "absolute", right: -80, top: 70, opacity: 0.5, transform: "rotate(-4deg)", borderRadius: 28, overflow: "hidden" }}>
						<KeyVisual timed={key} figureBase={figureBase} style={style} width={820} />
					</div>
				) : null}
				<AbsoluteFill style={{ background: "linear-gradient(90deg, #0d0d18 38%, rgba(13,13,24,0.55) 70%, rgba(13,13,24,0.2))" }} />
				<div style={{ position: "absolute", left: -160, bottom: -260, width: 760, height: 760, borderRadius: "50%", background: `radial-gradient(closest-side, ${style.accent}aa, transparent)` }} />
				<div style={{ position: "absolute", left: 72, top: 70, bottom: 70, width: 760, display: "flex", flexDirection: "column", justifyContent: "center", gap: 28 }}>
					<Kicker color="#0d0d18" bg={style.hand ? style.accent : "#ffffff"}>
						{kicker}
					</Kicker>
					<div style={{ color: "#ffffff", fontSize: titleSize(title, 112), fontWeight: 900, lineHeight: 1.0, letterSpacing: style.hand ? 0 : -3, textShadow: "0 6px 30px rgba(0,0,0,0.6)" }}>{title}</div>
					<div style={{ width: 180, height: 14, borderRadius: 8, background: style.accent }} />
				</div>
			</AbsoluteFill>
		);

	if (variant === "c") {
		// Chalk accents are pastel: white text on them is hard to read, so the board colour is used instead.
		const bg = style.dark ? `linear-gradient(135deg, ${style.bg}, color-mix(in srgb, ${style.bg} 55%, black))` : `linear-gradient(135deg, ${style.accent}, ${style.accent2})`;
		const ink = style.dark ? style.accent : "#ffffff";
		return (
			<AbsoluteFill style={{ background: bg, fontFamily: style.headingFont, overflow: "hidden" }}>
				<AbsoluteFill style={{ backgroundImage: "radial-gradient(rgba(255,255,255,0.22) 2px, transparent 2px)", backgroundSize: "34px 34px" }} />
				{key ? (
					<div style={{ position: "absolute", right: 60, bottom: 60, borderRadius: 24, overflow: "hidden", boxShadow: "0 30px 80px rgba(0,0,0,0.35)", border: "6px solid #ffffff", transform: "rotate(3deg)" }}>
						<KeyVisual timed={key} figureBase={figureBase} style={style} width={500} />
					</div>
				) : null}
				<div style={{ position: "absolute", left: 72, top: 64, right: 72, display: "flex", flexDirection: "column", gap: 24 }}>
					<div style={{ color: ink, fontSize: titleSize(title, 124), fontWeight: 900, lineHeight: 0.98, letterSpacing: style.hand ? 0 : -4, maxWidth: 1080, textShadow: "0 4px 24px rgba(0,0,0,0.25)" }}>{title}</div>
				</div>
				{steps > 1 ? (
					<div style={{ position: "absolute", left: 72, bottom: 72, background: "#16161d", color: "#ffffff", fontSize: 44, fontWeight: 800, padding: "18px 32px", borderRadius: 22, transform: "rotate(-3deg)" }}>
						in {steps} steps
					</div>
				) : null}
			</AbsoluteFill>
		);
	}

	const Background = style.Background;
	return (
		<AbsoluteFill style={{ background: style.bg, fontFamily: style.headingFont, overflow: "hidden" }}>
			<Background />
			<div style={{ position: "absolute", left: 64, top: 60, bottom: 60, width: key ? 600 : 1150, display: "flex", flexDirection: "column", justifyContent: "center", gap: 26 }}>
				<Kicker color={style.accent} bg={style.hand ? "transparent" : `${style.accent}1f`}>
					{kicker}
				</Kicker>
				<div style={{ color: style.text, fontSize: titleSize(title, key ? 96 : 128), fontWeight: 900, lineHeight: 1.02, letterSpacing: style.hand ? 0 : -3 }}>{title}</div>
				<div style={{ width: 160, height: 12, borderRadius: 8, background: style.accent }} />
			</div>
			{key ? (
				<div style={{ position: "absolute", right: 48, top: "50%", transform: "translateY(-50%) rotate(2deg)", borderRadius: style.hand ? 8 : 26, overflow: "hidden", boxShadow: "0 30px 70px -20px rgba(22,22,40,0.45)", border: `5px solid ${style.hand ? style.surfaceBorder : "#ffffff"}` }}>
					<KeyVisual timed={key} figureBase={figureBase} style={style} width={590} />
				</div>
			) : null}
		</AbsoluteFill>
	);
}
