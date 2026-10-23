import { ipcMain } from "electron";
import type { Channel, Out, Parsed } from "@shared/ipc/channels";
import { writeLog } from "../app/logger";
import { redact } from "../security/redact";
import { IpcInputError, parseInput } from "./validate";

const registered = new Set<string>();

/**
 * Registers an IPC handler. Input is validated with the channel's Zod schema
 * before the handler runs. Errors are rethrown with a short, redacted message
 * (Electron forwards only `.message` to the renderer).
 */
export function handle<C extends Channel>(c: C, fn: (input: Parsed<C>) => Promise<Out<C>> | Out<C>): void {
	if (registered.has(c.name)) throw new Error(`IPC channel registered twice: ${c.name}`);
	registered.add(c.name);
	ipcMain.handle(c.name, async (_e, raw) => {
		let input: Parsed<C>;
		try {
			input = parseInput(c, raw);
		} catch (err) {
			writeLog("ipc", "warn", `${c.name} rejected: ${(err as Error).message}`);
			throw err instanceof IpcInputError ? err : new Error("Invalid input");
		}
		try {
			return await fn(input);
		} catch (err) {
			writeLog("ipc", "error", `${c.name} failed`, err);
			throw new Error(redact((err as Error)?.message ?? String(err)));
		}
	});
}
