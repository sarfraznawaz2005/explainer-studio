import { createDeepSeek } from "@ai-sdk/deepseek";
import type { LanguageModel } from "ai";
import { BaseAdapter } from "./base";
import { PROVIDER_HEADERS } from "./headers";
import { fetchModelIds } from "./models";
import type { ProviderConfig } from "./types";

export class DeepSeekAdapter extends BaseAdapter {
	private provider: ReturnType<typeof createDeepSeek>;

	constructor(config: ProviderConfig) {
		super(config);
		this.provider = createDeepSeek({ apiKey: config.apiKey, headers: PROVIDER_HEADERS });
	}

	createModel(modelId: string): LanguageModel {
		return this.provider(modelId);
	}

	protected fetchModels(): Promise<string[]> {
		return fetchModelIds("https://api.deepseek.com/models", { Authorization: `Bearer ${this.config.apiKey}` });
	}
}
