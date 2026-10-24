import { toast } from "sonner";
import { create } from "zustand";
import { PlannerUpdate, plannerEvents } from "@shared/ipc/planner";
import { on } from "@renderer/lib/ipc";

type PlannerStore = {
	/** Latest update per draft. Survives screen changes, so a run keeps showing when the user comes back. */
	byDraft: Record<string, PlannerUpdate>;
	/** Bumped when a run finishes, so open screens reload the draft. */
	finished: Record<string, number>;
};

export const usePlanner = create<PlannerStore>(() => ({ byDraft: {}, finished: {} }));

const STEP: Record<PlannerUpdate["step"], string> = { outline: "Outline", script: "Script and scenes", scene: "New scene", chapter: "New chapter", research: "Material", pictures: "Pictures", look: "New look" };
const DONE_HINT: Record<PlannerUpdate["step"], string> = {
	outline: "Check it, change anything, then approve it.",
	script: "Open it in the Studio to watch the preview.",
	scene: "Only that scene changed. Undo brings the old one back.",
	chapter: "Only that chapter changed. Undo brings the old one back.",
	pictures: "Check them in the Pictures card. The script uses them.",
	research: "Check it, then continue to the outline.",
	look: "The new look is in the Studio. Undo brings the old one back.",
};

on(plannerEvents.update, PlannerUpdate, (u) => {
	usePlanner.setState((s) => ({
		byDraft: { ...s.byDraft, [u.draftId]: u },
		finished: u.state === "running" ? s.finished : { ...s.finished, [u.draftId]: (s.finished[u.draftId] ?? 0) + 1 },
	}));
	if (u.state === "done") toast.success(`${STEP[u.step]} ready`, { description: DONE_HINT[u.step] });
	else if (u.state === "error") toast.error(`${STEP[u.step]} failed`, { description: u.error });
	else if (u.state === "cancelled") toast(`${STEP[u.step]} stopped`, { description: "Nothing was changed." });
});
