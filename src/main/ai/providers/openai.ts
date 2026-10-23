import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import { BaseAdapter } from "./base";
import { PROVIDER_HEADERS } from "./headers";
import { fetchModelIds } from "./models";
import type { ProviderConfig } from "./types";

export class OpenAIAdapter extends BaseAdapter {
	private provider: ReturnType<typeof createOpenAI>;

	constructor(config: ProviderConfig) {
		super(config);
		this.provider = createOpenAI({ apiKey: config.apiKey, headers: PROVIDER_HEADERS });
	}

	createModel(modelId: string): LanguageModel {
		return this.provider(modelId);
	}

	protected async fetchModels(): Promise<string[]> {
		const ids = await fetchModelIds("https://api.openai.com/v1/models", { Authorization: `Bearer ${this.config.apiKey}` });
		// Keep chat-capable families only.
		return ids.filter((id) => /^(gpt|o\d|chatgpt)/.test(id) && !/(audio|realtime|transcribe|tts|image|search)/.test(id));
	}
}
