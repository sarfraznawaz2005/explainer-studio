import { mkdirSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

/**
 * App folders under the user data root (%APPDATA%/Explainer Studio on Windows).
 * Pure Node so it can be unit tested; boot passes the real root.
 */
export const FOLDERS = ["data", "backups", "drafts", "videos", "assets", "cache", "python", "logs", "engine"] as const;
export type Folder = (typeof FOLDERS)[number];
export type Folders = Record<Folder, string> & { root: string };

export function folderLayout(root: string): Folders {
	const out = { root } as Folders;
	for (const f of FOLDERS) out[f] = f === "backups" ? join(root, "data", "backups") : join(root, f);
	return out;
}

export function ensureFolders(layout: Folders): Folders {
	for (const f of FOLDERS) mkdirSync(layout[f], { recursive: true });
	return layout;
}

let current: Folders | null = null;

export function setAppFolders(f: Folders): void {
	current = f;
}

/** The app folders. Set once at startup. */
export function appFolders(): Folders {
	if (!current) throw new Error("App folders are not ready yet");
	return current;
}

/** Total size of a folder tree. Symlinks are not followed. Missing folders count as empty. */
export async function folderSize(dir: string): Promise<{ bytes: number; files: number }> {
	let bytes = 0;
	let files = 0;
	const walk = async (d: string): Promise<void> => {
		let entries;
		try {
			entries = await readdir(d, { withFileTypes: true });
		} catch {
			return;
		}
		for (const e of entries) {
			const p = join(d, e.name);
			if (e.isDirectory()) await walk(p);
			else if (e.isFile()) {
				try {
					bytes += (await stat(p)).size;
					files++;
				} catch {
					/* removed while walking */
				}
			}
		}
	};
	await walk(dir);
	return { bytes, files };
}

/** Bytes used per area, for the Storage page. `backups` is inside `data`, so `data` excludes it. */
export async function storageUsage(layout: Folders): Promise<Record<Folder, { bytes: number; files: number }>> {
	const sizes = await Promise.all(FOLDERS.map(async (f) => [f, await folderSize(layout[f])] as const));
	const out = Object.fromEntries(sizes) as Record<Folder, { bytes: number; files: number }>;
	out.data = { bytes: out.data.bytes - out.backups.bytes, files: out.data.files - out.backups.files };
	return out;
}
