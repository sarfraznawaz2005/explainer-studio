import { createXai } from "@ai-sdk/xai";
import type { LanguageModel } from "ai";
import { BaseAdapter } from "./base";
import { PROVIDER_HEADERS } from "./headers";
import { fetchModelIds } from "./models";
import type { ProviderConfig } from "./types";

export class XaiAdapter extends BaseAdapter {
	private provider: ReturnType<typeof createXai>;

	constructor(config: ProviderConfig) {
		super(config);
		this.provider = createXai({ apiKey: config.apiKey, headers: PROVIDER_HEADERS });
	}

	createModel(modelId: string): LanguageModel {
		return this.provider(modelId);
	}

	protected async fetchModels(): Promise<string[]> {
		const ids = await fetchModelIds("https://api.x.ai/v1/models", { Authorization: `Bearer ${this.config.apiKey}` });
		return ids.filter((id) => !/image|imagine|video/.test(id));
	}
}
