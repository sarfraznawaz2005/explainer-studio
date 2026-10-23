import type { ProviderKind } from "@shared/ipc/ai";

/**
 * Defaults used when a provider row has no default model. These are
 * fallbacks only: the UI lists live models from each provider.
 */
export const PROVIDER_DEFAULT_MODELS: Record<ProviderKind, string> = {
	anthropic: "claude-sonnet-5-5",
	"claude-subscription": "claude-sonnet-5-5",
	opencode: "big-pickle",
	openai: "gpt-4o",
	custom: "",
	google: "gemini-2.5-flash",
	groq: "llama-3.3-70b-versatile",
	deepseek: "deepseek-chat",
	xai: "grok-3-mini",
	openrouter: "openrouter/free",
	ollama: "llama3.2",
	zai: "glm-4.5",
};

/** Static lists used only when the live list cannot be fetched. */
export const STATIC_MODELS: Partial<Record<ProviderKind, string[]>> = {
	anthropic: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-sonnet-4-6", "claude-haiku-4-5"],
	"claude-subscription": ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-sonnet-4-6", "claude-haiku-4-5-20251001"],
	openai: ["gpt-4o", "gpt-4o-mini"],
	google: ["gemini-2.5-pro", "gemini-2.5-flash"],
	groq: ["llama-3.3-70b-versatile"],
	deepseek: ["deepseek-chat", "deepseek-reasoner"],
	xai: ["grok-3", "grok-3-mini"],
	openrouter: ["openrouter/free"],
	ollama: ["llama3.2", "llama3.1", "mistral", "gemma2"],
	zai: ["glm-4.5", "glm-4.5-air"],
};

export function getDefaultModel(type: ProviderKind): string {
	return PROVIDER_DEFAULT_MODELS[type] ?? "";
}

export function dedupeModels(models: string[]): string[] {
	return [...new Set(models.filter(Boolean))];
}

/** GET a /models style endpoint and return ids. Throws on non-2xx. */
export async function fetchModelIds(url: string, headers: Record<string, string>, timeoutMs = 10_000): Promise<string[]> {
	const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
	if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`);
	const json = (await res.json()) as { data?: Array<{ id: string }>; models?: Array<{ name?: string; id?: string }> };
	const ids = json.data?.map((m) => m.id) ?? json.models?.map((m) => m.id ?? m.name ?? "") ?? [];
	return dedupeModels(ids).sort();
}
