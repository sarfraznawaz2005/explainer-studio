import type { z } from "zod";
import type { Channel, In, Out } from "@shared/ipc/channels";

/** Typed IPC call. Output is validated against the channel schema. */
export async function call<C extends Channel>(c: C, ...args: undefined extends In<C> ? [input?: In<C>] : [input: In<C>]): Promise<Out<C>> {
	const raw = await window.studio.invoke(c.name, args[0]);
	return c.output.parse(raw) as Out<C>;
}

/** Subscribe to a push event. Returns the unsubscribe function. */
export function on<S extends z.ZodType>(event: string, schema: S, cb: (payload: z.output<S>) => void): () => void {
	return window.studio.on(event, (p) => {
		const r = schema.safeParse(p);
		if (r.success) cb(r.data);
		else console.warn(`[ipc] bad payload for ${event}`, r.error);
	});
}

/** Error text without Electron's "Error invoking remote method ..." prefix. */
export function errorText(err: unknown): string {
	const msg = (err as Error)?.message ?? String(err);
	return msg.replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
}
