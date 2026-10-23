import { OpenAICompatibleAdapter, normalizeBaseUrl } from "./openai-compatible";
import { dedupeModels } from "./models";
import { httpFailure, testConnectionFailure } from "./test-connection";
import type { ProviderConfig, TestConnectionResult } from "./types";

export const OLLAMA_DEFAULT_BASE_URL = "http://localhost:11434/v1";

/** Native (non-OpenAI) root, e.g. http://host:11434 */
export function ollamaNativeBase(baseUrl: string | null): string {
	return normalizeBaseUrl(baseUrl || OLLAMA_DEFAULT_BASE_URL).replace(/\/v1$/, "");
}

export class OllamaAdapter extends OpenAICompatibleAdapter {
	constructor(config: ProviderConfig) {
		super(config, { name: "ollama", baseURL: config.baseUrl || OLLAMA_DEFAULT_BASE_URL, apiKey: "ollama" });
	}

	protected override async fetchModels(): Promise<string[]> {
		const res = await fetch(`${ollamaNativeBase(this.config.baseUrl)}/api/tags`, { signal: AbortSignal.timeout(5_000) });
		if (!res.ok) throw new Error(`GET /api/tags -> HTTP ${res.status}`);
		const json = (await res.json()) as { models?: Array<{ name: string }> };
		return dedupeModels((json.models ?? []).map((m) => m.name));
	}

	/** Ollama is local: reachable /api/tags is the test. */
	override async testConnection(): Promise<TestConnectionResult> {
		try {
			const res = await fetch(`${ollamaNativeBase(this.config.baseUrl)}/api/tags`, { signal: AbortSignal.timeout(5_000) });
			if (!res.ok) return httpFailure(res.status, `Ollama answered HTTP ${res.status}`);
			return { success: true };
		} catch (err) {
			const r = testConnectionFailure(err);
			return { ...r, error: `Ollama is not reachable at ${ollamaNativeBase(this.config.baseUrl)}. Is it running?` };
		}
	}
}
