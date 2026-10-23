import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import type { Billing, ProviderKind } from "@shared/ipc/ai";
import type { CallUsage } from "./providers/types";

/**
 * Model prices for the usage log, from the public models.dev catalog (the same
 * source the OpenCode adapter uses for its free list). Only the prices are kept,
 * in a small cache file that is refreshed at most once a day. Nothing is sent:
 * it is one GET of a public JSON file. When a price is unknown the cost is null,
 * never a guess.
 */

/** USD per 1 million tokens. */
export type Price = { input: number; output: number; cacheRead?: number; cacheWrite?: number };
export type PriceTable = Record<string, Record<string, Price>>;

const MODELS_DEV_URL = "https://models.dev/api.json";
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Which models.dev provider holds the prices for each provider kind. */
const CATALOG_ID: Partial<Record<ProviderKind, string>> = {
	anthropic: "anthropic",
	"claude-subscription": "anthropic",
	openai: "openai",
	google: "google",
	groq: "groq",
	deepseek: "deepseek",
	xai: "xai",
	openrouter: "openrouter",
	zai: "zai",
	opencode: "opencode",
};

type Catalog = Record<string, { models?: Record<string, { cost?: { input?: number; output?: number; cache_read?: number; cache_write?: number } }> }>;

/** Keeps only providers we map to, and only models with an input and output price. */
export function pricesFromCatalog(catalog: Catalog): PriceTable {
	const out: PriceTable = {};
	for (const id of new Set(Object.values(CATALOG_ID))) {
		const models = catalog[id]?.models;
		if (!models) continue;
		const table: Record<string, Price> = {};
		for (const [model, m] of Object.entries(models)) {
			const c = m?.cost;
			if (typeof c?.input !== "number" || typeof c?.output !== "number") continue;
			table[model] = { input: c.input, output: c.output, cacheRead: c.cache_read, cacheWrite: c.cache_write };
		}
		out[id] = table;
	}
	return out;
}

export function lookupPrice(table: PriceTable | null, kind: ProviderKind, modelId: string): Price | null {
	const id = CATALOG_ID[kind];
	if (!table || !id) return null;
	const models = table[id] ?? {};
	return models[modelId] ?? models[modelId.replace(/^models\//, "")] ?? null;
}

/** Cost in USD. Cached reads and writes use their own price when the catalog has one. */
export function costOf(u: CallUsage, p: Price): number {
	const noCache = Math.max(0, u.inputTokens - u.cacheReadTokens - u.cacheWriteTokens);
	const usd = noCache * p.input + u.cacheReadTokens * (p.cacheRead ?? p.input) + u.cacheWriteTokens * (p.cacheWrite ?? p.input) + u.outputTokens * p.output;
	return usd / 1_000_000;
}

/** How a call is paid for, and its cost when that can be known. */
export function priceCall(kind: ProviderKind, price: Price | null, usage: CallUsage, reportedUsd?: number): { billing: Billing; costUsd: number | null } {
	if (kind === "ollama") return { billing: "free", costUsd: 0 };
	// Claude Code reports what the call would cost on the API; the subscription covers it.
	if (kind === "claude-subscription") return { billing: "subscription", costUsd: reportedUsd ?? (price ? costOf(usage, price) : null) };
	if (!price) return { billing: "unknown", costUsd: null };
	if (price.input === 0 && price.output === 0) return { billing: "free", costUsd: 0 };
	return { billing: "api", costUsd: costOf(usage, price) };
}

export function createPriceBook(opts: { cacheFile: string; fetchImpl?: typeof fetch; now?: () => number }) {
	const fetchImpl = opts.fetchImpl ?? fetch;
	const now = opts.now ?? Date.now;
	let mem: { fetchedAt: number; prices: PriceTable } | null = null;
	let inflight: Promise<PriceTable | null> | null = null;

	const readFile = () => {
		if (mem || !existsSync(opts.cacheFile)) return;
		try {
			const j = JSON.parse(readFileSync(opts.cacheFile, "utf8")) as { fetchedAt: number; prices: PriceTable };
			if (typeof j.fetchedAt === "number" && j.prices) mem = j;
		} catch {
			/* broken cache: refetch */
		}
	};

	const refresh = async (): Promise<PriceTable | null> => {
		try {
			const res = await fetchImpl(MODELS_DEV_URL, { signal: AbortSignal.timeout(15_000) });
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const prices = pricesFromCatalog((await res.json()) as Catalog);
			mem = { fetchedAt: now(), prices };
			const tmp = `${opts.cacheFile}.tmp`;
			writeFileSync(tmp, JSON.stringify(mem));
			renameSync(tmp, opts.cacheFile);
			return prices;
		} catch {
			// Offline or catalog down: keep the stale table rather than none.
			return mem?.prices ?? null;
		}
	};

	return {
		async table(): Promise<PriceTable | null> {
			readFile();
			if (mem && now() - mem.fetchedAt < MAX_AGE_MS) return mem.prices;
			inflight ??= refresh().finally(() => (inflight = null));
			return inflight;
		},
		async price(kind: ProviderKind, modelId: string): Promise<Price | null> {
			if (kind === "ollama" || kind === "custom") return null;
			return lookupPrice(await this.table(), kind, modelId);
		},
	};
}

export type PriceBook = ReturnType<typeof createPriceBook>;
