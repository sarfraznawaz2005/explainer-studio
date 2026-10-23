import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import { BaseAdapter } from "./base";
import { PROVIDER_HEADERS } from "./headers";
import { writeLog } from "../../app/logger";
import type { ProviderConfig } from "./types";

/**
 * "Free" provider: OpenCode Zen, an OpenAI-compatible endpoint that serves a
 * set of free models with the public key. Mirrors AgentDesk's adapter.
 */
export const OPENCODE_BASE_URL = "https://opencode.ai/zen/v1";
const MODELS_DEV_URL = "https://models.dev/api.json";
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Headers for Zen. Without them Zen treats requests as anonymous and applies a much lower rate limit.
 * The free key also needs the extra session headers the real CLI sends.
 */
export function zenHeaders(sessionId: string, freeTier = false): Record<string, string> {
	const headers: Record<string, string> = {
		"x-opencode-client": "cli",
		"x-opencode-session": sessionId,
		"x-opencode-project": "global",
	};
	if (freeTier) {
		headers["x-opencode-session-id"] = sessionId;
		headers["x-session-affinity"] = sessionId;
		headers["x-session-id"] = sessionId;
	} else {
		headers["x-opencode-request"] = `msg_${crypto.randomUUID()}`;
	}
	return headers;
}

/*
 * Free-tier ("public" key) compatibility shim, copied from AgentDesk.
 * REVERSE-ENGINEERED AND FRAGILE: the Zen free tier sits behind a gate that only
 * lets the official opencode CLI through. Observed requirements (may change without notice):
 *   - x-opencode-session = ses_ + 12 hex of a DESCENDING time id + 14 base62
 *   - body stream:true
 *   - tools[] containing "read" and ("shell" or "bash"); only the names are checked
 *   - User-Agent opencode/<version >= 1.17.0>
 * Applied ONLY for Zen with `Authorization: Bearer public`; paid keys and other providers are untouched.
 * If the gate rejects us (403/426) we show a clear error instead of the raw upstream body.
 */
const FREE_TIER_USER_AGENT = "opencode/1.18.31";
const FREE_TIER_ERROR = "OpenCode free tier unavailable: the upstream compatibility gate rejected the request (HTTP {status}). Use a paid OpenCode Zen key or another provider.";
const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/** Mirrors opencode's Identifier.descending("session"); the counter stays 0 (>=100 is rejected). */
export function createSessionId(): string {
	const mod = 1n << 48n;
	const head = (mod - 1n - ((BigInt(Date.now()) * 4096n) % mod)).toString(16).padStart(12, "0");
	const rand = crypto.getRandomValues(new Uint8Array(14));
	const tail = Array.from(rand, (b) => BASE62[b % 62]).join("");
	return `ses_${head}${tail}`;
}

type Json = Record<string, any>;

/** Adds gate-satisfying placeholder tools; returns the names it injected. */
function injectPlaceholderTools(body: Json): Set<string> {
	const tools: Json[] = Array.isArray(body.tools) ? body.tools : [];
	const names = new Set(tools.map((t) => t?.function?.name));
	const injected = new Set<string>();
	const add = (name: string) => {
		tools.push({ type: "function", function: { name, description: "unused", parameters: { type: "object", properties: {} } } });
		injected.add(name);
	};
	if (!names.has("read")) add("read");
	if (!names.has("shell") && !names.has("bash")) add("shell");
	if (injected.size > 0) body.tools = tools;
	return injected;
}

/** The parsed JSON of one `data:` SSE line (null for [DONE], undefined for other lines). */
function parseSseLine(line: string): Json | null | undefined {
	if (!line.startsWith("data:")) return undefined;
	const payload = line.slice(5).trim();
	if (!payload || payload === "[DONE]") return null;
	try {
		return JSON.parse(payload) as Json;
	} catch {
		return undefined;
	}
}

/**
 * Pass-through SSE with stray tool calls to the injected placeholders removed.
 * A placeholder call is spotted by its name on the first delta, then dropped by index
 * for the rest of the stream. Chunks the removal empties are dropped.
 */
function filterPlaceholderCalls(upstream: Response, injected: Set<string>): Response {
	const dropped = new Set<number>();
	const decoder = new TextDecoder();
	const encoder = new TextEncoder();
	let buffer = "";
	const transform = (line: string): string | null => {
		const chunk = parseSseLine(line);
		const calls: Json[] | undefined = chunk?.choices?.[0]?.delta?.tool_calls;
		if (!chunk || !calls) return line;
		const kept = calls.filter((c) => {
			if (c.function?.name && injected.has(c.function.name)) dropped.add(c.index);
			return !dropped.has(c.index);
		});
		if (kept.length === calls.length) return line;
		if (kept.length === 0) {
			delete chunk.choices[0].delta.tool_calls;
			const d = chunk.choices[0].delta;
			if (Object.keys(d).length === 0 && !chunk.choices[0].finish_reason && !chunk.usage) return null;
		} else {
			chunk.choices[0].delta.tool_calls = kept;
		}
		return `data: ${JSON.stringify(chunk)}`;
	};
	const stream = upstream.body!.pipeThrough(
		new TransformStream<Uint8Array, Uint8Array>({
			transform(bytes, controller) {
				buffer += decoder.decode(bytes, { stream: true });
				const lines = buffer.split("\n");
				buffer = lines.pop() ?? "";
				for (const line of lines) {
					const out = transform(line.replace(/\r$/, ""));
					if (out !== null) controller.enqueue(encoder.encode(out + "\n"));
				}
			},
			flush(controller) {
				if (buffer) controller.enqueue(encoder.encode(buffer));
			},
		}),
	);
	return new Response(stream, { status: upstream.status, statusText: upstream.statusText, headers: upstream.headers });
}

/** Buffers an SSE completion and rebuilds a plain chat.completion JSON response. */
async function reassembleCompletion(upstream: Response, injected: Set<string>): Promise<Response> {
	let id: string | undefined;
	let model: string | undefined;
	let created: number | undefined;
	let usage: Json | undefined;
	let finishReason: string | null = null;
	let content = "";
	let reasoning = "";
	const calls = new Map<number, { id?: string; name: string; args: string }>();

	for (const line of (await upstream.text()).split("\n")) {
		const chunk = parseSseLine(line.trim());
		if (!chunk) continue;
		id ??= chunk.id;
		model ??= chunk.model;
		created ??= chunk.created;
		if (chunk.usage) usage = chunk.usage;
		const choice = chunk.choices?.[0];
		if (!choice) continue;
		if (choice.finish_reason) finishReason = choice.finish_reason;
		const delta = choice.delta ?? {};
		content += delta.content ?? "";
		reasoning += delta.reasoning_content ?? delta.reasoning ?? "";
		for (const c of (delta.tool_calls ?? []) as Json[]) {
			const entry = calls.get(c.index) ?? { name: "", args: "" };
			entry.id ??= c.id;
			entry.name += c.function?.name ?? "";
			entry.args += c.function?.arguments ?? "";
			calls.set(c.index, entry);
		}
	}

	const toolCalls = [...calls.entries()]
		.sort(([a], [b]) => a - b)
		.filter(([, c]) => !injected.has(c.name))
		.map(([i, c]) => ({ id: c.id ?? `call_${i}`, type: "function", function: { name: c.name, arguments: c.args } }));
	const message: Json = { role: "assistant", content: content || null };
	if (reasoning) message.reasoning_content = reasoning;
	if (toolCalls.length > 0) message.tool_calls = toolCalls;
	if (finishReason === "tool_calls" && toolCalls.length === 0) finishReason = "stop";

	return new Response(JSON.stringify({ id, object: "chat.completion", created, model, choices: [{ index: 0, message, finish_reason: finishReason }], usage }), {
		status: 200,
		headers: { "content-type": "application/json" },
	});
}

/** A free-tier chat-completions request: returns the (possibly rewritten) response. */
async function freeTierChatFetch(input: RequestInfo | URL, init: RequestInit, headers: Headers): Promise<Response> {
	let body: Json;
	try {
		body = JSON.parse(init.body as string) as Json;
	} catch {
		return fetch(input, { ...init, headers });
	}
	const callerWantsStream = body.stream === true;
	if (!callerWantsStream) {
		body.stream = true;
		body.stream_options ??= { include_usage: true };
	}
	const injected = injectPlaceholderTools(body);

	const res = await fetch(input, { ...init, headers, body: JSON.stringify(body) });
	if (res.status === 403 || res.status === 426) {
		const message = FREE_TIER_ERROR.replace("{status}", String(res.status));
		return new Response(JSON.stringify({ error: { message } }), { status: res.status, headers: { "content-type": "application/json" } });
	}
	if (!res.ok || !res.body) return res;
	if (!callerWantsStream) return reassembleCompletion(res, injected);
	return injected.size > 0 ? filterPlaceholderCalls(res, injected) : res;
}

export function zenFetch(sessionId: string): typeof fetch {
	return (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
		if (!url.startsWith(OPENCODE_BASE_URL)) return fetch(input, init);
		const headers = new Headers(init?.headers);
		const freeTier = headers.get("authorization") === "Bearer public";
		for (const [k, v] of Object.entries(zenHeaders(sessionId, freeTier))) headers.set(k, v);
		if (freeTier) {
			// Set last: the AI SDK would otherwise leave the app's own User-Agent (HTTP 426).
			headers.set("User-Agent", FREE_TIER_USER_AGENT);
			if (url.endsWith("/chat/completions") && typeof init?.body === "string") return freeTierChatFetch(input, init, headers);
		}
		return fetch(input, { ...init, headers });
	}) as typeof fetch;
}

let modelsCache: { models: string[]; ts: number } | null = null;

/** Zen /models (primary) intersected with models.dev free list (cost.input === 0). */
export async function fetchFreeModels(sessionId: string): Promise<string[]> {
	const apiP = fetch(`${OPENCODE_BASE_URL}/models`, {
		headers: { Authorization: "Bearer public", "User-Agent": FREE_TIER_USER_AGENT, ...zenHeaders(sessionId, true) },
		signal: AbortSignal.timeout(30_000),
	})
		.then(async (r) => (r.ok ? ((await r.json()) as { data?: Array<{ id: string }> }).data?.map((m) => m.id) ?? [] : null))
		.catch((err) => {
			writeLog("provider-errors", "warn", "opencode /models failed", err);
			return null;
		});
	const catalogP = fetch(MODELS_DEV_URL, { signal: AbortSignal.timeout(10_000) })
		.then(async (r) => {
			if (!r.ok) return null;
			const catalog = (await r.json()) as Record<string, { models?: Record<string, { cost?: { input?: number } }> }>;
			const models = catalog.opencode?.models;
			if (!models) return null;
			return new Set(Object.entries(models).filter(([, m]) => m?.cost?.input === 0).map(([id]) => id));
		})
		.catch(() => null);
	const [api, free] = await Promise.all([apiP, catalogP]);
	if (api && free) return api.filter((id) => free.has(id));
	if (api) return api;
	if (free) return [...free];
	return [];
}

export class OpenCodeAdapter extends BaseAdapter {
	private provider: ReturnType<typeof createOpenAICompatible>;
	private sessionId = createSessionId();

	constructor(config: ProviderConfig) {
		super(config);
		const key = config.apiKey && config.apiKey !== "public" ? config.apiKey : "public";
		this.provider = createOpenAICompatible({
			name: "opencode",
			apiKey: key,
			baseURL: OPENCODE_BASE_URL,
			headers: PROVIDER_HEADERS,
			fetch: zenFetch(this.sessionId),
			includeUsage: true,
		});
	}

	createModel(modelId: string): LanguageModel {
		return this.provider(modelId);
	}

	protected async fetchModels(): Promise<string[]> {
		if (modelsCache && Date.now() - modelsCache.ts < CACHE_TTL_MS) return modelsCache.models;
		const models = await fetchFreeModels(this.sessionId);
		if (models.length) modelsCache = { models, ts: Date.now() };
		return models;
	}

	override async testConnection(modelId?: string) {
		const models = await this.listModels();
		if (!models.length) return { success: false, error: "No free models available from OpenCode. Check your connection.", transient: true };
		const id = modelId || this.config.defaultModel || (models.includes("big-pickle") ? "big-pickle" : models[0]);
		return super.testConnection(id);
	}
}
