/**
 * Claude subscription provider.
 *
 * POLICY: this path drives the user's own, locally installed and logged-in
 * Claude Code through the official Agent SDK, on the user's own PC. That is
 * fine for personal use. Anthropic does not allow third-party products to
 * offer claude.ai login or subscription rate limits. If the app is ever
 * distributed, this provider must be hidden behind a "bring your own API
 * key" default.
 *
 * Every call is one text turn with no tools: Claude Code cannot read files,
 * run commands or reach MCP servers from here.
 */
import { query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { LanguageModel } from "ai";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { writeLog } from "../../app/logger";
import { dedupeModels, getDefaultModel, STATIC_MODELS } from "./models";
import type { CallUsage, ChatMessage, ProviderAdapter, ProviderConfig, TestConnectionResult, TextRunOpts, TextRunResult } from "./types";

const CREDENTIALS_PATH = join(homedir(), ".claude", ".credentials.json");

function readToken(): string | null {
	try {
		const j = JSON.parse(readFileSync(CREDENTIALS_PATH, "utf8")) as { claudeAiOauth?: { accessToken?: string } };
		return j.claudeAiOauth?.accessToken ?? null;
	} catch {
		return null;
	}
}

export function isLoggedIn(): boolean {
	return readToken() !== null;
}

let cliPathCache: { value: string | undefined; ts: number } | null = null;

/** The user's installed `claude` binary. Undefined lets the SDK try its optional bundled binary. */
export function resolveClaudeCliPath(): string | undefined {
	if (cliPathCache && Date.now() - cliPathCache.ts < 60_000) return cliPathCache.value;
	let found: string | undefined;
	const candidates = [join(dirname(process.execPath), "claude.exe"), join(homedir(), ".local", "bin", "claude.exe")];
	for (const c of candidates) {
		try {
			if (existsSync(c) && statSync(c).size > 0) {
				found = c;
				break;
			}
		} catch {
			/* next */
		}
	}
	if (!found) {
		try {
			const out = execFileSync("where.exe", ["claude"], { encoding: "utf8", windowsHide: true, timeout: 3000 });
			found =
				out
					.split(/\r?\n/)
					.map((s) => s.trim())
					.find((s) => s.toLowerCase().endsWith(".exe")) || undefined;
		} catch {
			/* not on PATH */
		}
	}
	cliPathCache = { value: found, ts: Date.now() };
	return found;
}

function friendlyError(message: string): string {
	if (message.includes("Native CLI binary")) return "Claude Code CLI not found. Install it, then run `claude` once in a terminal to log in.";
	return message;
}

/** Claude Code takes one prompt. Earlier turns (a repair round) are written out as a transcript. */
export function flattenMessages(messages: ChatMessage[]): string {
	if (messages.length === 1) return messages[0]!.content;
	return messages.map((m) => `[${m.role === "user" ? "User" : "Assistant"}]\n${m.content}`).join("\n\n");
}

/**
 * The prompt for one turn. Text-only turns are a plain string. When images are
 * attached (vision), they go as base64 image blocks in one streamed user message.
 */
export function buildPrompt(messages: ChatMessage[]): string | AsyncIterable<SDKUserMessage> {
	const text = flattenMessages(messages);
	const images = messages.flatMap((m) => m.images ?? []);
	if (!images.length) return text;
	const ALLOWED = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;
	const msg: SDKUserMessage = {
		type: "user",
		parent_tool_use_id: null,
		message: {
			role: "user",
			content: [
				...images.map((i) => {
					const mediaType = (ALLOWED as readonly string[]).includes(i.mediaType) ? (i.mediaType as (typeof ALLOWED)[number]) : "image/png";
					return { type: "image" as const, source: { type: "base64" as const, media_type: mediaType, data: Buffer.from(i.data).toString("base64") } };
				}),
				{ type: "text" as const, text },
			],
		},
	};
	return (async function* () {
		yield msg;
	})();
}

type ResultUsage = { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } | undefined;

function toUsage(u: ResultUsage): CallUsage {
	const read = u?.cache_read_input_tokens ?? 0;
	const write = u?.cache_creation_input_tokens ?? 0;
	return { inputTokens: (u?.input_tokens ?? 0) + read + write, outputTokens: u?.output_tokens ?? 0, cacheReadTokens: read, cacheWriteTokens: write };
}

export class ClaudeSubscriptionAdapter implements ProviderAdapter {
	constructor(readonly config: ProviderConfig) {}

	createModel(_modelId: string): LanguageModel {
		throw new Error("Claude subscription runs through the Agent SDK; use runText().");
	}

	async listModels(): Promise<string[]> {
		const token = readToken();
		if (!token) return STATIC_MODELS["claude-subscription"] ?? [];
		try {
			const res = await fetch("https://api.anthropic.com/v1/models?limit=100", {
				headers: { authorization: `Bearer ${token}`, "anthropic-version": "2023-06-01", "anthropic-beta": "oauth-2025-04-20" },
				signal: AbortSignal.timeout(10_000),
			});
			if (!res.ok) throw new Error(`GET /v1/models -> HTTP ${res.status}`);
			const json = (await res.json()) as { data?: Array<{ id: string }> };
			const ids = dedupeModels((json.data ?? []).map((m) => m.id)).sort();
			if (ids.length) return ids;
		} catch (err) {
			writeLog("provider-errors", "warn", "claude-subscription listModels failed", err);
		}
		return STATIC_MODELS["claude-subscription"] ?? [];
	}

	async testConnection(modelId?: string): Promise<TestConnectionResult> {
		if (!isLoggedIn()) return { success: false, error: "Not logged into Claude Code. Run `claude` in a terminal to log in." };
		try {
			await this.runText({
				modelId: modelId || this.config.defaultModel || getDefaultModel("claude-subscription"),
				system: "You are a connection test.",
				messages: [{ role: "user", content: "Reply with exactly: OK" }],
				abortSignal: AbortSignal.timeout(60_000),
			});
			return { success: true };
		} catch (err) {
			return { success: false, error: (err as Error).message };
		}
	}

	async runText(opts: TextRunOpts): Promise<TextRunResult> {
		const ac = new AbortController();
		const onAbort = () => ac.abort();
		opts.abortSignal?.addEventListener("abort", onAbort);
		try {
			for await (const m of query({
				prompt: buildPrompt(opts.messages),
				options: {
					model: opts.modelId,
					systemPrompt: opts.system,
					tools: [], // no built-in Claude Code tools (Bash, Edit, Read...)
					maxTurns: 1,
					settingSources: [],
					strictMcpConfig: true,
					persistSession: false,
					pathToClaudeCodeExecutable: resolveClaudeCliPath(),
					abortController: ac,
				},
			})) {
				if (m.type !== "result") continue;
				const usage = toUsage(m.usage as ResultUsage);
				if (m.subtype === "success" && !m.is_error) return { text: m.result, usage, costUsd: m.total_cost_usd ?? 0 };
				const errors = "errors" in m && Array.isArray(m.errors) ? m.errors.join("; ") : "";
				throw Object.assign(new Error(errors || `Claude Code returned an error (${m.subtype}).`), { usage });
			}
			throw new Error("No response from Claude Code.");
		} catch (err) {
			if (ac.signal.aborted) throw Object.assign(new Error("Cancelled"), { name: "AbortError" });
			throw Object.assign(new Error(friendlyError((err as Error).message ?? String(err))), { usage: (err as { usage?: CallUsage }).usage });
		} finally {
			opts.abortSignal?.removeEventListener("abort", onAbort);
		}
	}
}
