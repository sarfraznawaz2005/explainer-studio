import type { ModelSlot, ProviderKind } from "@shared/ipc/ai";
import { getDefaultModel } from "./models";

/**
 * Picks sensible models for each slot from a provider's live model list:
 * a strong model for planning (also used for vision), a cheap one for small tasks.
 */

/** Version numbers in a model id, e.g. claude-haiku-5-5 → [5,5]; dated snapshots keep the date last. */
function versionKey(id: string, family: string): number[] {
	const after = id.slice(id.indexOf(family) + family.length);
	return (after.match(/\d+/g) ?? []).map(Number).map((n) => (n > 1000 ? 0 : n));
}

function compareDesc(a: number[], b: number[]): number {
	for (let i = 0; i < Math.max(a.length, b.length); i++) {
		const d = (b[i] ?? -1) - (a[i] ?? -1);
		if (d) return d;
	}
	return 0;
}

/** Newest model whose id contains `family` (e.g. "haiku", "sonnet", "flash", "mini"). */
export function newestOf(models: string[], family: string): string | null {
	const hits = models.filter((m) => m.toLowerCase().includes(family));
	if (!hits.length) return null;
	return hits.sort((a, b) => compareDesc(versionKey(a, family), versionKey(b, family)) || a.length - b.length)[0]!;
}

/** Static cheap-model fallbacks when the live list is not at hand. */
export const CHEAP_DEFAULTS: Partial<Record<ProviderKind, string>> = {
	"claude-subscription": "claude-haiku-5-5",
	anthropic: "claude-haiku-5-5",
	openai: "gpt-4o-mini",
	google: "gemini-2.5-flash",
};

export function cheapDefault(type: ProviderKind): string {
	return CHEAP_DEFAULTS[type] ?? getDefaultModel(type);
}

/** Suggested model per slot for a provider, from its live list (falls back to static defaults). */
export function suggestModels(type: ProviderKind, models: string[], defaultModel: string | null): Record<ModelSlot, string> {
	const isClaude = type === "claude-subscription" || type === "anthropic";
	const main = (isClaude ? newestOf(models, "sonnet") : null) ?? defaultModel ?? getDefaultModel(type) ?? models[0] ?? "";
	let cheap: string | null = null;
	if (isClaude) cheap = newestOf(models, "haiku");
	else if (type === "openai") cheap = newestOf(models.filter((m) => !/audio|realtime|search|transcribe/.test(m)), "mini");
	else if (type === "google") cheap = newestOf(models.filter((m) => !/lite|image|tts|live/.test(m)), "flash");
	return { planner: main, vision: main, cheap: cheap ?? (CHEAP_DEFAULTS[type] && models.includes(CHEAP_DEFAULTS[type]!) ? CHEAP_DEFAULTS[type]! : main) };
}
