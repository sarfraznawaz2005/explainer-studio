import { dialog, shell } from "electron";
import { brandChannels } from "@shared/ipc/brand";
import { seriesChannels } from "@shared/ipc/series";
import { storageChannels } from "@shared/ipc/storage";
import { appFolders } from "../app/folders";
import { writeLog } from "../app/logger";
import { getMainWindow } from "../app/window";
import { repos } from "../db/repos";
import { clearLogo, createKit, kitForDraft, kitView, listKits, removeKit, setDefaultKit, setLogo, updateKit } from "../brand";
import { notifyLibraryChanged } from "../render";
import { addToSeries, createSeries, listSeries, moveEpisode, removeFromSeries, removeSeries, updateSeries } from "../series";
import { cleanStorage, storageReport } from "../storage";
import { handle } from "./register";

const ok = { ok: true as const };

/** Brand kits, series and the Storage page: the creator extras. */
export function registerCreatorIpc(): void {
	handle(brandChannels.list, () => listKits());
	handle(brandChannels.create, ({ name, data }) => createKit(name, data));
	handle(brandChannels.update, ({ id, name, data }) => updateKit(id, name, data));
	handle(brandChannels.remove, async ({ id }) => {
		await removeKit(id);
		return ok;
	});
	handle(brandChannels.setDefault, ({ id }) => setDefaultKit(id));
	handle(brandChannels.pickLogo, async ({ id }) => {
		const win = getMainWindow();
		const opts = { title: "Choose a logo", properties: ["openFile"] as "openFile"[], filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp"] }] };
		const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
		// Only the path the user just picked in the OS dialog is read.
		if (r.canceled || !r.filePaths[0]) return null;
		return setLogo(id, r.filePaths[0]);
	});
	handle(brandChannels.clearLogo, ({ id }) => clearLogo(id));
	handle(brandChannels.forDraft, ({ draftId }) => {
		const d = repos.drafts.get(draftId);
		const k = d ? kitForDraft(d) : null;
		return k ? kitView(k) : null;
	});

	handle(seriesChannels.list, () => listSeries());
	handle(seriesChannels.create, (form) => createSeries(form));
	handle(seriesChannels.update, ({ id, form }) => updateSeries(id, form));
	handle(seriesChannels.remove, ({ id }) => {
		removeSeries(id);
		notifyLibraryChanged();
		return ok;
	});
	handle(seriesChannels.addDraft, ({ seriesId, draftId, applyLook }) => {
		const v = addToSeries(seriesId, draftId, applyLook);
		notifyLibraryChanged();
		return v;
	});
	handle(seriesChannels.removeDraft, ({ draftId }) => {
		removeFromSeries(draftId);
		notifyLibraryChanged();
		return ok;
	});
	handle(seriesChannels.move, ({ draftId, by }) => {
		const v = moveEpisode(draftId, by);
		notifyLibraryChanged();
		return v;
	});

	handle(storageChannels.report, () => storageReport());
	handle(storageChannels.clean, async ({ items }) => {
		const r = await cleanStorage(items);
		if (items.includes("leftovers")) notifyLibraryChanged();
		return r;
	});
	handle(storageChannels.reveal, async () => {
		const err = await shell.openPath(appFolders().root);
		if (err) writeLog("app", "warn", `open data folder: ${err}`);
		return ok;
	});
}
