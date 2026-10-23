import { app } from "electron";
import { copyFileSync, existsSync, renameSync } from "node:fs";
import { join } from "node:path";
import { createBackup, dailyBackupIfDue, newestGoodBackup } from "../db/backup";
import { DbCorruptError, openDatabase } from "../db/connection";
import { runMigrations } from "../db/migrate";
import { MIGRATIONS } from "../db/migrations";
import { repos } from "../db/repos";
import { createPathGuard, type PathGuard } from "../security/path-guard";
import { ensureFolders, folderLayout, setAppFolders, type Folders } from "./folders";
import { configureLogger, writeLog } from "./logger";

export type BootResult = { folders: Folders; recovered: string | null };

let guard: PathGuard | null = null;

/** Guard for every path that arrives over IPC. Roots are the app's own folders. */
export function pathGuard(): PathGuard {
	if (!guard) throw new Error("Path guard is not ready yet");
	return guard;
}

/** Moves a damaged database aside (never deletes it) and restores the newest good backup, if any. */
function recover(file: string, backups: string): string {
	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	for (const ext of ["", "-wal", "-shm"]) {
		if (existsSync(file + ext)) renameSync(file + ext, `${file}.corrupt-${stamp}${ext}`);
	}
	const good = newestGoodBackup(backups);
	if (good) {
		copyFileSync(good.path, file);
		return `The database was damaged. It was restored from the backup made ${good.createdAt}. The damaged copy was kept next to it.`;
	}
	return "The database was damaged and no backup was found. A new, empty database was created. The damaged copy was kept.";
}

/** Folders, logger, database, migrations and backups. Runs before the window opens. */
export async function bootData(): Promise<BootResult> {
	const folders = ensureFolders(folderLayout(app.getPath("userData")));
	setAppFolders(folders);
	configureLogger(folders.logs);
	guard = createPathGuard([folders.drafts, folders.videos, folders.assets, folders.cache]);

	const file = join(folders.data, "studio.db");
	let recovered: string | null = null;
	let d;
	try {
		d = openDatabase(file);
	} catch (err) {
		if (!(err instanceof DbCorruptError)) throw err;
		writeLog("app", "error", "database failed its integrity check", err);
		recovered = recover(file, folders.backups);
		d = openDatabase(file);
	}

	const m = await runMigrations(d, MIGRATIONS, () => createBackup(d, folders.backups, "pre-migration"));
	if (m.applied.length) writeLog("app", "info", `schema v${m.from} -> v${m.to}: ${m.applied.join(", ")}`);

	// A backup on every app version change, then at most one a day.
	const last = repos.settings.get<string>("app.lastVersion");
	if (last && last !== app.getVersion()) await createBackup(d, folders.backups, "upgrade");
	if (last !== app.getVersion()) repos.settings.set("app.lastVersion", app.getVersion());
	await dailyBackupIfDue(d, folders.backups);

	writeLog("app", "info", `started v${app.getVersion()} (${app.isPackaged ? "release" : "dev"})`);
	return { folders, recovered };
}
