import { z } from "zod";

/**
 * One IPC channel: a name plus Zod schemas for its input and output.
 * Main validates input before the handler runs; the renderer validates output.
 */
export function defineChannel<I extends z.ZodType, O extends z.ZodType>(name: string, input: I, output: O) {
	return { name, input, output } as const;
}

export type Channel = { readonly name: string; readonly input: z.ZodType; readonly output: z.ZodType };
export type In<C extends Channel> = z.input<C["input"]>;
export type Out<C extends Channel> = z.output<C["output"]>;
/** Input as the handler sees it, after Zod parsing and defaults. */
export type Parsed<C extends Channel> = z.output<C["input"]>;

/** Empty input for channels that take no arguments. */
export const NoInput = z.undefined().or(z.null()).optional();
export const Ok = z.object({ ok: z.literal(true) });
