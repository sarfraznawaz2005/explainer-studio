import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModel } from "ai";
import { BaseAdapter } from "./base";
import { PROVIDER_HEADERS } from "./headers";
import { dedupeModels } from "./models";
import type { ProviderConfig } from "./types";

export class GoogleAdapter extends BaseAdapter {
	private provider: ReturnType<typeof createGoogleGenerativeAI>;

	constructor(config: ProviderConfig) {
		super(config);
		this.provider = createGoogleGenerativeAI({ apiKey: config.apiKey, headers: PROVIDER_HEADERS });
	}

	createModel(modelId: string): LanguageModel {
		return this.provider(modelId);
	}

	protected async fetchModels(): Promise<string[]> {
		const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", {
			headers: { "x-goog-api-key": this.config.apiKey },
			signal: AbortSignal.timeout(10_000),
		});
		if (!res.ok) throw new Error(`GET /v1beta/models -> HTTP ${res.status}`);
		const json = (await res.json()) as { models?: Array<{ name: string; supportedGenerationMethods?: string[] }> };
		const ids = (json.models ?? [])
			.filter((m) => !m.supportedGenerationMethods || m.supportedGenerationMethods.includes("generateContent"))
			.map((m) => m.name.replace(/^models\//, ""));
		return dedupeModels(ids).sort();
	}
}
