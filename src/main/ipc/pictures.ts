import { dialog } from "electron";
import { pictureChannels } from "@shared/ipc/pictures";
import { ai } from "../ai";
import { writeLog } from "../app/logger";
import { getMainWindow } from "../app/window";
import { plannerAiFrom } from "../planner/ai";
import { estimateStep, plannerBusy, startPictures, visionReady } from "../planner/jobs";
import { addMine, anotherPicture, formatOfDraft, PictureError, PICTURE_EXTENSIONS, pictureFitter, picturesState, removePicture, updatePicture } from "../pictures/library";
import { handle } from "./register";

/** Changes wait while the planner runs for the draft: it saves the pictures it finds at the end. */
function notBusy(draftId: string) {
	if (plannerBusy(draftId)) throw new PictureError("Wait for the planner to finish, then change the pictures.");
}

export function registerPicturesIpc(): void {
	handle(pictureChannels.list, ({ draftId }) => picturesState(draftId, visionReady()));
	handle(pictureChannels.add, async ({ draftId }) => {
		notBusy(draftId);
		const win = getMainWindow();
		const opts = { title: "Add your pictures", properties: ["openFile", "multiSelections"] as ("openFile" | "multiSelections")[], filters: [{ name: "Pictures", extensions: PICTURE_EXTENSIONS }] };
		const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
		// Only the paths the user just picked in the OS dialog are read.
		if (!r.canceled && r.filePaths.length) {
			const { added, skipped } = await addMine(draftId, r.filePaths.slice(0, 40), pictureFitter());
			writeLog("pictures", "info", `draft ${draftId}: ${added} own pictures added${skipped.length ? `; skipped: ${skipped.join("; ")}` : ""}`);
			if (skipped.length && !added) throw new PictureError(`No picture was added. ${skipped[0]}`);
		}
		return picturesState(draftId, visionReady());
	});
	handle(pictureChannels.update, ({ draftId, id, caption, mustUse }) => {
		notBusy(draftId);
		updatePicture(draftId, id, { caption, mustUse });
		return picturesState(draftId, visionReady());
	});
	handle(pictureChannels.remove, async ({ draftId, id }) => {
		notBusy(draftId);
		await removePicture(draftId, id);
		return picturesState(draftId, visionReady());
	});
	handle(pictureChannels.estimate, ({ draftId, settings }) => estimateStep({ draftId, step: "pictures", settings }));
	handle(pictureChannels.find, async (req) => ({ jobId: await startPictures(req) }));
	handle(pictureChannels.another, async ({ draftId, id }) => {
		notBusy(draftId);
		const vision = visionReady();
		const ok = await anotherPicture(draftId, id, vision ? plannerAiFrom(ai(), draftId) : null, { log: (m) => writeLog("pictures", "info", m), fit: pictureFitter(), format: formatOfDraft(draftId) });
		if (!ok) throw new PictureError(vision ? "No other good picture was found for this subject." : "No other picture was found. Set up a vision model in Settings → AI to check more search results.");
		return picturesState(draftId, vision);
	});
}
