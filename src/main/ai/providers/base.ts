import type { LanguageModel } from "ai";
import { logProviderError } from "./errors";
import { getDefaultModel, STATIC_MODELS } from "./models";
import { probeModel } from "./test-connection";
import type { ProviderAdapter, ProviderConfig, TestConnectionResult } from "./types";

/**
 * Shared behaviour for API-key providers: build a model from a factory,
 * list models from a live endpoint with a static fallback, and test with a
 * real 5-token generation.
 */
export abstract class BaseAdapter implements ProviderAdapter {
	constructor(readonly config: ProviderConfig) {}

	abstract createModel(modelId: string): LanguageModel;

	/** Live model ids. Throw to fall back to the static list. */
	protected abstract fetchModels(): Promise<string[]>;

	async listModels(): Promise<string[]> {
		try {
			const models = await this.fetchModels();
			if (models.length) return models;
		} catch (err) {
			logProviderError(err, { kind: this.config.kind, providerName: this.config.name, phase: "listModels" });
		}
		return STATIC_MODELS[this.config.kind] ?? [];
	}

	protected modelOrDefault(modelId?: string): string {
		return modelId || this.config.defaultModel || getDefaultModel(this.config.kind);
	}

	async testConnection(modelId?: string): Promise<TestConnectionResult> {
		const id = this.modelOrDefault(modelId);
		if (!id) return { success: false, error: "Pick a default model first." };
		return probeModel(this.createModel(id));
	}
}
