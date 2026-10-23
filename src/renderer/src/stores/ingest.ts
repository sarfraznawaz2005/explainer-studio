import { toast } from "sonner";
import { create } from "zustand";
import { IngestUpdate, ingestEvents, type Level, type OcrMode, type PickedFile } from "@shared/ipc/ingest";
import { on } from "@renderer/lib/ipc";

export type Item = { id: string; kind: "file"; file: PickedFile; pages: string } | { id: string; kind: "text"; title: string; text: string };

/** Page states for the page grid: the stage being worked on and which pages it has passed. */
export type PageTrack = { stage: string; done: number[]; current: number | null; method?: string };

type IngestStore = {
	items: Item[];
	level: Level;
	ocr: OcrMode;
	jobId: string | null;
	update: IngestUpdate | null;
	/** Per input file: the pages seen in the current stage. */
	tracks: Record<number, PageTrack>;
	draftId: string | null;
};

export const useIngest = create<IngestStore>(() => ({ items: [], level: "High school", ocr: "auto", jobId: null, update: null, tracks: {}, draftId: null }));

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
	if (u.state === "done") toast.success("Material read", { description: "Saved as a new draft." });
	else if (u.state === "error") toast.error("Could not read the material", { description: u.error });
	else if (u.state === "cancelled") toast("Reading stopped", { description: "Nothing was saved." });
});
