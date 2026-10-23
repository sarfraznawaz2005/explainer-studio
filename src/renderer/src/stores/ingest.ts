import { toast } from "sonner";
import { create } from "zustand";
import { IngestUpdate, ingestEvents, type Level, type OcrMode, type PickedFile } from "@shared/ipc/ingest";
import type { Tone, VideoFormat } from "@shared/planner";
import { on } from "@renderer/lib/ipc";

export type Item = { id: string; kind: "file"; file: PickedFile; pages: string } | { id: string; kind: "text"; title: string; text: string };

/** Page states for the page grid: the stage being worked on and which pages it has passed. */
export type PageTrack = { stage: string; done: number[]; current: number | null; method?: string };

/** The "From a topic" form. Kept here so it survives leaving the page. */
export type TopicForm = { topic: string; minutes: number; instructions: string; language: string; tone: Tone; format: VideoFormat };

type IngestStore = {
	/** Where the material comes from: the user's files and text, or the AI writing it from a topic. */
	mode: "files" | "topic";
	topic: TopicForm;
	items: Item[];
	level: Level;
	ocr: OcrMode;
	jobId: string | null;
	update: IngestUpdate | null;
	/** Per input file: the pages seen in the current stage. */
	tracks: Record<number, PageTrack>;
	draftId: string | null;
};

export const useIngest = create<IngestStore>(() => ({
	mode: "files",
	topic: { topic: "", minutes: 5, instructions: "", language: "en", tone: "Friendly", format: "landscape" },
	items: [], level: "High school", ocr: "auto", jobId: null, update: null, tracks: {}, draftId: null }));

let seq = 0;
export const newItemId = () => `i${++seq}`;

export const isRunning = (u: IngestUpdate | null) => u?.state === "running";

// One subscription for the app: reading continues while the user visits other screens.
on(ingestEvents.update, IngestUpdate, (u) => {
	const s = useIngest.getState();
	if (u.jobId !== s.jobId) return;
	const tracks = { ...s.tracks };
	const p = u.progress;
	if (p?.page !== undefined) {
		const t = tracks[p.fileIndex];
		const stage = `${p.stage}:${p.method ?? ""}`;
		if (!t || t.stage !== stage) tracks[p.fileIndex] = { stage, done: [], current: p.page, method: p.method };
		else {
			const done = t.current !== null && t.current !== p.page && !t.done.includes(t.current) ? [...t.done, t.current] : t.done;
			tracks[p.fileIndex] = { ...t, done, current: p.page };
		}
	}
	useIngest.setState({ update: u, tracks, draftId: u.draftId ?? s.draftId });
	const topic = s.mode === "topic";
	if (u.state === "done") toast.success(topic ? "Material written" : "Material read", { description: "Saved as a new draft." });
	else if (u.state === "error") toast.error(topic ? "Could not write the material" : "Could not read the material", { description: u.error });
	else if (u.state === "cancelled") toast(topic ? "Writing stopped" : "Reading stopped", { description: "Nothing was saved." });
});
