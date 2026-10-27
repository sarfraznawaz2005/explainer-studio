import type { Cue, Scene, VideoPlan } from "./schema";

/**
 * Turns a plan into frame numbers. Pure maths, shared by the Remotion bundle,
 * the in-app Player and the Studio timeline.
 *
 * A scene lasts: lead-in + every sentence (with a short gap after each) + tail,
 * and never less than its minDurationMs. Sentences use their measured voice
 * length when known, otherwise an estimate from words per minute.
 * Cues are tied to a sentence edge, so visuals stay in sync with the voice.
 */
export const LEAD_IN_MS = 400;
export const SENTENCE_GAP_MS = 250;
export const TAIL_MS = 700;
export const MIN_SENTENCE_MS = 1200;
export const MIN_SCENE_MS = 2500;

export function estimateSentenceMs(text: string, wordsPerMinute = 150): number {
	const words = text.trim().split(/\s+/).filter(Boolean).length;
	// Punctuation adds small natural pauses.
	const pauses = (text.match(/[,;:]/g)?.length ?? 0) * 150;
	return Math.max(MIN_SENTENCE_MS, Math.round((words / wordsPerMinute) * 60_000) + pauses);
}

export const msToFrames = (ms: number, fps: number) => Math.round((ms / 1000) * fps);

export type TimedSentence = { id: string; text: string; from: number; duration: number; estimated: boolean; audio?: string };
export type TimedCue = Cue & { frame: number };
/** Silent thinking time (scene-relative frames); `target` is the question it belongs to. */
export type TimedGap = { after: number; target: number; from: number; duration: number };
export type TimedScene = {
	scene: Scene;
	chapterIndex: number;
	/** Absolute first frame in the video. */
	from: number;
	durationInFrames: number;
	/** Sentence frames relative to the scene start. */
	sentences: TimedSentence[];
	/** Cue frames relative to the scene start, sorted. Includes generated default reveals. */
	cues: TimedCue[];
	/** Thinking pauses (pause-and-think, quiz). */
	gaps: TimedGap[];
};
export type Timeline = {
	fps: number;
	durationInFrames: number;
	/** Brand intro before the first scene and outro after the last, in frames (0 = none). */
	intro: number;
	outro: number;
	scenes: TimedScene[];
	chapters: { id: string; title: string; from: number; durationInFrames: number }[];
};

/** How many revealable items a scene has (bullets, steps, bars, code steps...). 0 = no reveals. */
export function revealCount(scene: Scene): number {
	switch (scene.type) {
		case "kinetic":
			return scene.props.lines.length;
		case "bullets":
		case "summary":
			return scene.props.items.length;
		case "glossary":
			return scene.props.terms.length;
		case "flow":
		case "cycle":
			return scene.props.steps.length;
		case "tree":
			return scene.props.nodes.length;
		case "mindmap":
			return scene.props.branches.length;
		case "diagram":
			return scene.props.labels.length;
		case "venn":
			return scene.props.sets.length + 1;
		case "compare":
			return 2;
		case "proscons":
			return scene.props.pros.length + scene.props.cons.length;
		case "chart":
			return scene.props.data.length;
		case "counter":
			return scene.props.counters.length;
		case "equation":
			return scene.props.steps.length;
		case "graph":
			return scene.props.functions.length + scene.props.points.length;
		case "code":
		case "trace":
			return scene.props.steps.length;
		case "table":
			return scene.props.rows.length;
		case "timeline":
			return scene.props.events.length;
		case "map":
			return scene.props.pins.length;
		case "analogy":
			return scene.props.pairs.length + (scene.props.limit ? 1 : 0);
		case "dialogue":
			return scene.props.lines.length;
		case "figure":
			return scene.props.callouts.length;
		case "quiz":
			return scene.props.questions.length;
		case "device":
			return scene.props.items.length;
		case "chat":
			return scene.props.messages.length;
		case "cta":
			return scene.props.points.length;
		default:
			return 0;
	}
}

/** Scene types whose items are focused one at a time (the state moves on) instead of revealed and kept. */
export const FOCUS_TYPES: ReadonlySet<Scene["type"]> = new Set(["code", "trace"]);

/**
 * Default reveals when the plan gives none: spread items over the sentences,
 * item k appearing at the start of sentence floor(k * n / items).
 */
export function defaultCues(scene: Scene): Cue[] {
	const items = revealCount(scene);
	if (!items || scene.cues.some((c) => c.action === "reveal" || c.action === "focus")) return [];
	const n = Math.max(1, scene.narration.length);
	const action = FOCUS_TYPES.has(scene.type) ? "focus" : "reveal";
	return Array.from({ length: items }, (_, k) => ({ at: Math.min(n - 1, Math.floor((k * n) / items)), edge: "start" as const, offsetMs: 0, action, target: k }));
}

/**
 * Silent thinking time inside a scene: after the question of a pause-and-think
 * scene, and after each quiz question. Keyed by the sentence it follows (-1 =
 * before the first sentence, when there is no narration).
 */
export function thinkGaps(scene: Scene): { after: number; ms: number; target: number }[] {
	if (scene.type === "pause") return [{ after: scene.narration.length ? 0 : -1, ms: scene.props.seconds * 1000, target: 0 }];
	if (scene.type !== "quiz") return [];
	const cues = [...scene.cues, ...defaultCues(scene)];
	const gaps: { after: number; ms: number; target: number }[] = [];
	scene.props.questions.forEach((_, k) => {
		const at = cues.find((c) => c.action === "reveal" && c.target === k)?.at ?? 0;
		const after = scene.narration.length ? Math.min(at, scene.narration.length - 1) : -1;
		// Two questions on one sentence share one pause.
		if (!gaps.some((g) => g.after === after)) gaps.push({ after, ms: scene.props.seconds * 1000, target: k });
	});
	return gaps;
}

export function timeScene(scene: Scene, fps: number, wordsPerMinute = 150): Omit<TimedScene, "from" | "chapterIndex"> {
	let t = LEAD_IN_MS;
	const sentences: TimedSentence[] = [];
	const edges: { start: number; end: number }[] = [];
	const gapSpec = thinkGaps(scene);
	const gaps: TimedGap[] = [];
	const addGap = (after: number) => {
		for (const g of gapSpec.filter((x) => x.after === after)) {
			gaps.push({ after, target: g.target, from: msToFrames(t, fps), duration: Math.max(1, msToFrames(g.ms, fps)) });
			t += g.ms + SENTENCE_GAP_MS;
		}
	};
	addGap(-1);
	scene.narration.forEach((s, i) => {
		const ms = s.durationMs ?? estimateSentenceMs(s.text, wordsPerMinute);
		edges.push({ start: t, end: t + ms });
		sentences.push({ id: s.id, text: s.text, from: msToFrames(t, fps), duration: Math.max(1, msToFrames(ms, fps)), estimated: s.durationMs === undefined, audio: s.durationMs === undefined ? undefined : s.audio });
		t += ms + SENTENCE_GAP_MS;
		addGap(i);
	});
	const spoken = scene.narration.length || gaps.length;
	const total = Math.max(t - SENTENCE_GAP_MS * (spoken ? 1 : 0) + TAIL_MS, scene.minDurationMs ?? 0, MIN_SCENE_MS);
	const durationInFrames = Math.max(1, msToFrames(total, fps));
	const cues = [...scene.cues, ...defaultCues(scene)]
		.map((c) => {
			const e = edges[c.at];
			const edgeMs = e ? (c.edge === "end" ? e.end : e.start) : LEAD_IN_MS;
			const frame = Math.min(durationInFrames - 1, Math.max(0, msToFrames(edgeMs + c.offsetMs, fps)));
			return { ...c, frame };
		})
		.sort((a, b) => a.frame - b.frame);
	return { scene, durationInFrames, sentences, cues, gaps };
}

export function computeTimeline(plan: VideoPlan): Timeline {
	const { fps, wordsPerMinute } = plan.meta;
	const intro = Math.round((plan.meta.brand?.intro ?? 0) * fps);
	const outro = Math.round((plan.meta.brand?.outro ?? 0) * fps);
	const scenes: TimedScene[] = [];
	const chapters: Timeline["chapters"] = [];
	let from = intro;
	plan.chapters.forEach((ch, chapterIndex) => {
		// The intro belongs to the first chapter, so chapters cover every frame (render parts, YouTube chapters at 0:00).
		const start = chapterIndex === 0 ? 0 : from;
		for (const scene of ch.scenes) {
			const t = timeScene(scene, fps, wordsPerMinute);
			scenes.push({ ...t, from, chapterIndex });
			from += t.durationInFrames;
		}
		chapters.push({ id: ch.id, title: ch.title, from: start, durationInFrames: from - start });
	});
	const last = chapters.at(-1);
	if (last) last.durationInFrames += outro;
	return { fps, durationInFrames: Math.max(1, from + outro), intro, outro, scenes, chapters };
}

/** First frame (scene-relative) at which a target is revealed or focused, or null if never. */
export function cueFrame(cues: TimedCue[], target: number, actions: Cue["action"][] = ["reveal"]): number | null {
	return cues.find((c) => c.target === target && actions.includes(c.action))?.frame ?? null;
}

/** The scene playing at an absolute frame. */
export function sceneAt(timeline: Timeline, frame: number): TimedScene | undefined {
	if (frame < (timeline.scenes[0]?.from ?? 0)) return timeline.scenes[0];
	return timeline.scenes.find((s) => frame >= s.from && frame < s.from + s.durationInFrames) ?? timeline.scenes.at(-1);
}

export function formatTime(frames: number, fps: number): string {
	const total = Math.floor(frames / fps);
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = total % 60;
	return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}
