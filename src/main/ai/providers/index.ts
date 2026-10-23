import { AnthropicAdapter } from "./anthropic";
import { ClaudeSubscriptionAdapter } from "./claude-subscription";
import { DeepSeekAdapter } from "./deepseek";
import { withErrorLogging } from "./errors";
import { GoogleAdapter } from "./google";
import { GroqAdapter } from "./groq";
import { OllamaAdapter } from "./ollama";
import { OpenAIAdapter } from "./openai";
import { OpenAICompatibleAdapter } from "./openai-compatible";
import { OpenCodeAdapter } from "./opencode";
import { OpenRouterAdapter } from "./openrouter";
import { XaiAdapter } from "./xai";
import { ZaiAdapter } from "./zai";
import type { ProviderAdapter, ProviderConfig } from "./types";

export type { ProviderAdapter, ProviderConfig } from "./types";

function build(config: ProviderConfig): ProviderAdapter {
	switch (config.kind) {
		case "anthropic":
			return new AnthropicAdapter(config);
		case "claude-subscription":
			return new ClaudeSubscriptionAdapter(config);
		case "opencode":
			return new OpenCodeAdapter(config);
		case "openai":
			return new OpenAIAdapter(config);
		case "custom":
			return new OpenAICompatibleAdapter(config, { name: "custom" });
		case "google":
			return new GoogleAdapter(config);
		case "groq":
			return new GroqAdapter(config);
		case "deepseek":
			return new DeepSeekAdapter(config);
		case "xai":
			return new XaiAdapter(config);
		case "openrouter":
			return new OpenRouterAdapter(config);
		case "ollama":
			return new OllamaAdapter(config);
		case "zai":
			return new ZaiAdapter(config);
		default: {
			const never: never = config.kind;
			throw new Error(`Unknown provider type: ${String(never)}`);
		}
	}
}

/** Builds the adapter and routes every model call failure into provider-errors.log. */
export function createProviderAdapter(config: ProviderConfig): ProviderAdapter {
	const adapter = build(config);
	if (config.kind === "claude-subscription") return adapter;
	const original = adapter.createModel.bind(adapter);
	adapter.createModel = (modelId: string) => withErrorLogging(original(modelId), { kind: config.kind, providerName: config.name, modelId, phase: "model" });
	return adapter;
}
