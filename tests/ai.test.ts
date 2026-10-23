import { existsSync } from "node:fs";
import { join } from "node:path";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { aiChannels } from "../src/shared/ipc/ai";
import { costOf, createPriceBook, lookupPrice, priceCall, pricesFromCatalog } from "../src/main/ai/pricing";
import type { ProviderAdapter, ProviderConfig } from "../src/main/ai/providers/types";
import { runModelText } from "../src/main/ai/run";
import { createAiService } from "../src/main/ai/service";
import { createAiStore } from "../src/main/ai/store";
import { extractJson, generateStructured, StructuredOutputError, type TurnRunner } from "../src/main/ai/structured";
import { openFile, type Db } from "../src/main/db/connection";
import { runMigrations } from "../src/main/db/migrate";
import { MIGRATIONS } from "../src/main/db/migrations";
import { createRepos } from "../src/main/db/repos";
import { parseInput } from "../src/main/ipc/validate";
import { createKeystore, type Sealer } from "../src/main/security/keystore";
import { tempDir } from "./helpers";

/* ---------- helpers ---------- */

type Reply = { text: string; input?: number; output?: number };

/** An AI SDK mock model that answers with the given texts in order. */
function mockModel(replies: Reply[]) {
	let i = 0;
	return new MockLanguageModelV4({
		doGenerate: async () => {
			const r = replies[Math.min(i++, replies.length - 1)]!;
			return {
				content: [{ type: "text", text: r.text }],
				finishReason: { unified: "stop", raw: "stop" },
				usage: {
					inputTokens: { total: r.input ?? 100, noCache: r.input ?? 100, cacheRead: 0, cacheWrite: 0 },
					outputTokens: { total: r.output ?? 20, text: r.output ?? 20, reasoning: 0 },
				},
				warnings: [],
			};
		},
	});
}

const runnerFor = (model: MockLanguageModelV4): TurnRunner => (req) => runModelText(model, req);

const Outline = z.object({
	title: z.string().min(1),
	chapters: z.array(z.object({ title: z.string(), minutes: z.number().positive() })).min(1),
});
const GOOD = JSON.stringify({ title: "Photosynthesis", chapters: [{ title: "Light", minutes: 3 }] });

/** Reversible fake: never use outside tests. */
const fakeSealer: Sealer = {
	available: async () => true,
	seal: async (plain) => new Uint8Array(Buffer.from(`sealed:${Buffer.from(plain).toString("base64")}`)),
	open: async (sealed) => Buffer.from(Buffer.from(sealed).toString("utf8").replace(/^sealed:/, ""), "base64").toString("utf8"),
};

const dbs: Db[] = [];
afterEach(() => {
	for (const d of dbs.splice(0)) if (d.isOpen) d.close();
});

async function setup() {
	const d = openFile(join(tempDir(), "studio.db"));
	dbs.push(d);
	await runMigrations(d, MIGRATIONS);
	const repos = createRepos(() => d);
	const store = createAiStore({ repos, keystore: createKeystore(fakeSealer), getDb: () => d });
	return { d, repos, store };
}

/* ---------- structured output ---------- */

describe("generateStructured", () => {
	it("returns a zod-valid object on the first try", async () => {
		const model = mockModel([{ text: GOOD }]);
		const r = await generateStructured(runnerFor(model), { schema: Outline, system: "You plan videos.", prompt: "Plan a video." });
		expect(r.value).toEqual({ title: "Photosynthesis", chapters: [{ title: "Light", minutes: 3 }] });
		expect(r.attempts).toBe(1);
		expect(r.usage).toMatchObject({ inputTokens: 100, outputTokens: 20 });
		// The JSON Schema travels in the system prompt.
		const sys = JSON.stringify(model.doGenerateCalls[0]!.prompt[0]);
		expect(sys).toContain("JSON Schema");
		expect(sys).toContain("chapters");
	});

	it("repairs an invalid reply and retries with the problems listed", async () => {
		const bad = JSON.stringify({ title: "", chapters: [{ title: "Light", minutes: -1 }] });
		const model = mockModel([{ text: bad }, { text: "```json\n" + GOOD + "\n```" }]);
		const r = await generateStructured(runnerFor(model), { schema: Outline, system: "s", prompt: "p" });
		expect(r.attempts).toBe(2);
		expect(r.value.title).toBe("Photosynthesis");
		expect(r.usage.inputTokens).toBe(200);
		// The second call carries the bad reply and a repair message naming the paths.
		const second = model.doGenerateCalls[1]!.prompt;
		const repair = JSON.stringify(second.at(-1));
		expect(second.filter((m) => m.role === "assistant")).toHaveLength(1);
		expect(repair).toContain("title");
		expect(repair).toContain("chapters.0.minutes");
	});

	it("repairs a reply that is not JSON at all", async () => {
		const model = mockModel([{ text: "Sure! Here is your outline: Light, Dark." }, { text: GOOD }]);
		const r = await generateStructured(runnerFor(model), { schema: Outline, system: "s", prompt: "p" });
		expect(r.attempts).toBe(2);
		expect(JSON.stringify(model.doGenerateCalls[1]!.prompt.at(-1))).toContain("no JSON");
	});

	it("gives up after 2 repairs with a clear error", async () => {
		const model = mockModel([{ text: '{"title": 5}' }]);
		const err = await generateStructured(runnerFor(model), { schema: Outline, system: "s", prompt: "p" }).catch((e: unknown) => e);
		expect(err).toBeInstanceOf(StructuredOutputError);
		expect((err as StructuredOutputError).attempts).toBe(3);
		expect((err as StructuredOutputError).problems.length).toBeGreaterThan(0);
		expect(model.doGenerateCalls).toHaveLength(3);
	});

	it("does not repair when the model call itself fails", async () => {
		const run = vi.fn<TurnRunner>().mockRejectedValue(new Error("HTTP 401 invalid key"));
		await expect(generateStructured(run, { schema: Outline, system: "s", prompt: "p" })).rejects.toThrow("401");
		expect(run).toHaveBeenCalledTimes(1);
	});

	it("extractJson tolerates prose, fences and braces inside strings", () => {
		expect(extractJson('Here: {"a": "x } y", "b": [1, {"c": 2}]} done')).toEqual({ a: "x } y", b: [1, { c: 2 }] });
		expect(() => extractJson('{"a": 1')).toThrow(/cut off/);
	});
});

/* ---------- providers and slots ---------- */

describe("AI store", () => {
	it("seals the key, never shows it, and keeps it when an edit leaves it out", async () => {
		const { d, store } = await setup();
		const key = "sk-or-v1-this-is-a-private-test-key-0001";
		const p = await store.save({ kind: "openrouter", name: "OpenRouter", apiKey: key, baseUrl: null, defaultModel: "openrouter/free" });
		const raw = d.prepare("SELECT secret FROM providers WHERE id = ?").get(p.id) as { secret: Uint8Array };
		expect(Buffer.from(raw.secret).toString("utf8")).not.toContain(key);
		const view = store.toView(p);
		expect(view.hasKey).toBe(true);
		expect(JSON.stringify(view)).not.toContain(key);
		expect(view.isDefault).toBe(true); // first provider becomes the default

		await store.save({ id: p.id, kind: "openrouter", name: "OR", baseUrl: null, defaultModel: null });
		expect((await store.toConfig(store.mustGet(p.id))).apiKey).toBe(key);
		await store.save({ id: p.id, kind: "openrouter", name: "OR", apiKey: "", baseUrl: null, defaultModel: null });
		expect(store.toView(store.mustGet(p.id)).hasKey).toBe(false);
	});

	it("a new key clears the last test result; a transient failure does not undo a pass", async () => {
		const { store } = await setup();
		const p = await store.save({ kind: "groq", name: "Groq", apiKey: "gsk_first_key_123456", baseUrl: null, defaultModel: null });
		// Never passed: an unreachable server is shown as failed.
		store.markTested(p.id, { success: false, transient: true, error: "Cannot reach the server" });
		expect(store.mustGet(p.id).testOk).toBe(false);
		store.markTested(p.id, { success: true });
		expect(store.mustGet(p.id).testOk).toBe(true);
		store.markTested(p.id, { success: false, transient: true, error: "429" });
		expect(store.mustGet(p.id).testOk).toBe(true);
		store.markTested(p.id, { success: false, error: "401 bad key" });
		expect(store.mustGet(p.id)).toMatchObject({ testOk: false, testError: "401 bad key" });
		await store.save({ id: p.id, kind: "groq", name: "Groq", apiKey: "gsk_second_key_123456", baseUrl: null, defaultModel: null });
		expect(store.mustGet(p.id).testOk).toBeNull();
	});

	it("slot pickers save planner, vision and cheap; deleting the provider clears them", async () => {
		const { store } = await setup();
		const a = await store.save({ kind: "opencode", name: "Free", baseUrl: null, defaultModel: "big-pickle" });
		const b = await store.save({ kind: "anthropic", name: "Claude", apiKey: "sk-ant-test-0000000000000000", baseUrl: null, defaultModel: null });
		store.setSlot("planner", { providerId: b.id, modelId: "claude-opus-5-5" });
		store.setSlot("vision", { providerId: b.id, modelId: "claude-sonnet-5-5" });
		store.setSlot("cheap", { providerId: a.id, modelId: "big-pickle" });
		expect(store.getSlots()).toEqual({
			planner: { providerId: b.id, modelId: "claude-opus-5-5" },
			vision: { providerId: b.id, modelId: "claude-sonnet-5-5" },
			cheap: { providerId: a.id, modelId: "big-pickle" },
		});
		expect(store.resolveSlot("planner")).toMatchObject({ modelId: "claude-opus-5-5", kind: "anthropic" });
		expect(() => store.setSlot("planner", { providerId: "00000000-0000-4000-8000-000000000000", modelId: "x" })).toThrow(/not found/);

		store.remove(b.id);
		expect(store.getSlots()).toEqual({ planner: null, vision: null, cheap: { providerId: a.id, modelId: "big-pickle" } });
		// An empty slot falls back to the default provider and its model.
		expect(store.resolveSlot("planner")).toMatchObject({ modelId: "big-pickle", kind: "opencode" });
		store.setSlot("cheap", null);
		expect(store.getSlots().cheap).toBeNull();
	});

	it("deleting the default provider makes another one the default", async () => {
		const { store } = await setup();
		const a = await store.save({ kind: "opencode", name: "A", baseUrl: null, defaultModel: null });
		const b = await store.save({ kind: "ollama", name: "B", baseUrl: "http://localhost:11434/v1", defaultModel: "llama3.2" });
		expect(store.mustGet(a.id).isDefault).toBe(true);
		store.remove(a.id);
		expect(store.mustGet(b.id).isDefault).toBe(true);
		store.remove(b.id);
		expect(() => store.resolveSlot("planner")).toThrow(/No AI provider/);
	});

	it("fills only empty slots from a working provider", async () => {
		const { store } = await setup();
		const p = await store.save({ kind: "anthropic", name: "Claude", apiKey: "sk-ant-test-0000000000000000", baseUrl: null, defaultModel: null });
		store.setSlot("planner", { providerId: p.id, modelId: "claude-opus-5-5" });
		const filled = store.fillEmptySlots(p.id, ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-sonnet-4-6", "claude-opus-5-5"]);
		expect(filled).toEqual({ vision: "claude-sonnet-5-5", cheap: "claude-haiku-5-5" });
		expect(store.getSlots().planner?.modelId).toBe("claude-opus-5-5");
	});

	it("IPC input rejects bad ids, URLs and model names", () => {
		expect(() => parseInput(aiChannels.remove, { id: "../../etc" })).toThrow();
		expect(() => parseInput(aiChannels.save, { kind: "custom", name: "x", baseUrl: "file:///C:/x", defaultModel: null })).toThrow();
		expect(() => parseInput(aiChannels.save, { kind: "evil", name: "x", baseUrl: null, defaultModel: null })).toThrow();
		expect(() => parseInput(aiChannels.setSlot, { slot: "planner", value: { providerId: "00000000-0000-4000-8000-000000000000", modelId: "a b; rm" } })).toThrow();
		expect(parseInput(aiChannels.save, { kind: "ollama", name: "Local", baseUrl: "http://localhost:11434/v1", defaultModel: "llama3.2:latest" })).toBeTruthy();
	});
});

/* ---------- usage and cost ---------- */

const CATALOG = {
	anthropic: { models: { "claude-sonnet-5-5": { cost: { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 } } } },
	opencode: { models: { "big-pickle": { cost: { input: 0, output: 0 } } } },
	somethingElse: { models: { x: { cost: { input: 1, output: 1 } } } },
};

function fakeFetch() {
	return vi.fn(async () => new Response(JSON.stringify(CATALOG), { status: 200 })) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

describe("pricing", () => {
	it("computes cost from the catalog and labels free, subscription and unknown calls", () => {
		const table = pricesFromCatalog(CATALOG);
		expect(Object.keys(table)).not.toContain("somethingElse");
		const price = lookupPrice(table, "anthropic", "claude-sonnet-5-5")!;
		const usage = { inputTokens: 1_000_000, outputTokens: 100_000, cacheReadTokens: 0, cacheWriteTokens: 0 };
		expect(costOf(usage, price)).toBeCloseTo(3 + 1.5);
		expect(costOf({ ...usage, cacheReadTokens: 1_000_000 }, price)).toBeCloseTo(0.3 + 1.5);
		expect(priceCall("anthropic", price, usage)).toEqual({ billing: "api", costUsd: expect.closeTo(4.5) });
		expect(priceCall("opencode", lookupPrice(table, "opencode", "big-pickle"), usage)).toEqual({ billing: "free", costUsd: 0 });
		expect(priceCall("ollama", null, usage)).toEqual({ billing: "free", costUsd: 0 });
		expect(priceCall("claude-subscription", price, usage, 0.42)).toEqual({ billing: "subscription", costUsd: 0.42 });
		expect(priceCall("custom", null, usage)).toEqual({ billing: "unknown", costUsd: null });
	});

	it("caches prices on disk and fetches at most once a day", async () => {
		const dir = tempDir();
		const fetchImpl = fakeFetch();
		let now = 1_000_000;
		const book = createPriceBook({ cacheFile: join(dir, "prices.json"), fetchImpl, now: () => now });
		expect(await book.price("anthropic", "claude-sonnet-5-5")).toMatchObject({ input: 3 });
		expect(await book.price("anthropic", "nope")).toBeNull();
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		expect(existsSync(join(dir, "prices.json"))).toBe(true);
		// A new book reads the file instead of fetching.
		const again = createPriceBook({ cacheFile: join(dir, "prices.json"), fetchImpl, now: () => now });
		expect(await again.price("opencode", "big-pickle")).toMatchObject({ input: 0 });
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		now += 25 * 60 * 60 * 1000;
		await again.table();
		expect(fetchImpl).toHaveBeenCalledTimes(2);
	});
});

describe("AI service usage log", () => {
	function serviceWith(store: ReturnType<typeof createAiStore>, model: MockLanguageModelV4) {
		const buildAdapter = (config: ProviderConfig): ProviderAdapter => ({
			config,
			createModel: () => model,
			listModels: async () => [],
			testConnection: async () => ({ success: true }),
		});
		const prices = createPriceBook({ cacheFile: join(tempDir(), "p.json"), fetchImpl: fakeFetch() });
		return createAiService({ store, prices, buildAdapter });
	}

	it("records tokens and cost for every call, repair rounds included", async () => {
		const { store } = await setup();
		const p = await store.save({ kind: "anthropic", name: "Claude", apiKey: "sk-ant-test-0000000000000000", baseUrl: null, defaultModel: null });
		store.setSlot("planner", { providerId: p.id, modelId: "claude-sonnet-5-5" });
		const model = mockModel([
			{ text: "not json", input: 1000, output: 10 },
			{ text: GOOD, input: 1200, output: 50 },
		]);
		const r = await serviceWith(store, model).generateStructured({ schema: Outline, system: "s", prompt: "p" }, { slot: "planner", purpose: "plan.outline" });
		expect(r.attempts).toBe(2);

		const rows = store.usageRecent(10).sort((a, b) => a.attempt - b.attempt);
		expect(rows).toHaveLength(2);
		expect(rows[0]).toMatchObject({ attempt: 1, ok: true, inputTokens: 1000, outputTokens: 10, purpose: "plan.outline", slot: "planner", model: "claude-sonnet-5-5", billing: "api" });
		expect(rows[1]!.costUsd).toBeCloseTo((1200 * 3 + 50 * 15) / 1_000_000);
		const sum = store.usageSummary(30);
		expect(sum).toMatchObject({ calls: 2, failed: 0, inputTokens: 2200, outputTokens: 60, unpriced: 0 });
		expect(sum.costUsd).toBeCloseTo((1000 * 3 + 10 * 15 + 1200 * 3 + 50 * 15) / 1_000_000);
	});

	it("records failed calls with the redacted error", async () => {
		const { store } = await setup();
		const key = "sk-ant-test-secret-9999999999999999";
		await store.save({ kind: "anthropic", name: "Claude", apiKey: key, baseUrl: null, defaultModel: "claude-sonnet-5-5" });
		const model = new MockLanguageModelV4({
			doGenerate: async () => {
				throw new Error(`401 Unauthorized for key ${key}`);
			},
		});
		await expect(serviceWith(store, model).generateText({ system: "s", prompt: "p" }, { slot: "cheap", purpose: "title" })).rejects.toThrow();
		const [row] = store.usageRecent(5, true);
		expect(row).toMatchObject({ ok: false, purpose: "title" });
		expect(row!.error).toContain("401");
		expect(row!.error).not.toContain(key);
		expect(store.usageSummary(1).failed).toBe(1);
	});
});
