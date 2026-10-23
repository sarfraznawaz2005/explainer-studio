import { dialog } from "electron";
import { readFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { ingestChannels, type PickedFile } from "@shared/ipc/ingest";
import { ACCEPTED_EXTENSIONS, Source } from "@shared/source";
import { appFolders } from "../app/folders";
import { getMainWindow } from "../app/window";
import { repos } from "../db/repos";
import { admitFile, cancelIngest, capabilities, startIngest } from "../ingest/jobs";
import { handle } from "./register";

const MAX_PREVIEW_BYTES = 8 * 1024 * 1024;

export function registerIngestIpc(): void {
	handle(ingestChannels.pick, async () => {
		const win = getMainWindow();
		const opts = {
			title: "Choose learning material",
			properties: ["openFile", "multiSelections"] as ("openFile" | "multiSelections")[],
			filters: [{ name: "Learning material", extensions: ACCEPTED_EXTENSIONS }],
		};
		const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
		if (r.canceled) return [];
		return (await Promise.all(r.filePaths.map(admitFile))).filter((f): f is PickedFile => !!f);
	});
	handle(ingestChannels.inspect, async ({ paths }) => (await Promise.all(paths.map(admitFile))).filter((f): f is PickedFile => !!f));
	handle(ingestChannels.capabilities, () => capabilities());
	handle(ingestChannels.start, (req) => ({ jobId: startIngest(req) }));
	handle(ingestChannels.cancel, ({ jobId }) => {
		cancelIngest(jobId);
		return { ok: true as const };
	});
	handle(ingestChannels.draft, ({ id }) => {
		const d = repos.drafts.get(id);
		if (!d) throw new Error("This draft was not found. It may have been deleted.");
		return { id: d.id, title: d.title, level: d.level, stage: d.stage, source: Source.parse(d.source), createdAt: d.createdAt, updatedAt: d.updatedAt };
	});
	handle(ingestChannels.figure, async ({ draftId, figureId }) => {
		const d = repos.drafts.get(draftId);
		if (!d) throw new Error("This draft was not found.");
		const fig = Source.parse(d.source).figures.find((f) => f.id === figureId);
		if (!fig) throw new Error("This figure was not found.");
		const dir = join(appFolders().drafts, draftId);
		const file = resolve(dir, fig.file);
		const rel = relative(dir, file);
		if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new Error("Figure path is outside the draft folder.");
		const buf = await readFile(file);
		if (buf.length > MAX_PREVIEW_BYTES) throw new Error("The figure is too large to preview.");
		return { url: `data:${fig.mediaType};base64,${buf.toString("base64")}` };
	});
}
