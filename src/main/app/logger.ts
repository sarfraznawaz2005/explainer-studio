import { appendFileSync, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { redact, redactError } from "../security/redact";

/**
 * Plain-text logs in <userData>/logs/<area>.log. Every line is redacted.
 * Files roll over at 2 MB, keeping one older file (<area>.1.log).
 */
export type LogLevel = "info" | "warn" | "error";
const MAX_BYTES = 2 * 1024 * 1024;

let dir: string | null = null;

export function configureLogger(logDir: string): void {
	dir = logDir;
	mkdirSync(dir, { recursive: true });
}

export function logFile(area: string): string | null {
	return dir ? join(dir, `${area.replace(/[^a-z0-9-]/gi, "_")}.log`) : null;
}

function roll(file: string): void {
	try {
		if (existsSync(file) && statSync(file).size > MAX_BYTES) {
			const old = file.replace(/\.log$/, ".1.log");
			if (existsSync(old)) unlinkSync(old);
			renameSync(file, old);
		}
	} catch {
		/* logging must never throw */
	}
}

export function writeLog(area: string, level: LogLevel, message: string, err?: unknown): void {
	const text = redact(message) + (err === undefined ? "" : ` | ${redactError(err)}`);
	const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${text}\n`;
	if (level === "error") console.error(`[${area}] ${text}`);
	else if (level === "warn") console.warn(`[${area}] ${text}`);
	else console.log(`[${area}] ${text}`);
	const file = logFile(area);
	if (!file) return;
	roll(file);
	try {
		appendFileSync(file, line, "utf8");
	} catch {
		/* disk full or locked: the console copy is enough */
	}
}
