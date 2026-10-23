import { aiChannels as ch, type ProviderDraft, type TestResult } from "@shared/ipc/ai";
import { writeLog } from "../app/logger";
import { aiStore as store } from "../ai";
import { createProviderAdapter } from "../ai/providers";
import { isLoggedIn, resolveClaudeCliPath } from "../ai/providers/claude-subscription";
import type { ProviderAdapter, TestConnectionResult } from "../ai/providers/types";
import { registerSecret } from "../security/redact";
import { handle } from "./register";

/** Model lists are kept for 10 minutes (in the provider row) so Settings stays quick. */
const MODEL_CACHE_MS = 10 * 60 * 1000;

async function savedAdapter(id: string): Promise<ProviderAdapter> {
	return createProviderAdapter(await store.toConfig(store.mustGet(id)));
}

/** Adapter for unsaved form values. A saved provider with an empty key field keeps its saved key. */
async function draftAdapter(d: ProviderDraft): Promise<ProviderAdapter> {
	const saved = d.id ? store.mustGet(d.id) : null;
	const typed = d.apiKey?.trim() ?? "";
	// Masked in logs and errors from now on, even though it is never stored.
	registerSecret(typed);
	const apiKey = typed || (saved ? (await store.toConfig(saved)).apiKey : "");
	return createProviderAdapter({ id: d.id ?? "draft", name: saved?.name ?? "draft", kind: d.kind, apiKey, baseUrl: d.baseUrl?.trim() || null, defaultModel: null });
}

async function timedTest(adapter: ProviderAdapter, modelId: string | undefined): Promise<{ r: TestConnectionResult; out: TestResult }> {
	const started = Date.now();
	const r = await adapter.testConnection(modelId);
	const model = modelId || adapter.config.defaultModel || undefined;
	return { r, out: { ok: r.success, error: r.error, transient: r.transient, model, ms: Date.now() - started } };
}

async function modelsFor(id: string, refresh: boolean): Promise<string[]> {
	const hit = refresh ? null : store.cachedModels(id, MODEL_CACHE_MS);
	if (hit) return hit;
	const models = await (await savedAdapter(id)).listModels();
	if (models.length) store.storeModels(id, models);
	return models;
}

export function registerAiIpc(): void {
	handle(ch.list, () => store.list());

	handle(ch.save, async (input) => store.toView(await store.save(input)));

	handle(ch.remove, ({ id }) => {
		store.remove(id);
		writeLog("ai", "info", `provider removed: ${id}`);
		return { ok: true as const };
	});

	handle(ch.setEnabled, ({ id, enabled }) => {
		store.setEnabled(id, enabled);
		return { ok: true as const };
	});

	handle(ch.setDefault, ({ id }) => {
		store.setDefault(id);
		return { ok: true as const };
	});

	handle(ch.test, async ({ id, modelId }) => {
		const { r, out } = await timedTest(await savedAdapter(id), modelId);
		store.markTested(id, r);
		// A working provider fills any empty model slot.
		if (r.success) {
			try {
				const filled = store.fillEmptySlots(id, await modelsFor(id, false));
				if (Object.keys(filled).length) writeLog("ai", "info", `model slots filled: ${JSON.stringify(filled)}`);
			} catch (err) {
				writeLog("ai", "warn", "could not fill model slots", err);
			}
		}
		return out;
	});

	handle(ch.models, ({ id, refresh }) => modelsFor(id, !!refresh));

	handle(ch.draftModels, async (d) => (await draftAdapter(d)).listModels());

	handle(ch.draftTest, async ({ modelId, ...d }) => (await timedTest(await draftAdapter(d), modelId)).out);

	handle(ch.getSlots, () => store.getSlots());

	handle(ch.setSlot, ({ slot, value }) => {
		store.setSlot(slot, value);
		return { ok: true as const };
	});

	handle(ch.usageSummary, ({ days }) => store.usageSummary(days));

	handle(ch.usageRecent, ({ limit, failedOnly }) => store.usageRecent(limit, failedOnly));

	handle(ch.claudeStatus, () => ({ loggedIn: isLoggedIn(), cliFound: !!resolveClaudeCliPath() }));
}
