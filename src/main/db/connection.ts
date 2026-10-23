import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * SQLite through Node's built-in `node:sqlite` (Node 24 in Electron 42).
 * No native module, so nothing to rebuild for Electron, and tests run in plain Node.
 * This file has no Electron imports so it can be unit tested.
 */
export type Db = DatabaseSync;

export class DbCorruptError extends Error {
	constructor(detail: string) {
		super(`Database integrity check failed: ${detail}`);
		this.name = "DbCorruptError";
	}
}

let current: { db: Db; file: string } | null = null;

export function db(): Db {
	if (!current) throw new Error("Database is not open");
	return current.db;
}

export function dbFile(): string {
	if (!current) throw new Error("Database is not open");
	return current.file;
}

export function isOpen(): boolean {
	return current !== null && current.db.isOpen;
}

function applyPragmas(d: Db): void {
	d.exec("PRAGMA journal_mode = WAL");
	d.exec("PRAGMA synchronous = NORMAL");
	d.exec("PRAGMA foreign_keys = ON");
	d.exec("PRAGMA temp_store = MEMORY");
	d.exec("PRAGMA busy_timeout = 5000");
}

/** Opens a database file without making it the app database. Used by open and by tests. */
export function openFile(file: string): Db {
	if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
	let d: Db;
	try {
		d = new DatabaseSync(file);
	} catch (err) {
		throw new DbCorruptError((err as Error).message);
	}
	try {
		applyPragmas(d);
		const row = d.prepare("PRAGMA quick_check").get() as { quick_check: string } | undefined;
		if (row?.quick_check !== "ok") throw new DbCorruptError(String(row?.quick_check));
	} catch (err) {
		d.close();
		throw err instanceof DbCorruptError ? err : new DbCorruptError((err as Error).message);
	}
	return d;
}

/** Opens `file` as the app database. Throws DbCorruptError when the file is damaged. */
export function openDatabase(file: string): Db {
	if (current?.db.isOpen) return current.db;
	current = { db: openFile(file), file };
	return current.db;
}

export function closeDatabase(): void {
	if (!current) return;
	if (current.db.isOpen) {
		try {
			current.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
		} catch {
			/* best effort */
		}
		current.db.close();
	}
	current = null;
}

/** Runs fn in one IMMEDIATE transaction. Rolls back on any error. Not re-entrant. */
export function inTransaction<T>(fn: () => T, d: Db = db()): T {
	d.exec("BEGIN IMMEDIATE");
	try {
		const out = fn();
		d.exec("COMMIT");
		return out;
	} catch (err) {
		if (d.isTransaction) d.exec("ROLLBACK");
		throw err;
	}
}
