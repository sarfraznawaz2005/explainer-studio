import { z } from "zod";
import type { CallUsage, ChatMessage, ImageInput, TextRunResult } from "./providers/types";

/**
 * Structured output for every provider.
 *
 * The model is asked for JSON in plain text, with the JSON Schema in the prompt,
 * and the reply is checked with zod. Native "JSON mode" is not used: many free
 * and OpenAI-compatible models ignore or reject it, while all of them can follow
 * a schema in text. A reply that does not parse or does not match gets a repair
 * turn that lists the problems, up to `maxRepairs` times (default 2).
 */

export const DEFAULT_MAX_REPAIRS = 2;

/** Runs one model turn. The caller records usage and errors per call. */
export type TurnRunner = (req: { system: string; messages: ChatMessage[]; attempt: number }) => Promise<TextRunResult>;

export type StructuredRequest<S extends z.ZodType> = {
	schema: S;
	/** What the model is and the rules it follows. The JSON instructions are added after it. */
	system: string;
	prompt: string;
	/** Images sent with the first message (vision slot). */
	images?: ImageInput[];
	/** Repair rounds after the first try. 0 disables repair. */
	maxRepairs?: number;
};

export type StructuredResult<T> = { value: T; attempts: number; usage: CallUsage; costUsd: number | undefined };

export class StructuredOutputError extends Error {
	constructor(
		message: string,
		readonly attempts: number,
		readonly problems: string[],
		readonly lastText: string,
	) {
		super(message);
		this.name = "StructuredOutputError";
	}
}

/** First JSON object or array in a text (tolerates code fences and stray prose). */
export function extractJson(text: string): unknown {
	const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
	const src = (fenced ? fenced[1]! : text).trim();
	const start = src.search(/[[{]/);
	if (start < 0) throw new Error("The reply contained no JSON.");
	const open = src[start]!;
	const close = open === "{" ? "}" : "]";
	let depth = 0;
	let inStr = false;
	for (let i = start; i < src.length; i++) {
		const c = src[i]!;
		if (inStr) {
			if (c === "\\") i++;
			else if (c === '"') inStr = false;
			continue;
		}
		if (c === '"') inStr = true;
		else if (c === open) depth++;
		else if (c === close && --depth === 0) return JSON.parse(src.slice(start, i + 1));
	}
	throw new Error("The JSON in the reply was cut off or unbalanced.");
}

/** The JSON instructions appended to the system prompt. */
export function jsonInstructions(schema: z.ZodType): string {
	const json = JSON.stringify(z.toJSONSchema(schema, { unrepresentable: "any" }));
	return [
		"Reply with ONE JSON value and nothing else: no prose, no markdown, no code fences.",
		"The JSON must match this JSON Schema exactly (field names, types, required fields, allowed values):",
		json,
	].join("\n");
}

/** zod issues as short lines a model can act on: "scenes.2.type: Invalid option ...". */
export function describeIssues(error: z.ZodError, max = 12): string[] {
	const lines = error.issues.slice(0, max).map((i) => `${i.path.length ? i.path.join(".") : "(root)"}: ${i.message}`);
	if (error.issues.length > max) lines.push(`... and ${error.issues.length - max} more problems`);
	return lines;
}

function addUsage(a: CallUsage, b: CallUsage): CallUsage {
	return {
		inputTokens: a.inputTokens + b.inputTokens,
		outputTokens: a.outputTokens + b.outputTokens,
		cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
		cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
	};
}

type Check<T> = { ok: true; value: T } | { ok: false; problems: string[] };

function check<S extends z.ZodType>(schema: S, text: string): Check<z.output<S>> {
	let raw: unknown;
	try {
		raw = extractJson(text);
	} catch (err) {
		return { ok: false, problems: [(err as Error).message] };
	}
	const r = schema.safeParse(raw);
	return r.success ? { ok: true, value: r.data } : { ok: false, problems: describeIssues(r.error) };
}

/**
 * Asks for a value that matches `schema`. Returns it, or throws StructuredOutputError
 * after the last repair round. Errors from the model call itself (network, auth,
 * cancel) are not repaired: they are rethrown at once.
 */
export async function generateStructured<S extends z.ZodType>(run: TurnRunner, req: StructuredRequest<S>): Promise<StructuredResult<z.output<S>>> {
	const maxRepairs = Math.max(0, req.maxRepairs ?? DEFAULT_MAX_REPAIRS);
	const system = `${req.system.trim()}\n\n${jsonInstructions(req.schema)}`;
	const messages: ChatMessage[] = [{ role: "user", content: req.prompt, images: req.images }];
	let usage: CallUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
	let costUsd: number | undefined;
	let problems: string[] = [];
	let lastText = "";

	for (let attempt = 1; attempt <= maxRepairs + 1; attempt++) {
		const r = await run({ system, messages: [...messages], attempt });
		usage = addUsage(usage, r.usage);
		if (r.costUsd !== undefined) costUsd = (costUsd ?? 0) + r.costUsd;
		lastText = r.text;
		const c = check(req.schema, r.text);
		if (c.ok) return { value: c.value, attempts: attempt, usage, costUsd };
		problems = c.problems;
		messages.push(
			{ role: "assistant", content: r.text },
			{
				role: "user",
				content: `Your reply did not match the required JSON Schema. Problems:\n${problems.map((p) => `- ${p}`).join("\n")}\n\nReply again with the complete, corrected JSON only.`,
			},
		);
	}
	throw new StructuredOutputError(
		`The AI reply did not match the expected format after ${maxRepairs + 1} tries. First problem: ${problems[0] ?? "unknown"}`,
		maxRepairs + 1,
		problems,
		lastText,
	);
}
