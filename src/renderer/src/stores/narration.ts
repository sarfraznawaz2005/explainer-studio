import { toast } from "sonner";
import { create } from "zustand";
import { voiceEvents } from "@shared/ipc/voice";
import { NarrationUpdate } from "@shared/narration";
import { on } from "@renderer/lib/ipc";

type NarrationStore = {
	/** Latest voice run update per draft. */
	byDraft: Record<string, NarrationUpdate>;
	/** Bumped when a run ends, so the Studio reloads the plan with the new timing. */
	finished: Record<string, number>;
};

export const useNarration = create<NarrationStore>(() => ({ byDraft: {}, finished: {} }));

on(voiceEvents.draft, NarrationUpdate, (u) => {
	useNarration.setState((s) => ({
		byDraft: { ...s.byDraft, [u.draftId]: u },
		finished: u.state === "running" ? s.finished : { ...s.finished, [u.draftId]: (s.finished[u.draftId] ?? 0) + 1 },
	}));
	if (u.state === "done")
		toast.success("Voice ready", { description: u.made ? `${u.made} new ${u.made === 1 ? "clip" : "clips"}, ${u.reused} reused from earlier.` : `All ${u.total} sentences were already voiced.` });
	else if (u.state === "error") toast.error("Voice failed", { description: u.error });
	else if (u.state === "cancelled") toast("Voice stopped", { description: u.detail });
});
