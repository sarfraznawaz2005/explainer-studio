import { dialog, shell } from "electron";
import { mkdir } from "node:fs/promises";
import { basename, extname } from "node:path";
import { assetChannels } from "@shared/ipc/assets";
import type { AssetKind, AssetView } from "@shared/assets";
import { getMainWindow } from "../app/window";
import { writeLog } from "../app/logger";
import {
	assetLibrary,
	cancelStarter,
	draftSound,
	freesoundKey,
	hasFreesoundKey,
	licensesDir,
	notifyAssetsChanged,
	saveDraftSound,
	setFreesoundKey,
	startStarter,
	starterStatus,
} from "../assets";
import { importFreesound, searchFreesound, testFreesoundKey } from "../assets/freesound";
import { handle } from "./register";

const FILTERS: Record<AssetKind, { name: string; extensions: string[] }> = {
	music: { name: "Audio", extensions: ["mp3", "ogg", "wav", "flac"] },
	sfx: { name: "Audio", extensions: ["mp3", "ogg", "wav", "flac"] },
	image: { name: "Images", extensions: ["png", "jpg", "jpeg", "webp"] },
	font: { name: "Fonts", extensions: ["ttf", "otf", "woff", "woff2"] },
};
const MAX_PICK = 50;

export function registerAssetIpc(): void {
	handle(assetChannels.list, (input) => assetLibrary.list(input?.kind).map(assetLibrary.view));
	handle(assetChannels.update, ({ id, patch }) => {
		const a = assetLibrary.view(assetLibrary.update(id, patch));
		notifyAssetsChanged();
		return a;
	});
	handle(assetChannels.usage, ({ id }) => ({ drafts: assetLibrary.usage(id) }));
	handle(assetChannels.remove, async ({ id }) => {
		await assetLibrary.remove(id);
		writeLog("assets", "info", `deleted asset ${id}`);
		notifyAssetsChanged();
		return { ok: true as const };
	});
	handle(assetChannels.import, async ({ kind, license }) => {
		const win = getMainWindow();
		const opts = { title: `Import ${kind === "sfx" ? "sound effects" : kind}`, properties: ["openFile", "multiSelections"] as ("openFile" | "multiSelections")[], filters: [FILTERS[kind]] };
		const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
		const added: AssetView[] = [];
		const failed: { name: string; error: string }[] = [];
		let existing = 0;
		if (r.canceled) return { added, existing, failed };
		// Only the paths the user just picked in the OS dialog are read.
		for (const path of r.filePaths.slice(0, MAX_PICK)) {
			const name = basename(path);
			try {
				const res = await assetLibrary.addFile(path, { kind, title: basename(path, extname(path)), source: "import", license: license.license, author: license.author, sourceUrl: license.sourceUrl });
				if (res.existed) existing++;
				else added.push(assetLibrary.view(res.asset));
			} catch (err) {
				failed.push({ name, error: (err as Error).message });
			}
		}
		if (added.length) notifyAssetsChanged();
		writeLog("assets", "info", `import ${kind}: ${added.length} added, ${existing} already there, ${failed.length} failed`);
		return { added, existing, failed };
	});
	handle(assetChannels.revealLicenses, async () => {
		await mkdir(licensesDir(), { recursive: true });
		const err = await shell.openPath(licensesDir());
		if (err) throw new Error(err);
		return { ok: true as const };
	});

	handle(assetChannels.starterStatus, () => starterStatus());
	handle(assetChannels.starterInstall, () => {
		startStarter();
		return { ok: true as const };
	});
	handle(assetChannels.starterCancel, () => {
		cancelStarter();
		return { ok: true as const };
	});

	handle(assetChannels.freesoundKey, () => ({ set: hasFreesoundKey() }));
	handle(assetChannels.freesoundSetKey, async ({ key }) => {
		if (key) await testFreesoundKey(key);
		await setFreesoundKey(key);
		return { set: !!key };
	});
	handle(assetChannels.freesoundSearch, async (q) => {
		const urls = new Set(assetLibrary.list().map((a) => a.sourceUrl).filter(Boolean));
		return searchFreesound(await freesoundKey(), q, { imported: (u) => urls.has(u) });
	});
	handle(assetChannels.freesoundImport, async ({ id, kind }) => {
		const r = await importFreesound(await freesoundKey(), id, kind, { lib: assetLibrary });
		writeLog("assets", "info", `freesound import ${id} as ${kind}: ${r.existed ? "already there" : "added"} (${r.asset.license})`);
		if (!r.existed) notifyAssetsChanged();
		return { asset: assetLibrary.view(r.asset), existed: r.existed };
	});

	handle(assetChannels.draftSound, ({ draftId }) => draftSound(draftId));
	handle(assetChannels.setDraftSound, ({ draftId, setup }) => saveDraftSound(draftId, setup));
}
