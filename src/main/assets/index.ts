import { join } from "node:path";
import { SoundSetup, type StarterStatus } from "@shared/assets";
import { assetEvents, type DraftSound } from "@shared/ipc/assets";
import { appFolders } from "../app/folders";
import { writeLog } from "../app/logger";
import { getMainWindow } from "../app/window";
import { repos } from "../db/repos";
import { keystore } from "../security/safe-storage";
import { createAssetLibrary } from "./library";
import { installStarter, starterInstalled } from "./starter";
import { STARTER_BYTES, STARTER_FILES, STARTER_ROLES, STARTER_VERSION } from "./starter-manifest";

/** The app's asset library, starter pack job, Freesound key and per-draft sound setup. */
export const assetLibrary = createAssetLibrary({ repos, root: () => appFolders().assets });

export const licensesDir = () => join(appFolders().assets, "licenses");

export function notifyAssetsChanged(): void {
	getMainWindow()?.webContents.send(assetEvents.changed, { at: Date.now() });
}

/* ---------- Starter pack ---------- */

const STARTER_KEY = "assets.starter";
type StarterRecord = { version: number; state: "installed" | "failed" | "cancelled"; at: string; error?: string };

let starterJob: { abort: AbortController; last: StarterStatus } | null = null;

export function starterStatus(): StarterStatus {
	if (starterJob) return starterJob.last;
	const rec = repos.settings.get<StarterRecord>(STARTER_KEY);
	const done = starterInstalled(assetLibrary);
	const base = { done, total: STARTER_FILES, bytesDone: 0, bytesTotal: STARTER_BYTES };
	if (done >= STARTER_FILES) return { ...base, state: "installed", bytesDone: STARTER_BYTES };
	if (rec?.state === "failed") return { ...base, state: "failed", error: rec.error };
	if (rec?.state === "cancelled") return { ...base, state: "cancelled" };
	// Files deleted by the user after an install: the pack shows as partly installed.
	return { ...base, state: done > 0 || rec?.state === "installed" ? "partial" : "none" };
}

function emitStarter(s: StarterStatus) {
	if (starterJob) starterJob.last = s;
	getMainWindow()?.webContents.send(assetEvents.starter, s);
}

/** Starts (or resumes) the starter pack install in the background. */
export function startStarter(): void {
	if (starterJob) return;
	const abort = new AbortController();
	starterJob = { abort, last: { ...starterStatus(), state: "installing" } };
	const t0 = Date.now();
	writeLog("assets", "info", "starter pack install started");
	void installStarter({ lib: assetLibrary, tmp: join(appFolders().cache, "starter"), licenses: licensesDir(), signal: abort.signal, onProgress: emitStarter })
		.then((s) => {
			repos.settings.set(STARTER_KEY, { version: STARTER_VERSION, state: "installed", at: new Date().toISOString() } satisfies StarterRecord);
			writeLog("assets", "info", `starter pack installed: ${s.done}/${s.total} files in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
			starterJob = null;
			emitStarter(s);
		})
		.catch((err: Error) => {
			const cancelled = abort.signal.aborted;
			const error = cancelled ? undefined : err.message;
			repos.settings.set(STARTER_KEY, { version: STARTER_VERSION, state: cancelled ? "cancelled" : "failed", at: new Date().toISOString(), error } satisfies StarterRecord);
			writeLog("assets", cancelled ? "info" : "error", cancelled ? "starter pack install stopped" : "starter pack install failed", cancelled ? undefined : err);
			starterJob = null;
			emitStarter(starterStatus());
		})
		.finally(notifyAssetsChanged);
}

export function cancelStarter(): void {
	starterJob?.abort.abort();
}

/** First run: install the starter pack once, in the background. Never retried automatically. */
export function maybeAutoInstallStarter(): void {
	if (process.env.EXPLAINER_NO_STARTER) return;
	if (repos.settings.get(STARTER_KEY) !== undefined) return;
	setTimeout(() => startStarter(), 4000);
}

/* ---------- Freesound key ---------- */

const FS_KEY = "freesound.key";

export async function freesoundKey(): Promise<string> {
	const sealed = repos.settings.get<string>(FS_KEY);
	return sealed ? keystore.open(Buffer.from(sealed, "base64")) : "";
}

export async function setFreesoundKey(key: string | null): Promise<void> {
	if (!key) repos.settings.remove(FS_KEY);
	else repos.settings.set(FS_KEY, Buffer.from(await keystore.seal(key)).toString("base64"));
}

export const hasFreesoundKey = () => !!repos.settings.get<string>(FS_KEY);

/* ---------- Draft sound ---------- */

export function roleDefaults(): DraftSound["roleDefaults"] {
	const out: DraftSound["roleDefaults"] = {};
	for (const [role, sha] of Object.entries(STARTER_ROLES)) {
		const a = sha ? assetLibrary.bySha(sha) : null;
		if (a) out[role as keyof typeof out] = a.id;
	}
	return out;
}

export function draftSound(draftId: string): DraftSound {
	const d = repos.drafts.get(draftId);
	if (!d) throw new Error("This draft was not found. It may have been deleted.");
	const parsed = SoundSetup.safeParse(d.audio ?? {});
	const all = assetLibrary.list().filter((a) => a.kind === "music" || a.kind === "sfx");
	return {
		setup: parsed.success ? parsed.data : SoundSetup.parse({}),
		library: assetLibrary.items(),
		titles: Object.fromEntries(all.map((a) => [a.id, a.title])),
		roleDefaults: roleDefaults(),
		seed: d.id,
	};
}

export function saveDraftSound(draftId: string, setup: SoundSetup): DraftSound {
	if (!repos.drafts.get(draftId)) throw new Error("This draft was not found. It may have been deleted.");
	repos.drafts.update(draftId, { audio: setup });
	return draftSound(draftId);
}
