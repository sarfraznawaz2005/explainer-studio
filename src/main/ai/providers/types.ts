import type { LanguageModel } from "ai";
import type { ProviderKind } from "@shared/ipc/ai";

export interface ProviderConfig {
	id: string;
	name: string;
	kind: ProviderKind;
	/** Opened key. Lives only in memory inside the adapter. */
	apiKey: string;
	baseUrl: string | null;
	defaultModel: string | null;
}

export interface TestConnectionResult {
	success: boolean;
	error?: string;
	transient?: boolean;
	retryAfterMs?: number;
}

/** Token counts for one call. inputTokens includes cached tokens. */
export interface CallUsage {
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
}

/** An image sent with a user message (vision models). */
export type ImageInput = { data: Uint8Array; mediaType: string };
export type ChatMessage = { role: "user" | "assistant"; content: string; images?: ImageInput[] };

export interface TextRunOpts {
	modelId: string;
	system: string;
	messages: ChatMessage[];
	maxOutputTokens?: number;
	abortSignal?: AbortSignal;
}

export interface TextRunResult {
	text: string;
	usage: CallUsage;
	/** Set when the provider reports the cost itself (Claude Code). */
	costUsd?: number;
}

export interface ProviderAdapter {
	readonly config: ProviderConfig;
	/** Vercel AI SDK model. Not available on the Agent SDK path. */
	createModel(modelId: string): LanguageModel;
	listModels(): Promise<string[]>;
	testConnection(modelId?: string): Promise<TestConnectionResult>;
	/** Present only on claude-subscription: one text turn through Claude Code. */
	runText?(opts: TextRunOpts): Promise<TextRunResult>;
}
