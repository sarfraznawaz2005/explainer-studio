import { toast } from "sonner";
import { create } from "zustand";
import { z } from "zod";
import { libraryEvents } from "@shared/ipc/library";
import { RenderJobView, RenderUpdate, renderChannels, renderEvents } from "@shared/ipc/render";
import { call, on } from "@renderer/lib/ipc";

type RenderState = {
	/** Latest update per engine-test job, so progress survives page changes. */
	jobs: Record<string, RenderUpdate>;
	/** The engine-test job shown in Settings → Rendering. */
	testJobId: string | null;
	/** Video render jobs, newest first. */
	queue: RenderJobView[];
	loaded: boolean;
	/** Bumped when videos or drafts change, so lists reload. */
	libraryVersion: number;
	refresh: () => Promise<void>;
};

export const useRenders = create<RenderState>((set) => ({
	jobs: {},
	testJobId: null,
	queue: [],
	loaded: false,
	libraryVersion: 0,
	refresh: async () => set({ queue: await call(renderChannels.jobs), loaded: true }),
}));

/** Hash navigation, so this store does not import the router (the router imports the pages that import this store). */
const go = (path: string) => {
	window.location.hash = path;
};

// One app-wide subscription; the store outlives every screen.
on(renderEvents.update, RenderUpdate, (u) => {
	const prev = useRenders.getState().jobs[u.jobId];
	useRenders.setState((s) => ({ jobs: { ...s.jobs, [u.jobId]: u } }));
	if (prev?.stage === u.stage) return;
	if (u.stage === "done") toast.success("Render complete", { description: "The video file is ready." });
	if (u.stage === "error") toast.error("Render failed", { description: u.error });
});

on(renderEvents.job, RenderJobView, (job) => {
	const list = useRenders.getState().queue;
	const prev = list.find((j) => j.id === job.id);
	const next = prev ? list.map((j) => (j.id === job.id ? job : j)) : [job, ...list];
	useRenders.setState({ queue: next });
	if (prev?.status === job.status) return;
	if (job.status === "done")
		toast.success("Video ready", { description: job.title, action: { label: "Open Videos", onClick: () => go("/library") } });
	else if (job.status === "error")
		toast.error("Render failed", { description: `${job.title}: ${job.error ?? "unknown error"}`, action: { label: "Open queue", onClick: () => go("/queue") } });
});

on(libraryEvents.changed, z.object({}), () => useRenders.setState((s) => ({ libraryVersion: s.libraryVersion + 1 })));

void useRenders.getState().refresh().catch(() => undefined);

export const isActive = (u: RenderUpdate | undefined) => !!u && !["done", "cancelled", "error"].includes(u.stage);
export const jobActive = (j: RenderJobView) => j.status === "queued" || j.status === "running";
