import { clipboard } from "electron";
import { libraryChannels } from "@shared/ipc/library";
import { duplicateDraft, duplicateForLevel, duplicateVideo, listDrafts, listVideos, removeDraft, removeVideo, revealVideo, videoPack } from "../library";
import { repos } from "../db/repos";
import { notifyLibraryChanged } from "../render";
import { renumber } from "../series";
import { handle } from "./register";

const ok = { ok: true as const };

export function registerLibraryIpc(): void {
	handle(libraryChannels.videos, () => listVideos());
	handle(libraryChannels.revealVideo, ({ videoId }) => {
		revealVideo(videoId);
		return ok;
	});
	handle(libraryChannels.pack, async ({ videoId }) => ({ text: await videoPack(videoId) }));
	handle(libraryChannels.copyPack, async ({ videoId }) => {
		const text = await videoPack(videoId);
		clipboard.writeText(text);
		return { chars: text.length };
	});
	handle(libraryChannels.removeVideo, async ({ videoId }) => {
		await removeVideo(videoId);
		notifyLibraryChanged();
		return ok;
	});
	handle(libraryChannels.duplicateVideo, async ({ videoId }) => {
		const draftId = await duplicateVideo(videoId);
		notifyLibraryChanged();
		return { draftId };
	});
	handle(libraryChannels.drafts, () => listDrafts());
	handle(libraryChannels.duplicateDraft, async ({ draftId }) => {
		const id = await duplicateDraft(draftId);
		notifyLibraryChanged();
		return { draftId: id };
	});
	handle(libraryChannels.duplicateForLevel, async ({ draftId, level }) => {
		const id = await duplicateForLevel(draftId, level);
		notifyLibraryChanged();
		return { draftId: id };
	});
	handle(libraryChannels.removeDraft, async ({ draftId }) => {
		const seriesId = repos.drafts.get(draftId)?.seriesId;
		await removeDraft(draftId);
		// The other episodes close the gap.
		if (seriesId) renumber(seriesId);
		notifyLibraryChanged();
		return ok;
	});
}
