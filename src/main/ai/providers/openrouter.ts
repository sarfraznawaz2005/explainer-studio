import { OpenAICompatibleAdapter } from "./openai-compatible";
import { dedupeModels, fetchModelIds } from "./models";
import type { ProviderConfig } from "./types";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

export class OpenRouterAdapter extends OpenAICompatibleAdapter {
	constructor(config: ProviderConfig) {
		super(config, {
			name: "openrouter",
			baseURL: OPENROUTER_BASE_URL,
			headers: { "HTTP-Referer": "https://explainer-studio.local", "X-Title": "Explainer Studio" },
		});
	}

	/** The free router first: it picks a free model for each request and needs only a free key. */
	protected override async fetchModels(): Promise<string[]> {
		return dedupeModels(["openrouter/free", ...(await fetchModelIds(`${OPENROUTER_BASE_URL}/models`, {}))]);
	}
}
