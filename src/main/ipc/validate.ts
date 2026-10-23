import { ZodError } from "zod";
import type { Channel, Parsed } from "@shared/ipc/channels";

export class IpcInputError extends Error {
	constructor(detail: string) {
		super(`Invalid input: ${detail}`);
		this.name = "IpcInputError";
	}
}

/** Parses a raw IPC payload with the channel's schema. Throws IpcInputError with a short reason. */
export function parseInput<C extends Channel>(c: C, raw: unknown): Parsed<C> {
	try {
		return c.input.parse(raw) as Parsed<C>;
	} catch (err) {
		const detail = err instanceof ZodError ? err.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ") : String(err);
		throw new IpcInputError(detail);
	}
}
