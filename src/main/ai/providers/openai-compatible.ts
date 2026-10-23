import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import { BaseAdapter } from "./base";
import { PROVIDER_HEADERS } from "./headers";
import { fetchModelIds } from "./models";
import { testConnectionFailure } from "./test-connection";
import type { ProviderConfig, TestConnectionResult } from "./types";

/** Users often paste ".../v1/models" or a trailing slash; normalise to the API root. */
export function normalizeBaseUrl(url: string | null): string {
	return (url ?? "").trim().replace(/\/+$/, "").replace(/\/models$/, "");
}

/**
 * Generic OpenAI-compatible adapter. Used directly for "custom" and as the
 * base for OpenRouter, Z.AI and Ollama, which only differ in URL and headers.
 */
export class OpenAICompatibleAdapter extends BaseAdapter {
	protected provider: ReturnType<typeof createOpenAICompatible>;
	protected baseURL: string;

	constructor(config: ProviderConfig, opts: { name?: string; baseURL?: string; headers?: Record<string, string>; apiKey?: string } = {}) {
		super(config);
		this.baseURL = normalizeBaseUrl(opts.baseURL ?? config.baseUrl);
		this.provider = createOpenAICompatible({
			name: opts.name ?? "custom",
			apiKey: opts.apiKey ?? config.apiKey,
			baseURL: this.baseURL,
			headers: { ...PROVIDER_HEADERS, ...opts.headers },
			includeUsage: true,
		});
	}

	createModel(modelId: string): LanguageModel {
		return this.provider(modelId);
	}

	protected async fetchModels(): Promise<string[]> {
		if (!this.baseURL) return [];
		try {
			return await fetchModelIds(`${this.baseURL}/models`, this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {});
		} catch (err) {
			if (String(err).includes("HTTP 404")) return [];
			throw err;
		}
	}

	override async testConnection(modelId?: string): Promise<TestConnectionResult> {
		if (!this.baseURL) return { success: false, error: "Base URL is required." };
		if (this.modelOrDefault(modelId)) return super.testConnection(modelId);
		// No model chosen yet: ask the server for its list, so an unreachable address says so.
		try {
			const ids = await this.fetchModels();
			if (ids[0]) return super.testConnection(ids[0]);
			return { success: false, error: "The server answered but listed no models. Type a model id." };
		} catch (err) {
			const f = testConnectionFailure(err);
			return { ...f, error: `Cannot reach ${this.baseURL}: ${f.error}` };
		}
	}
}
