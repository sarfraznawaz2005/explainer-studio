import { createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";
import { BaseAdapter } from "./base";
import { PROVIDER_HEADERS } from "./headers";
import { fetchModelIds } from "./models";
import type { ProviderConfig } from "./types";

export class AnthropicAdapter extends BaseAdapter {
	private provider: ReturnType<typeof createAnthropic>;

	constructor(config: ProviderConfig) {
		super(config);
		this.provider = createAnthropic({ apiKey: config.apiKey, headers: PROVIDER_HEADERS });
	}

	createModel(modelId: string): LanguageModel {
		return this.provider(modelId);
	}

	protected fetchModels(): Promise<string[]> {
		return fetchModelIds("https://api.anthropic.com/v1/models?limit=100", {
			"x-api-key": this.config.apiKey,
			"anthropic-version": "2023-06-01",
		});
	}
}
