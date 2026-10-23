import { app } from "electron";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Small JSON store for UI preferences that must be known before the window
 * opens (theme, window bounds). Everything else will live in SQLite (TASK-002).
 * Writes go to a temp file first, then rename, so a crash never leaves half a file.
 */
type Prefs = Record<string, unknown>;

let cache: Prefs | null = null;

function file(): string {
	return join(app.getPath("userData"), "prefs.json");
}

function load(): Prefs {
	if (cache) return cache;
	try {
		cache = existsSync(file()) ? (JSON.parse(readFileSync(file(), "utf8")) as Prefs) : {};
	} catch {
		// A broken file is replaced with defaults rather than crashing the app.
		cache = {};
	}
	return cache;
}

export function getPref<T>(key: string): T | undefined {
	return load()[key] as T | undefined;
}

export function setPref(key: string, value: unknown): void {
	const p = load();
	p[key] = value;
	const target = file();
	mkdirSync(dirname(target), { recursive: true });
	const tmp = `${target}.tmp`;
	writeFileSync(tmp, JSON.stringify(p, null, 2), "utf8");
	renameSync(tmp, target);
}
