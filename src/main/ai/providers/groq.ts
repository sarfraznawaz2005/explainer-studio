import { createGroq } from "@ai-sdk/groq";
import type { LanguageModel } from "ai";
import { BaseAdapter } from "./base";
import { PROVIDER_HEADERS } from "./headers";
import { fetchModelIds } from "./models";
import type { ProviderConfig } from "./types";

export class GroqAdapter extends BaseAdapter {
	private provider: ReturnType<typeof createGroq>;

	constructor(config: ProviderConfig) {
		super(config);
		this.provider = createGroq({ apiKey: config.apiKey, headers: PROVIDER_HEADERS });
	}

	createModel(modelId: string): LanguageModel {
		return this.provider(modelId);
	}

	protected fetchModels(): Promise<string[]> {
		return fetchModelIds("https://api.groq.com/openai/v1/models", { Authorization: `Bearer ${this.config.apiKey}` });
	}
}
