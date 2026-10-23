import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { basename, join } from "node:path";
import { backup as sqliteBackup, DatabaseSync } from "node:sqlite";
import type { Db } from "./connection";

export type BackupReason = "pre-migration" | "upgrade" | "daily" | "manual" | "pre-restore";
export type BackupInfo = { file: string; path: string; bytes: number; createdAt: string; reason: string };

export const KEEP_BACKUPS = 7;
const FILE_RE = /^studio-(\d{4}-\d{2}-\d{2}T[\d-]+Z)-([a-z-]+?)(?:-\d+)?\.db$/;
const DAILY_GAP_MS = 20 * 60 * 60 * 1000;

function removeSideFiles(file: string): void {
	for (const ext of ["-wal", "-shm"]) {
		try {
			if (existsSync(file + ext)) unlinkSync(file + ext);
		} catch {
			/* best effort */
		}
	}
}

/** quick_check on a backup file. Never throws. */
export function verifyBackup(file: string): boolean {
	let d: DatabaseSync | null = null;
	try {
		d = new DatabaseSync(file, { readOnly: true });
		return (d.prepare("PRAGMA quick_check").get() as { quick_check: string }).quick_check === "ok";
	} catch {
		return false;
	} finally {
		d?.close();
		removeSideFiles(file);
	}
}

/** Backups in `dir`, newest first. */
export function listBackups(dir: string): BackupInfo[] {
	if (!existsSync(dir)) return [];
	return readdirSync(dir)
		.map((f) => ({ f, m: FILE_RE.exec(f) }))
		.filter((x): x is { f: string; m: RegExpExecArray } => x.m !== null)
		.sort((a, b) => b.f.localeCompare(a.f))
		.map(({ f, m }) => {
			const path = join(dir, f);
			return { file: f, path, bytes: statSync(path).size, createdAt: m[1]!, reason: m[2]! };
		});
}

export function rotateBackups(dir: string, keep = KEEP_BACKUPS): string[] {
	const removed = listBackups(dir).slice(keep);
	for (const b of removed) {
		try {
			unlinkSync(b.path);
		} catch {
			/* a locked file is retried next time */
		}
	}
	return removed.map((b) => b.file);
}

/**
 * Consistent snapshot of a live database using SQLite's online backup API.
 * The copy is verified; a copy that fails the check is deleted and the call throws.
 */
export async function createBackup(d: Db, dir: string, reason: BackupReason): Promise<BackupInfo> {
	mkdirSync(dir, { recursive: true });
	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	let path = join(dir, `studio-${stamp}-${reason}.db`);
	for (let n = 1; existsSync(path); n++) path = join(dir, `studio-${stamp}-${reason}-${n}.db`);
	await sqliteBackup(d, path);
	// A single self-contained file: no -wal / -shm next to it.
	const copy = new DatabaseSync(path);
	copy.exec("PRAGMA journal_mode = DELETE");
	copy.close();
	removeSideFiles(path);
	if (!verifyBackup(path)) {
		unlinkSync(path);
		throw new Error("Backup failed its integrity check");
	}
	rotateBackups(dir);
	const file = basename(path);
	return { file, path, bytes: statSync(path).size, createdAt: stamp, reason };
}

/** Takes a daily backup when the newest one is older than 20 hours. */
export async function dailyBackupIfDue(d: Db, dir: string): Promise<BackupInfo | null> {
	const newest = listBackups(dir)[0];
	if (newest && Date.now() - statSync(newest.path).mtimeMs < DAILY_GAP_MS) return null;
	return createBackup(d, dir, "daily");
}

/** Newest backup that passes quick_check, or null. Used to recover from a damaged database. */
export function newestGoodBackup(dir: string): BackupInfo | null {
	return listBackups(dir).find((b) => verifyBackup(b.path)) ?? null;
}
