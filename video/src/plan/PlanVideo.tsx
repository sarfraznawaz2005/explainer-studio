import { useEffect, useMemo, useState, type ComponentType } from "react";
import { AbsoluteFill, Audio, continueRender, delayRender, interpolate, Sequence, useCurrentFrame, useVideoConfig } from "remotion";
import { VideoPlan, type Scene, type SceneType, type StyleId, type VideoPlanInput } from "../../../src/shared/plan/schema";
import { musicVolumeAt, type MusicSpan, type Soundtrack } from "../../../src/shared/plan/soundtrack";
import { computeTimeline, type TimedScene, type Timeline } from "../../../src/shared/plan/timing";
import { ChartScene, CodeScene } from "../scenes/data-scenes";
import { CompareScene, FlowScene } from "../scenes/diagram-scenes";
import { PauseScene, QuizScene } from "../scenes/engage-scenes";
import { SceneProvider } from "../scenes/kit";
import { CounterScene, EquationScene, GraphScene } from "../scenes/math-scenes";
import { DiagramScene, FigureScene, SvgScene } from "../scenes/media-scenes";
import { CycleScene, MindmapScene, ProsConsScene, TreeScene, VennScene } from "../scenes/shape-scenes";
import { AnalogyScene, DialogueScene, MapScene, TimelineScene } from "../scenes/story-scenes";
import { GlossaryScene, KineticScene, QuoteScene, SummaryScene } from "../scenes/structure-scenes";
import { TableScene, TraceScene } from "../scenes/tech-scenes";
import { BulletsScene, ChapterScene, DefinitionScene, ProblemCard, TitleScene } from "../scenes/text-scenes";
import { styleFor, type BrandColors, type VisualStyle } from "../styles/styles";
import { BrandIntro, BrandOutro, Watermark } from "./BrandLayer";
import { brandFontStack, type BrandStamp } from "../../../src/shared/brand";
import type { FigureMeta } from "../../../src/shared/source";

export type PlanVideoProps = {
	plan: VideoPlanInput;
	/** Overrides plan.meta.style (Studio style switcher). */
	style?: StyleId;
	/** URL prefix for voice clips (sentence.audio is a file name). No prefix = silent preview. */
	audioBase?: string;
	/** Music beds and sound effects (built by buildSoundtrack). None = no music or effects. */
	soundtrack?: Soundtrack;
	/** URL prefix for source figures (scene props hold the file name). None = placeholders. */
	figureBase?: string;
	/** Picture details by file name: size, subject position, photo or not, short credit. None = every figure keeps its frame. */
	figureMeta?: Record<string, FigureMeta>;
	/** Colours for the "brand" style. */
	brand?: BrandColors;
};

// Each scene component takes its own props type; the registry erases that at the boundary.
export const SCENES: Record<SceneType, ComponentType<never>> = {
	title: TitleScene,
	chapter: ChapterScene,
	kinetic: KineticScene,
	bullets: BulletsScene,
	definition: DefinitionScene,
	quote: QuoteScene,
	summary: SummaryScene,
	glossary: GlossaryScene,
	flow: FlowScene,
	cycle: CycleScene,
	tree: TreeScene,
	mindmap: MindmapScene,
	diagram: DiagramScene,
	venn: VennScene,
	compare: CompareScene,
	proscons: ProsConsScene,
	chart: ChartScene,
	counter: CounterScene,
	equation: EquationScene,
	graph: GraphScene,
	code: CodeScene,
	trace: TraceScene,
	table: TableScene,
	timeline: TimelineScene,
	map: MapScene,
	analogy: AnalogyScene,
	dialogue: DialogueScene,
	figure: FigureScene,
	pause: PauseScene,
	quiz: QuizScene,
	svg: SvgScene,
};

/** Parse once per plan object. Invalid plans render a readable problem card. */
export function usePlan(input: VideoPlanInput): { plan: VideoPlan; timeline: Timeline } | { error: string } {
	return useMemo(() => {
		const r = VideoPlan.safeParse(input);
		if (!r.success) return { error: r.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("\n") };
		return { plan: r.data, timeline: computeTimeline(r.data) };
	}, [input]);
}

/** Blocks rendering until the fonts a style uses are loaded, so no frame shows a fallback font. */
export function useFonts(style: VisualStyle, extra?: string) {
	const [handle] = useState(() => delayRender("Loading fonts"));
	useEffect(() => {
		const fams = [style.headingFont, style.bodyFont, style.monoFont, ...(extra ? [extra] : [])].map((f) => f.split(",")[0]!.trim());
		// KaTeX fonts too, so the first frame of an equation is never drawn in a fallback font.
		const math = ["KaTeX_Main", "KaTeX_Math", "KaTeX_Size1", "KaTeX_Size2", "KaTeX_AMS"].map((f) => document.fonts.load(`400 40px ${f}`));
		const mathExtra = [document.fonts.load("italic 400 40px KaTeX_Math"), document.fonts.load("700 40px KaTeX_Main")];
		Promise.all([...fams.flatMap((f) => [document.fonts.load(`400 40px ${f}`), document.fonts.load(`700 40px ${f}`)]), ...math, ...mathExtra])
			.catch(() => undefined)
			.finally(() => continueRender(handle));
	}, [handle, style, extra]);
}

function ChapterProgress({ timeline, style }: { timeline: Timeline; style: VisualStyle }) {
	const frame = useCurrentFrame();
	// Vertical: above the phone app's captions and buttons at the bottom.
	const { width, height } = useVideoConfig();
	const tall = height > width;
	return (
		<div style={{ position: "absolute", left: tall ? 72 : 140, right: tall ? 72 : 140, bottom: tall ? 290 : 44, display: "flex", gap: 10, opacity: 0.9 }}>
			{timeline.chapters.map((c) => {
				const p = interpolate(frame, [c.from, c.from + c.durationInFrames], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
				return (
					<div key={c.id} style={{ flex: c.durationInFrames, height: 6, borderRadius: 6, background: style.dark ? "rgba(255,255,255,0.15)" : "rgba(22,22,40,0.08)", overflow: "hidden" }}>
						<div style={{ width: `${p * 100}%`, height: "100%", background: style.accent, borderRadius: 6 }} />
					</div>
				);
			})}
		</div>
	);
}

export function SceneView({ scene }: { scene: Scene }) {
	const Comp = SCENES[scene.type] as ComponentType<Scene["props"]> | undefined;
	if (!Comp) return <ProblemCard message={`Unknown scene type "${scene.type}"`} />;
	return <Comp {...scene.props} />;
}

/**
 * One clip per voiced sentence, starting on the sentence's first frame. The scene's
 * cues are tied to the same frames, so picture and voice stay in sync by design.
 * Clips mount a second early so they are loaded when they start.
 */
function SceneVoice({ timed, audioBase, fps }: { timed: TimedScene; audioBase: string; fps: number }) {
	return (
		<>
			{timed.sentences.map((s) =>
				s.audio ? (
					<Sequence key={s.id} from={s.from} durationInFrames={s.duration} premountFor={fps} name={`voice: ${s.id}`}>
						<Audio src={`${audioBase}${s.audio}`} />
					</Sequence>
				) : null,
			)}
		</>
	);
}

/**
 * One music bed. The track is laid end to end until the bed is full (each play is
 * its own Sequence, so render and preview loop the same way). Volume follows
 * the fade and the voice ducking frame by frame.
 */
function MusicBed({ span, st, fps }: { span: MusicSpan; st: Soundtrack; fps: number }) {
	const loop = span.trackFrames && span.trackFrames > fps ? span.trackFrames : span.durationInFrames;
	const plays = Math.ceil(span.durationInFrames / loop);
	return (
		<>
			{Array.from({ length: plays }, (_, k) => {
				const from = span.from + k * loop;
				const len = Math.min(loop, span.from + span.durationInFrames - from);
				return (
					<Sequence key={k} from={from} durationInFrames={len} premountFor={fps} name={`music: ${span.assetId}${plays > 1 ? ` (${k + 1})` : ""}`}>
						<Audio src={span.src} volume={(f) => musicVolumeAt(span, from + f, st)} />
					</Sequence>
				);
			})}
		</>
	);
}

function SoundLayer({ st, fps }: { st: Soundtrack; fps: number }) {
	return (
		<>
			{st.music.map((m, i) => (
				<MusicBed key={`m${i}`} span={m} st={st} fps={fps} />
			))}
			{st.sfx.map((s, i) => (
				<Sequence key={`s${i}`} from={s.frame} durationInFrames={s.durationInFrames} premountFor={fps} name={`sfx: ${s.role}`}>
					<Audio src={s.src} volume={s.volume} />
				</Sequence>
			))}
		</>
	);
}

/** Brand colours for the "brand" style, from a render's brand stamp. */
const stampColors = (b: BrandStamp): BrandColors => ({ ...b.colors, font: b.font === "Inter" ? undefined : b.font });

/** Brand intro, outro and watermark around the scenes (renders only: the Studio plan has no stamp). */
function BrandLayer({ b, timeline, dark }: { b: BrandStamp; timeline: Timeline; dark: boolean }) {
	const body = timeline.durationInFrames - timeline.intro - timeline.outro;
	return (
		<>
			{timeline.intro ? (
				<Sequence durationInFrames={timeline.intro} name="brand: intro">
					<BrandIntro b={b} />
				</Sequence>
			) : null}
			{b.watermark.enabled && body > 0 ? (
				<Sequence from={timeline.intro} durationInFrames={body} name="brand: watermark" layout="none">
					<Watermark b={b} dark={dark} />
				</Sequence>
			) : null}
			{timeline.outro ? (
				<Sequence from={timeline.durationInFrames - timeline.outro} durationInFrames={timeline.outro} name="brand: outro">
					<BrandOutro b={b} />
				</Sequence>
			) : null}
		</>
	);
}

/** The whole video: background, one Sequence per scene, chapter progress bar, brand layer. */
export function PlanVideo({ plan: input, style: override, audioBase, soundtrack, figureBase, figureMeta, brand }: PlanVideoProps) {
	const parsed = usePlan(input);
	const id = override ?? ("plan" in parsed ? parsed.plan.meta.style : "clean");
	const stamp = "plan" in parsed ? parsed.plan.meta.brand : undefined;
	const look = "plan" in parsed ? parsed.plan.meta.look : undefined;
	const colors = useMemo(() => brand ?? (stamp ? stampColors(stamp) : undefined), [brand, stamp]);
	const style = useMemo(() => styleFor(id, colors, look), [id, colors, look]);
	useFonts(style, stamp ? brandFontStack(stamp.font) : undefined);
	if ("error" in parsed) return <ProblemCard message={`This plan has a problem:\n${parsed.error}`} />;
	const { timeline } = parsed;
	const Background = style.Background;
	return (
		<AbsoluteFill style={{ background: style.bg }}>
			<Background />
			{timeline.scenes.map((t) => (
				<Sequence key={t.scene.id} from={t.from} durationInFrames={t.durationInFrames} name={`${t.scene.type}: ${t.scene.id}`}>
					<SceneProvider value={{ timed: t, style, figureBase, figureMeta }}>
						<SceneView scene={t.scene} />
					</SceneProvider>
					{audioBase ? <SceneVoice timed={t} audioBase={audioBase} fps={timeline.fps} /> : null}
				</Sequence>
			))}
			{soundtrack ? <SoundLayer st={soundtrack} fps={timeline.fps} /> : null}
			{timeline.chapters.length > 1 ? <ChapterProgress timeline={timeline} style={style} /> : null}
			{stamp ? <BrandLayer b={stamp} timeline={timeline} dark={style.dark} /> : null}
		</AbsoluteFill>
	);
}

/** Composition size and length from the plan (used by Root's calculateMetadata and by the Player). */
export function planMetadata(input: VideoPlanInput) {
	const r = VideoPlan.safeParse(input);
	if (!r.success) return { durationInFrames: 30, fps: 30, width: 1920, height: 1080 };
	const t = computeTimeline(r.data);
	return { durationInFrames: t.durationInFrames, fps: r.data.meta.fps, width: r.data.meta.width, height: r.data.meta.height };
}
