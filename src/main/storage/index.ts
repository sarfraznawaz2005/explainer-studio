import { session } from "electron";
import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { CleanResult, Cleanup, StorageReport } from "@shared/ipc/storage";
import type { Job } from "@shared/models";
import { appFolders, folderSize, storageUsage, type Folders } from "../app/folders";
import { writeLog } from "../app/logger";
import { starterStatus } from "../assets";
import { repos } from "../db/repos";
import { ingestBusy } from "../ingest/jobs";
import { ownedDir } from "../security/path-guard";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Leftover folders: <drafts>/<uuid> or <videos>/<uuid> with no database row.
 * They come from crashes or from deletes that could not finish. Folders that a
 * render job still owns (running, queued, or failed and waiting for a retry) are kept.
 * Pure (apart from reading the folders), so it can be unit tested.
 */
export async function findLeftovers(opts: { drafts: string; videos: string; draftIds: Set<string>; videoIds: Set<string>; keepVideoIds: Set<string> }): Promise<string[]> {
	const out: string[] = [];
	const scan = async (root: string, known: Set<string>, keep: Set<string>) => {
		let entries;
		try {
			entries = await readdir(root, { withFileTypes: true });
		} catch {
			return;
		}
		for (const e of entries) {
			if (!e.isDirectory() || !UUID.test(e.name)) continue;
			const id = e.name.toLowerCase();
			if (known.has(id) || keep.has(id)) continue;
			out.push(ownedDir(root, id));
		}
	};
	await scan(opts.drafts, opts.draftIds, new Set());
	await scan(opts.videos, opts.videoIds, opts.keepVideoIds);
	return out;
}

/** Video folders that render jobs still need. */
function renderOwned(): Set<string> {
	const keep = new Set<string>();
	for (const j of repos.jobs.list({ where: { kind: "render" } }) as Job[]) {
		if (j.status === "done" || j.status === "cancelled") continue;
		const id = (j.payload as { videoId?: unknown } | null)?.videoId;
		if (typeof id === "string") keep.add(id.toLowerCase());
	}
	return keep;
}

async function leftovers(f: Folders) {
	return findLeftovers({
		drafts: f.drafts,
		videos: f.videos,
		draftIds: new Set(repos.drafts.list().map((d) => d.id.toLowerCase())),
		videoIds: new Set(repos.videos.list().map((v) => v.id.toLowerCase())),
		keepVideoIds: renderOwned(),
	});
}

/**
 * Chromium keeps the window's web cache in <userData>/Cache, which on Windows is the
 * same folder as the app cache. Those files are open while the app runs; they are
 * cleaned only through session.clearCache() (the "web" item), never deleted here.
 */
export const CHROMIUM_CACHE = new Set(["cache_data", "no_vary_search", "index", "index-dir", "js", "wasm"]);

/** Top-level cache entries in use right now (their job writes there). */
function cacheInUse(): Set<string> {
	const busy = new Set<string>();
	if (ingestBusy()) busy.add("ingest");
	if (starterStatus().state === "installing") busy.add("starter");
	return busy;
}

const blockedLeftovers = () => (ingestBusy() ? "New material is being read. Try again when it is done." : null);

/** Top-level cache entries with their size, minus the ones a job is using. */
async function cacheEntries(f: Folders) {
	const busy = cacheInUse();
	const out: { name: string; path: string; bytes: number; files: number; busy: boolean }[] = [];
	for (const e of await readdir(f.cache, { withFileTypes: true }).catch(() => [])) {
		if (!e.isDirectory() && !e.isFile()) continue;
		if (CHROMIUM_CACHE.has(e.name.toLowerCase())) continue;
		const path = join(f.cache, e.name);
		const size = e.isDirectory() ? await folderSize(path) : await stat(path).then((x) => ({ bytes: x.size, files: 1 }), () => ({ bytes: 0, files: 0 }));
		out.push({ name: e.name, path, ...size, busy: busy.has(e.name) });
	}
	return out;
}

export async function storageReport(): Promise<StorageReport> {
	const f = appFolders();
	const usage = await storageUsage(f);
	const cache = (await cacheEntries(f)).filter((e) => !e.busy);
	const left = ingestBusy() ? [] : await leftovers(f);
	const leftSizes = await Promise.all(left.map(folderSize));
	const web = await session.defaultSession.getCacheSize().catch(() => 0);
	return {
		root: f.root,
		areas: (["drafts", "videos", "assets", "cache", "python", "engine", "data", "backups", "logs"] as const).map((area) => ({ area, ...usage[area] })),
		cleanups: [
			{ id: "cache", bytes: cache.reduce((n, e) => n + e.bytes, 0), files: cache.reduce((n, e) => n + e.files, 0), blocked: null },
			{ id: "leftovers", bytes: leftSizes.reduce((n, s) => n + s.bytes, 0), files: leftSizes.reduce((n, s) => n + s.files, 0), blocked: blockedLeftovers() },
			{ id: "web", bytes: web, files: 0, blocked: null },
		],
	};
}

/** Deletes the chosen items and reports what it freed (measured, not estimated). */
export async function cleanStorage(items: Cleanup[]): Promise<CleanResult> {
	const f = appFolders();
	let freedBytes = 0;
	let removedFiles = 0;
	const skipped: string[] = [];
	const drop = async (dir: string) => {
		const s = await folderSize(dir);
		await rm(dir, { recursive: true, force: true });
		freedBytes += s.bytes;
		removedFiles += s.files;
	};
	if (items.includes("cache")) {
		for (const e of await cacheEntries(f)) {
			if (e.busy) {
				skipped.push(`cache/${e.name} (in use)`);
				continue;
			}
			await rm(e.path, { recursive: true, force: true });
			freedBytes += e.bytes;
			removedFiles += e.files;
		}
	}
	if (items.includes("leftovers")) {
		const why = blockedLeftovers();
		if (why) skipped.push(why);
		else for (const dir of await leftovers(f)) await drop(dir);
	}
	if (items.includes("web")) {
		const before = await session.defaultSession.getCacheSize().catch(() => 0);
		await session.defaultSession.clearCache();
		const after = await session.defaultSession.getCacheSize().catch(() => 0);
		freedBytes += Math.max(0, before - after);
	}
	writeLog("app", "info", `storage clean [${items.join(", ")}]: freed ${freedBytes} bytes in ${removedFiles} files${skipped.length ? `; skipped ${skipped.join("; ")}` : ""}`);
	return { freedBytes, removedFiles, skipped };
}
