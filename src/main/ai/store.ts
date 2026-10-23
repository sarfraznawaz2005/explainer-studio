import { MODEL_SLOTS, ProviderKind, type ModelSlot, type ProviderView, type Slots, type SlotValue, type UsageRow, type UsageSummary } from "@shared/ipc/ai";
import type { AiUsage, Provider } from "@shared/models";
import { inTransaction, type Db } from "../db/connection";
import type { NewRow } from "../db/repo";
import type { Repos } from "../db/repos";
import type { Keystore } from "../security/keystore";
import { cheapDefault, suggestModels } from "./providers/defaults";
import { getDefaultModel } from "./providers/models";
import type { ProviderConfig, TestConnectionResult } from "./providers/types";

const slotKey = (slot: ModelSlot) => `ai.slot.${slot}`;

export type SaveInput = {
	id?: string;
	kind: ProviderKind;
	name: string;
	/** Omit to keep the saved key. An empty string removes it. */
	apiKey?: string;
	baseUrl: string | null;
	defaultModel: string | null;
};

export type Resolved = { provider: Provider; kind: ProviderKind; modelId: string };

type ModelCache = { ids: string[]; fetchedAt: string };

/**
 * Providers, model slots and the usage log. Everything the AI layer stores goes
 * through here. Keys are sealed before they touch the database and opened only
 * to build an adapter in main.
 */
export function createAiStore(deps: { repos: Repos; keystore: Keystore; getDb: () => Db }) {
	const { repos, keystore } = deps;
	const tx = <T>(fn: () => T): T => inTransaction(fn, deps.getDb());

	const kindOf = (p: Provider): ProviderKind | null => {
		const r = ProviderKind.safeParse(p.kind);
		return r.success ? r.data : null;
	};

	const toView = (p: Provider): ProviderView => ({
		id: p.id,
		kind: kindOf(p) ?? "custom",
		name: p.name,
		baseUrl: p.baseUrl,
		defaultModel: p.defaultModel,
		hasKey: !!p.secret && p.secret.length > 0,
		enabled: p.enabled,
		isDefault: p.isDefault,
		testOk: p.testOk,
		testError: p.testError,
		testedAt: p.testedAt,
	});

	const all = (): Provider[] =>
		repos.providers
			.list({ orderBy: "name", desc: false })
			.filter((p) => kindOf(p))
			.sort((a, b) => Number(b.isDefault) - Number(a.isDefault));

	const get = (id: string): Provider | null => repos.providers.get(id);

	const mustGet = (id: string): Provider => {
		const p = get(id);
		if (!p) throw new Error("Provider not found. It may have been deleted.");
		return p;
	};

	const getSlot = (slot: ModelSlot): SlotValue | null => repos.settings.get<SlotValue>(slotKey(slot)) ?? null;

	const store = {
		toView,
		list: (): ProviderView[] => all().map(toView),
		get,
		mustGet,

		/** Opens the key. Call only right before building an adapter. */
		async toConfig(p: Provider): Promise<ProviderConfig> {
			return { id: p.id, name: p.name, kind: kindOf(p) ?? "custom", apiKey: await keystore.open(p.secret), baseUrl: p.baseUrl, defaultModel: p.defaultModel };
		},

		async save(input: SaveInput): Promise<Provider> {
			// Seal outside the transaction: encryption is async.
			const key = input.apiKey?.trim();
			const sealed = input.apiKey === undefined ? undefined : key ? await keystore.seal(key) : null;
			const baseUrl = input.baseUrl?.trim() || null;
			const defaultModel = input.defaultModel?.trim() || null;
			return tx(() => {
				if (input.id) {
					const before = mustGet(input.id);
					const changed = sealed !== undefined || before.baseUrl !== baseUrl || before.kind !== input.kind;
					return repos.providers.update(input.id, {
						kind: input.kind,
						name: input.name.trim(),
						baseUrl,
						defaultModel,
						...(sealed !== undefined ? { secret: sealed } : {}),
						// A new key or address makes the last test meaningless.
						...(changed ? { testOk: null, testError: null, testedAt: null, models: {} } : {}),
					})!;
				}
				const row: NewRow<Provider, "models" | "enabled" | "isDefault"> = {
					kind: input.kind,
					name: input.name.trim(),
					baseUrl,
					defaultModel,
					secret: sealed ?? null,
					isDefault: repos.providers.count() === 0,
				};
				return repos.providers.create(row);
			});
		},

		/** Deletes a provider, its key and any slot that pointed at it. */
		remove(id: string): void {
			tx(() => {
				const p = get(id);
				if (!p) return;
				repos.providers.remove(id);
				for (const slot of MODEL_SLOTS) if (getSlot(slot)?.providerId === id) repos.settings.remove(slotKey(slot));
				if (p.isDefault) {
					const next = all().find((x) => x.enabled);
					if (next) repos.providers.update(next.id, { isDefault: true });
				}
			});
		},

		setEnabled(id: string, enabled: boolean): void {
			mustGet(id);
			repos.providers.update(id, { enabled });
		},

		setDefault(id: string): void {
			tx(() => {
				mustGet(id);
				for (const p of repos.providers.list({ where: { isDefault: true } })) repos.providers.update(p.id, { isDefault: false });
				repos.providers.update(id, { isDefault: true, enabled: true });
			});
		},

		/** A transient failure (rate limit, 5xx, no answer) does not undo an earlier pass: it says nothing about the key. */
		markTested(id: string, r: TestConnectionResult): void {
			if (!r.success && r.transient && get(id)?.testOk) return;
			repos.providers.update(id, { testOk: r.success, testError: r.success ? null : (r.error ?? "Failed").slice(0, 500), testedAt: new Date().toISOString() });
		},

		cachedModels(id: string, maxAgeMs: number): string[] | null {
			const m = get(id)?.models as Partial<ModelCache> | undefined;
			if (!m?.ids?.length || !m.fetchedAt) return null;
			return Date.now() - Date.parse(m.fetchedAt) < maxAgeMs ? m.ids : null;
		},

		storeModels(id: string, ids: string[]): void {
			if (get(id)) repos.providers.update(id, { models: { ids, fetchedAt: new Date().toISOString() } satisfies ModelCache });
		},

		getSlots(): Slots {
			return { planner: getSlot("planner"), vision: getSlot("vision"), cheap: getSlot("cheap") };
		},

		setSlot(slot: ModelSlot, value: SlotValue | null): void {
			if (!value) {
				repos.settings.remove(slotKey(slot));
				return;
			}
			mustGet(value.providerId);
			repos.settings.set(slotKey(slot), value);
		},

		/**
		 * Which provider and model a slot runs on:
		 * 1. the slot setting, if that provider still exists and is enabled;
		 * 2. else the default provider (or the first enabled one, preferring one whose test passed)
		 *    with its default model; the cheap slot takes the provider's small model.
		 */
		resolveSlot(slot: ModelSlot): Resolved {
			const s = getSlot(slot);
			if (s) {
				const p = get(s.providerId);
				const kind = p && kindOf(p);
				if (p && kind && p.enabled) return { provider: p, kind, modelId: s.modelId };
			}
			const enabled = all().filter((p) => p.enabled);
			const p = enabled.find((x) => x.isDefault) ?? enabled.find((x) => x.testOk) ?? enabled[0];
			if (!p) throw new Error("No AI provider is set up. Add one in Settings → AI providers.");
			const kind = kindOf(p)!;
			const modelId = slot === "cheap" ? cheapDefault(kind) : p.defaultModel || getDefaultModel(kind);
			if (!modelId) throw new Error(`"${p.name}" has no model. Pick one in Settings → AI providers.`);
			return { provider: p, kind, modelId };
		},

		/** Fills empty slots (or slots on a deleted/disabled provider) from one provider's model list. */
		fillEmptySlots(providerId: string, models: string[]): Partial<Record<ModelSlot, string>> {
			const p = get(providerId);
			const kind = p && kindOf(p);
			if (!p || !kind) return {};
			const picks = suggestModels(kind, models, p.defaultModel);
			const done: Partial<Record<ModelSlot, string>> = {};
			for (const slot of MODEL_SLOTS) {
				const cur = getSlot(slot);
				const target = cur && get(cur.providerId);
				if (target && target.enabled) continue;
				if (!picks[slot]) continue;
				repos.settings.set(slotKey(slot), { providerId, modelId: picks[slot] } satisfies SlotValue);
				done[slot] = picks[slot];
			}
			return done;
		},

		recordUsage(row: NewRow<AiUsage, "attempt" | "inputTokens" | "outputTokens" | "cacheReadTokens" | "cacheWriteTokens" | "durationMs">): AiUsage {
			return repos.aiUsage.create({ ...row, error: row.error ? row.error.slice(0, 1000) : null });
		},

		usageSummary(days: number): UsageSummary {
			const since = new Date(Date.now() - days * 86_400_000).toISOString();
			const r = deps
				.getDb()
				.prepare(
					`SELECT count(*) AS calls,
						coalesce(sum(ok = 0), 0) AS failed,
						coalesce(sum(input_tokens), 0) AS inputTokens,
						coalesce(sum(output_tokens), 0) AS outputTokens,
						coalesce(sum(CASE WHEN billing = 'api' THEN cost_usd END), 0) AS costUsd,
						coalesce(sum(billing = 'unknown'), 0) AS unpriced
					FROM ai_usage WHERE created_at >= ?`,
				)
				.get(since) as Omit<UsageSummary, "days">;
			return { days, calls: r.calls, failed: r.failed, inputTokens: r.inputTokens, outputTokens: r.outputTokens, costUsd: r.costUsd, unpriced: r.unpriced };
		},

		usageRecent(limit: number, failedOnly = false): UsageRow[] {
			return repos.aiUsage.list({ where: failedOnly ? { ok: false } : undefined, limit }).map((u) => ({
				id: u.id,
				providerName: u.providerName,
				providerKind: u.providerKind,
				model: u.model,
				slot: u.slot,
				purpose: u.purpose,
				attempt: u.attempt,
				ok: u.ok,
				error: u.error,
				inputTokens: u.inputTokens,
				outputTokens: u.outputTokens,
				cacheReadTokens: u.cacheReadTokens,
				cacheWriteTokens: u.cacheWriteTokens,
				costUsd: u.costUsd,
				billing: u.billing,
				durationMs: u.durationMs,
				createdAt: u.createdAt,
			}));
		},
	};
	return store;
}

export type AiStore = ReturnType<typeof createAiStore>;
