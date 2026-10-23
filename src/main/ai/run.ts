import { generateText, type LanguageModel, type LanguageModelUsage } from "ai";
import type { CallUsage, ProviderAdapter, TextRunOpts, TextRunResult } from "./providers/types";

export const NO_USAGE: CallUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

export function fromAiUsage(u: LanguageModelUsage | undefined): CallUsage {
	if (!u) return NO_USAGE;
	return {
		inputTokens: u.inputTokens ?? 0,
		outputTokens: u.outputTokens ?? 0,
		cacheReadTokens: u.inputTokenDetails?.cacheReadTokens ?? 0,
		cacheWriteTokens: u.inputTokenDetails?.cacheWriteTokens ?? 0,
	};
}

/** One text turn on an AI SDK model. No tools. */
export async function runModelText(model: LanguageModel, opts: Omit<TextRunOpts, "modelId">): Promise<TextRunResult> {
	const r = await generateText({
		model,
		instructions: opts.system,
		messages: opts.messages.map((m) =>
			m.role === "user" && m.images?.length
				? { role: "user" as const, content: [...m.images.map((i) => ({ type: "image" as const, image: i.data, mediaType: i.mediaType })), { type: "text" as const, text: m.content }] }
				: { role: m.role, content: m.content },
		),
		maxOutputTokens: opts.maxOutputTokens,
		abortSignal: opts.abortSignal,
		maxRetries: 2,
	});
	return { text: r.text, usage: fromAiUsage(r.usage) };
}

/** One text turn on any provider: the Agent SDK path for Claude Code, the AI SDK for the rest. */
export function runText(adapter: ProviderAdapter, opts: TextRunOpts): Promise<TextRunResult> {
	if (adapter.runText) return adapter.runText(opts);
	return runModelText(adapter.createModel(opts.modelId), opts);
}
