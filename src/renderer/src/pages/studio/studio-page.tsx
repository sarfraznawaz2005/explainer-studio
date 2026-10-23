import { Player, type PlayerRef } from "@remotion/player";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { AlertCircle, Check, ChevronLeft, ChevronRight, CloudUpload, FileStack, Loader2, PanelRight, Pause, Play, Plus, Redo2, Sparkles, Undo2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { assetChannels, type DraftSound } from "@shared/ipc/assets";
import { plannerChannels } from "@shared/ipc/planner";
import { voiceChannels } from "@shared/ipc/voice";
import type { NarrationStatus } from "@shared/narration";
import { historyOf, pushEdit, redo, redoLabel, replacePresent, undo, undoLabel, type History } from "@shared/plan/history";
import { STYLE_IDS, VideoPlan, type Scene, type StyleId, type VideoPlanInput } from "@shared/plan/schema";
import { buildSoundtrack } from "@shared/plan/soundtrack";
import { computeTimeline, formatTime, msToFrames, sceneAt } from "@shared/plan/timing";
import { PlanVideo, type PlanVideoProps } from "@video/plan/PlanVideo";
import type { BrandColors } from "@video/styles/styles";
import { brandChannels } from "@shared/ipc/brand";
import { SAMPLE_PLAN } from "@video/samples/web-page-journey";
import { Button } from "@renderer/components/ui/button";
import { EmptyState } from "@renderer/components/ui/misc";
import { Select } from "@renderer/components/ui/select";
import { Badge, Kbd, PageHeader, Tooltip } from "@renderer/components/ui/primitives";
import { toast } from "sonner";
import { call, errorText } from "@renderer/lib/ipc";
import { cn } from "@renderer/lib/utils";
import { useAssets } from "@renderer/stores/assets";
import { useNarration } from "@renderer/stores/narration";
import { usePlanner } from "@renderer/stores/planner";
import { RegenerateDialog } from "./edit-panel";
import { Inspector, type InspectorEdit } from "./inspector";
import { RenderButton } from "./render-dialog";
import { SceneList } from "./scene-list";
import { SoundControls } from "./sound-panel";
import { TimelineStrip } from "./timeline-strip";
import { VoiceControls } from "./voice-panel";

const STYLE_LABELS: Record<StyleId, string> = { clean: "Clean", chalkboard: "Chalkboard", paper: "Paper", blueprint: "Blueprint", neon: "Neon", cartoon: "Cartoon", academic: "Academic", brand: "Brand" };
const STYLE_OPTIONS = STYLE_IDS.map((value) => ({ value, label: STYLE_LABELS[value] }));

/** The plan with one scene replaced (same id). */
function withScene(plan: VideoPlan, scene: Scene): VideoPlan {
	return { ...plan, chapters: plan.chapters.map((c) => (c.scenes.some((x) => x.id === scene.id) ? { ...c, scenes: c.scenes.map((x) => (x.id === scene.id ? scene : x)) } : c)) };
}

/** The words of every sentence, to see whether an edit needs new voice clips. */
const spoken = (p: VideoPlan) => p.chapters.flatMap((c) => c.scenes.flatMap((s) => s.narration.map((n) => `${n.id}\u0000${n.text}`))).join("\n");

export type SaveState = "saved" | "saving" | "error";

/** What the editor shows and calls for a draft that can be edited. */
export type EditorControls = {
	draftId: string;
	busy: boolean;
	busyDetail: string | null;
	save: SaveState;
	canUndo: string | null;
	canRedo: string | null;
	apply: (next: VideoPlan, label: string) => Promise<void>;
	undo: () => void;
	redo: () => void;
	retry: () => void;
	onRewriteStarted: (label: string) => void;
};

function useMediaQuery(query: string): boolean {
	const [match, setMatch] = useState(() => window.matchMedia(query).matches);
	useEffect(() => {
		const mq = window.matchMedia(query);
		const on = () => setMatch(mq.matches);
		mq.addEventListener("change", on);
		return () => mq.removeEventListener("change", on);
	}, [query]);
	return match;
}

function NoDraft() {
	const navigate = useNavigate();
	return (
		<div className="w-full px-6 py-6">
			<PageHeader title="Studio" description="Preview and edit a draft scene by scene." />
			<EmptyState
				icon={Sparkles}
				title="No draft open"
				description="Open a draft to see the live preview, its scenes and the timing of every sentence. You can also open the sample video to look around."
				actions={
					<>
						<Button asChild>
							<Link to="/new">
								<Plus />
								New video
							</Link>
						</Button>
						<Button variant="outline" onClick={() => void navigate({ to: "/studio", search: { draft: "sample" } })}>
							<Play />
							Open sample video
						</Button>
						<Button variant="ghost" asChild>
							<Link to="/drafts">
								<FileStack />
								Drafts
							</Link>
						</Button>
					</>
				}
			/>
		</div>
	);
}

export function StudioPage() {
	const { draft } = useSearch({ strict: false });
	if (draft === "sample") return <StudioEditor input={SAMPLE_PLAN} isSample />;
	if (draft) return <DraftStudio key={draft} draftId={draft} />;
	return <NoDraft />;
}

/** A draft from the database. Drafts without a plan send the user back to the wizard. Edits autosave; undo and redo cover every edit. */
function DraftStudio({ draftId }: { draftId: string }) {
	const [state, setState] = useState<{ voice: NarrationStatus | null; error: string | null; loading: boolean }>({ voice: null, error: null, loading: true });
	const [hist, setHist] = useState<History<VideoPlan> | null>(null);
	const histRef = useRef<History<VideoPlan> | null>(null);
	histRef.current = hist;
	const [save, setSave] = useState<SaveState>("saved");
	const [sound, setSound] = useState<DraftSound | null>(null);
	const [brand, setBrand] = useState<BrandColors | undefined>();
	const finished = useNarration((s) => s.finished[draftId] ?? 0);
	const library = useAssets((s) => s.version);
	const planner = usePlanner((s) => s.byDraft[draftId]);
	const plannerDone = usePlanner((s) => s.finished[draftId] ?? 0);
	const busy = planner?.state === "running";
	const rewrite = useRef<string | null>(null);
	const chain = useRef<Promise<unknown>>(Promise.resolve());
	const voiceRef = useRef<NarrationStatus | null>(null);
	voiceRef.current = state.voice;

	// The kit renders use, so the "Brand" style looks the same here.
	useEffect(() => {
		void call(brandChannels.forDraft, { draftId })
			.then((k) => setBrand(k ? { ...k.data.colors, font: k.data.font === "Inter" ? undefined : k.data.font } : undefined))
			.catch(() => setBrand(undefined));
	}, [draftId]);

	const load = useCallback(async () => {
		try {
			const [d, voice] = await Promise.all([call(plannerChannels.get, { draftId }), call(voiceChannels.draftStatus, { draftId }).catch(() => null)]);
			const plan = d.plan ? VideoPlan.parse(d.plan) : null;
			const label = rewrite.current;
			rewrite.current = null;
			if (plan) setHist((h) => (!h ? historyOf(plan) : label ? pushEdit(h, plan, label) : replacePresent(h, plan)));
			setState({ voice, error: plan ? null : "This draft has no script yet.", loading: false });
		} catch (err) {
			setState({ voice: null, error: errorText(err), loading: false });
		}
	}, [draftId]);
	// Reload when a voice run ends (new timing) and whenever the voice settings dialog saves.
	useEffect(() => {
		void load();
	}, [load, finished]);
	// An AI rewrite ended: done brings the new part in as one undo step; error or stop changes nothing.
	useEffect(() => {
		if (!plannerDone) return;
		if (planner?.state !== "done") rewrite.current = null;
		void load();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [plannerDone]);
	// Music and effects: reload when the library changes (starter pack, imports, deletes).
	useEffect(() => {
		void call(assetChannels.draftSound, { draftId })
			.then(setSound)
			.catch(() => setSound(null));
	}, [draftId, library]);

	/** Saves one state in order. The reply carries the stored plan (voice clips kept for unchanged sentences). */
	const persist = useCallback(
		(plan: VideoPlan, before: VideoPlan | null) => {
			setSave("saving");
			const run = chain.current.then(async () => {
				try {
					const r = await call(plannerChannels.savePlan, { draftId, plan });
					setHist((h) => (h && h.present === plan ? replacePresent(h, r.plan) : h));
					setSave("saved");
					// A draft that already has voice keeps it complete: changed sentences are voiced right away (the rest come from the cache).
					const v = voiceRef.current;
					if (before && spoken(before) !== spoken(plan) && v?.engineReady && v.voiced > 0 && !v.running) await call(voiceChannels.draftStart, { draftId }).catch(() => undefined);
				} catch (err) {
					setSave("error");
					toast.error("Could not save the change", { description: errorText(err) });
				}
			});
			chain.current = run;
			return run;
		},
		[draftId],
	);

	const controls = useMemo<EditorControls | null>(() => {
		if (!hist) return null;
		return {
			draftId,
			busy,
			busyDetail: busy ? (planner?.detail ?? "Working") : null,
			save,
			canUndo: busy ? null : undoLabel(hist),
			canRedo: busy ? null : redoLabel(hist),
			apply: async (next, label) => {
				const h = histRef.current;
				if (!h || busy) return;
				setHist(pushEdit(h, next, label));
				await persist(next, h.present);
			},
			undo: () => {
				const h = histRef.current;
				if (!h || busy || !h.past.length) return;
				const n = undo(h);
				setHist(n);
				toast(`Undid: ${undoLabel(h)}`, { duration: 1500 });
				void persist(n.present, h.present);
			},
			redo: () => {
				const h = histRef.current;
				if (!h || busy || !h.future.length) return;
				const n = redo(h);
				setHist(n);
				toast(`Redid: ${redoLabel(h)}`, { duration: 1500 });
				void persist(n.present, h.present);
			},
			retry: () => {
				const h = histRef.current;
				if (h) void persist(h.present, null);
			},
			onRewriteStarted: (label) => {
				rewrite.current = label;
			},
		};
	}, [hist, busy, planner?.detail, save, draftId, persist]);

	const saveSentence = useCallback(
		async (sentenceId: string, text: string) => {
			const h = histRef.current;
			if (!h || !controls) return;
			const next: VideoPlan = {
				...h.present,
				chapters: h.present.chapters.map((c) => ({ ...c, scenes: c.scenes.map((sc) => ({ ...sc, narration: sc.narration.map((n) => (n.id === sentenceId ? { id: n.id, text } : n)) })) })),
			};
			await controls.apply(next, "Edit sentence");
		},
		[controls],
	);

	if (state.loading)
		return (
			<div className="grid h-full place-items-center text-[13px] text-muted-foreground">
				<span className="flex items-center gap-2">
					<Loader2 className="size-4 animate-spin" /> Opening the draft…
				</span>
			</div>
		);
	if (!hist)
		return (
			<div className="w-full px-6 py-6">
				<PageHeader title="Studio" description="Preview and edit a draft scene by scene." />
				<EmptyState
					icon={Sparkles}
					title="Nothing to preview yet"
					description={`${state.error ?? ""} Finish the outline and the script in New video first.`}
					actions={
						<Button asChild>
							<Link to="/new" search={/^[0-9a-f-]{36}$/i.test(draftId) ? { draft: draftId } : {}}>
								Continue planning
							</Link>
						</Button>
					}
				/>
			</div>
		);
	return (
		<StudioEditor
			input={hist.present}
			backTo={draftId}
			audioBase={state.voice?.audioBase}
			figureBase={`es-media://figure/${draftId}/`}
			brand={brand}
			onSaveSentence={saveSentence}
			sound={sound}
			editor={controls ?? undefined}
			voiceControls={state.voice ? <VoiceControls draftId={draftId} status={state.voice} onChanged={() => void load()} /> : null}
			soundControls={(plan) => (sound ? <SoundControls draftId={draftId} plan={plan} sound={sound} onChange={setSound} /> : null)}
			renderControl={<RenderButton draftId={draftId} />}
		/>
	);
}

function SaveBadge({ editor }: { editor: EditorControls }) {
	if (editor.busy)
		return (
			<span className="flex items-center gap-1.5 text-[12px] text-primary" data-testid="save-state" aria-live="polite">
				<Loader2 className="size-3.5 animate-spin" />
				{editor.busyDetail}
			</span>
		);
	if (editor.save === "saving")
		return (
			<span className="flex items-center gap-1.5 text-[12px] text-muted-foreground" data-testid="save-state" aria-live="polite">
				<CloudUpload className="size-3.5" />
				Saving…
			</span>
		);
	if (editor.save === "error")
		return (
			<button type="button" onClick={editor.retry} className="flex items-center gap-1.5 text-[12px] text-danger hover:underline" data-testid="save-state">
				<AlertCircle className="size-3.5" />
				Not saved. Try again
			</button>
		);
	return (
		<span className="flex items-center gap-1.5 text-[12px] text-muted-foreground" data-testid="save-state" aria-live="polite">
			<Check className="size-3.5" />
			Saved
		</span>
	);
}

function StudioEditor({
	input,
	isSample,
	backTo,
	audioBase,
	onSaveSentence,
	voiceControls,
	sound,
	soundControls,
	renderControl,
	editor,
	figureBase,
	brand,
}: {
	input: VideoPlanInput;
	isSample?: boolean;
	backTo?: string;
	audioBase?: string;
	onSaveSentence?: (sentenceId: string, text: string) => Promise<void>;
	voiceControls?: React.ReactNode;
	sound?: DraftSound | null;
	soundControls?: (plan: VideoPlan) => React.ReactNode;
	renderControl?: React.ReactNode;
	editor?: EditorControls;
	figureBase?: string;
	/** Brand kit colours for the "Brand" style (the same kit renders use). */
	brand?: BrandColors;
}) {
	const plan = useMemo(() => VideoPlan.parse(input), [input]);
	const [chapterRewrite, setChapterRewrite] = useState<{ id: string; title: string } | null>(null);
	const timeline = useMemo(() => computeTimeline(plan), [plan]);
	const chapterTitles = useMemo(() => plan.chapters.map((c) => c.title), [plan]);
	const style = plan.meta.style;
	const [sampleStyle, setSampleStyle] = useState<StyleId>(plan.meta.style);
	const shownStyle = editor ? style : sampleStyle;
	// In a draft the style is part of the plan (saved, undoable); the sample only previews.
	const setStyle = (v: StyleId) => (editor ? void editor.apply({ ...plan, meta: { ...plan.meta, style: v } }, `Style: ${STYLE_LABELS[v]}`) : setSampleStyle(v));
	// Open one second in: frame 0 is the start of a fade-in and looks blank.
	const [startFrame] = useState(() => Math.min(timeline.durationInFrames - 1, timeline.fps));
	const [frame, setFrame] = useState(startFrame);
	const [playing, setPlaying] = useState(false);
	const [picked, setPicked] = useState<string | undefined>(undefined);
	const [inspectorOpen, setInspectorOpen] = useState(true);
	const wide = useMediaQuery("(min-width: 1500px)");
	const player = useRef<PlayerRef>(null);

	// The Player keeps its own clock; mirror it so the list, timeline and inspector follow along.
	useEffect(() => {
		const p = player.current;
		if (!p) return;
		// Development builds only: lets the voice sync test read the Player clock.
		if (import.meta.env.DEV) (window as unknown as { __esPlayer?: PlayerRef }).__esPlayer = p;
		const onFrame = (e: { detail: { frame: number } }) => setFrame(e.detail.frame);
		const onPlay = () => setPlaying(true);
		const onPause = () => setPlaying(false);
		p.addEventListener("frameupdate", onFrame);
		p.addEventListener("seeked", onFrame);
		p.addEventListener("play", onPlay);
		p.addEventListener("pause", onPause);
		p.addEventListener("ended", onPause);
		return () => {
			p.removeEventListener("frameupdate", onFrame);
			p.removeEventListener("seeked", onFrame);
			p.removeEventListener("play", onPlay);
			p.removeEventListener("pause", onPause);
			p.removeEventListener("ended", onPause);
		};
	}, []);

	const active = sceneAt(timeline, frame);
	// While playing, the inspector follows the playhead. A click pins a scene until playback moves on.
	const selected = (playing ? active : timeline.scenes.find((s) => s.scene.id === picked)) ?? active;
	const sceneIndex = active ? timeline.scenes.indexOf(active) : 0;

	const seek = useCallback((f: number) => {
		player.current?.seekTo(f);
		setFrame(f);
	}, []);

	const pickScene = useCallback(
		(id: string) => {
			const s = timeline.scenes.find((x) => x.scene.id === id);
			if (!s) return;
			setPicked(id);
			// Land just after the enter transition, so a paused preview is not a blank fade-in frame.
			seek(s.from + Math.min(s.durationInFrames - 1, msToFrames(s.scene.transition.durationMs, timeline.fps) + 6));
		},
		[timeline, seek],
	);

	const step = useCallback(
		(delta: number) => {
			const next = timeline.scenes[Math.min(timeline.scenes.length - 1, Math.max(0, sceneIndex + delta))];
			if (next) pickScene(next.scene.id);
		},
		[timeline, sceneIndex, pickScene],
	);

	// Ctrl+Z undoes, Ctrl+Y or Ctrl+Shift+Z redoes. Fields keep their own undo while typing.
	useEffect(() => {
		if (!editor) return;
		const onKey = (e: KeyboardEvent) => {
			const t = e.target instanceof Element ? e.target : null;
			if (t?.closest("input, textarea, [contenteditable=true], [role=dialog]") || !(e.ctrlKey || e.metaKey) || e.altKey) return;
			const k = e.key.toLowerCase();
			if (k === "z" && !e.shiftKey) editor.undo();
			else if (k === "y" || (k === "z" && e.shiftKey)) editor.redo();
			else return;
			e.preventDefault();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [editor]);

	// Space plays/pauses, [ and ] jump between scenes. Ignored while typing.
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			const t = e.target instanceof Element ? e.target : null;
			if (t?.closest("input, textarea, select, button, [role=slider], [contenteditable=true], [role=dialog]") || e.ctrlKey || e.metaKey || e.altKey) return;
			if (e.key === " ") player.current?.toggle();
			else if (e.key === "]") step(1);
			else if (e.key === "[") step(-1);
			else return;
			e.preventDefault();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [step]);

	const soundtrack = useMemo(() => (sound ? buildSoundtrack(plan, timeline, sound.setup, sound.library, { seed: sound.seed, roleDefaults: sound.roleDefaults }) : undefined), [plan, timeline, sound]);
	// Development builds only: lets the sound test read the mix.
	if (import.meta.env.DEV) (window as unknown as { __esSoundtrack?: unknown }).__esSoundtrack = soundtrack;
	const inputProps = useMemo<PlanVideoProps>(() => ({ plan: input, style: shownStyle, audioBase, soundtrack, figureBase, brand }), [input, shownStyle, audioBase, soundtrack, figureBase, brand]);
	const localFrame = selected && frame >= selected.from && frame < selected.from + selected.durationInFrames ? frame - selected.from : null;
	const edit = useMemo<InspectorEdit | undefined>(
		() =>
			editor
				? {
						draftId: editor.draftId,
						disabled: editor.busy,
						onEdit: (scene, label) => void editor.apply(withScene(plan, scene), label),
						onRewriteStarted: () => editor.onRewriteStarted("Rewrite scene with AI"),
					}
				: undefined,
		[editor, plan],
	);
	const inspector = <Inspector key={selected?.scene.id} timed={selected} fps={timeline.fps} localFrame={localFrame} audioBase={audioBase} onSaveSentence={onSaveSentence} edit={edit} />;

	return (
		<div className="flex h-full min-h-0 flex-col">
			{/* Wraps to a second row when the window is too narrow for every control. */}
			<header className="flex min-h-14 shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b px-5 py-2">
				<div className="min-w-[160px] flex-1">
					<div className="flex items-center gap-2">
						<h1 className="truncate text-[15px] font-semibold tracking-tight">{plan.meta.title}</h1>
						{isSample ? <Badge tone="primary">Sample</Badge> : null}
					</div>
					<div className="text-[12px] text-muted-foreground">
						{plan.meta.level} · {timeline.scenes.length} scenes · {formatTime(timeline.durationInFrames, timeline.fps)}
					</div>
				</div>
				<div className="ml-auto flex flex-wrap items-center justify-end gap-2">
					{editor ? (
						<div className="flex items-center gap-1 border-r pr-2">
							<SaveBadge editor={editor} />
							<Tooltip content={editor.canUndo ? `Undo: ${editor.canUndo}  Ctrl+Z` : "Nothing to undo"}>
								<Button variant="ghost" size="icon-sm" aria-label="Undo" data-testid="undo" disabled={!editor.canUndo} onClick={editor.undo}>
									<Undo2 />
								</Button>
							</Tooltip>
							<Tooltip content={editor.canRedo ? `Redo: ${editor.canRedo}  Ctrl+Y` : "Nothing to redo"}>
								<Button variant="ghost" size="icon-sm" aria-label="Redo" data-testid="redo" disabled={!editor.canRedo} onClick={editor.redo}>
									<Redo2 />
								</Button>
							</Tooltip>
						</div>
					) : null}
					{voiceControls}
					{soundControls?.(plan)}
					{backTo ? (
						<Tooltip content="Back to the outline and checks">
							<Button variant="ghost" size="sm" asChild>
								<Link to="/new" search={{ draft: backTo }}>
									<ChevronLeft />
									Outline
								</Link>
							</Button>
						</Tooltip>
					) : null}
					<div className="w-32">
						<Select<StyleId> ariaLabel="Visual style" value={shownStyle} onChange={setStyle} disabled={editor?.busy} options={STYLE_OPTIONS} />
					</div>
					{!wide ? null : (
						<Tooltip content={inspectorOpen ? "Hide details" : "Show details"}>
							<Button variant="ghost" size="icon-sm" aria-label="Toggle details panel" aria-pressed={inspectorOpen} onClick={() => setInspectorOpen((v) => !v)}>
								<PanelRight />
							</Button>
						</Tooltip>
					)}
					{renderControl}
				</div>
			</header>

			<div className="flex min-h-0 flex-1">
				<aside className="w-64 shrink-0 overflow-y-auto border-r bg-subtle/50">
					<SceneList
						timeline={timeline}
						chapterTitles={chapterTitles}
						activeId={active?.scene.id}
						selectedId={selected?.scene.id}
						onPick={pickScene}
						onRewriteChapter={editor && !editor.busy ? (i) => setChapterRewrite({ id: plan.chapters[i]!.id, title: plan.chapters[i]!.title }) : undefined}
					/>
				</aside>

				<div className="min-w-0 flex-1 overflow-y-auto">
					<div className="flex w-full flex-col gap-4 p-5">
						<div className="overflow-hidden rounded-xl border bg-black shadow-md">
							<Player
								ref={player}
								initialFrame={startFrame}
								component={PlanVideo}
								inputProps={inputProps}
								durationInFrames={timeline.durationInFrames}
								fps={timeline.fps}
								compositionWidth={plan.meta.width}
								compositionHeight={plan.meta.height}
								style={{ width: "100%", aspectRatio: `${plan.meta.width} / ${plan.meta.height}` }}
								controls
								clickToPlay
								doubleClickToFullscreen
								spaceKeyToPlayOrPause={false}
								acknowledgeRemotionLicense
							/>
						</div>

						<div className="flex items-center gap-1.5">
							<Tooltip content="Previous scene  [">
								<Button variant="outline" size="icon-sm" aria-label="Previous scene" onClick={() => step(-1)} disabled={sceneIndex === 0}>
									<ChevronLeft />
								</Button>
							</Tooltip>
							<Button variant="outline" size="sm" className="w-24" onClick={() => player.current?.toggle()}>
								{playing ? <Pause /> : <Play />}
								{playing ? "Pause" : "Play"}
							</Button>
							<Tooltip content="Next scene  ]">
								<Button variant="outline" size="icon-sm" aria-label="Next scene" onClick={() => step(1)} disabled={sceneIndex >= timeline.scenes.length - 1}>
									<ChevronRight />
								</Button>
							</Tooltip>
							<span className="ml-2 text-[12px] tabular-nums text-muted-foreground">
								Scene {sceneIndex + 1} of {timeline.scenes.length}
							</span>
							<span className="ml-auto hidden items-center gap-1 text-[11px] text-muted-foreground min-[1250px]:flex">
								<Kbd>Space</Kbd> play <Kbd>[</Kbd>
								<Kbd>]</Kbd> scenes
							</span>
						</div>

						<TimelineStrip timeline={timeline} chapterTitles={chapterTitles} frame={frame} selectedId={selected?.scene.id} onSeek={seek} soundtrack={soundtrack} />

						{!wide ? <div className="overflow-hidden rounded-xl border bg-card">{inspector}</div> : null}
					</div>
				</div>

				{wide ? (
					<aside className={cn("shrink-0 overflow-x-hidden overflow-y-auto border-l bg-card transition-[width] duration-200", inspectorOpen ? "w-80" : "w-0 border-l-0")} aria-label="Scene details">
						<div className="w-80">{inspector}</div>
					</aside>
				) : null}
			</div>
			{editor && chapterRewrite ? (
				<RegenerateDialog
					draftId={editor.draftId}
					target={{ kind: "chapter", chapterId: chapterRewrite.id }}
					title={`Rewrite “${chapterRewrite.title}” with AI`}
					open
					onOpenChange={(o) => !o && setChapterRewrite(null)}
					onStarted={() => editor.onRewriteStarted("Rewrite chapter with AI")}
				/>
			) : null}
		</div>
	);
}
