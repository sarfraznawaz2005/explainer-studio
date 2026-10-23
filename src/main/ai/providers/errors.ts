import { APICallError, RetryError, wrapLanguageModel, type LanguageModel } from "ai";
import type { LanguageModelV4 } from "@ai-sdk/provider";
import { writeLog } from "../../app/logger";

export interface ProviderErrorFacts {
	message: string;
	statusCode?: number;
	isRetryable?: boolean;
	retryAfterMs?: number;
	body?: string;
}

function retryAfter(headers?: Record<string, string>): number | undefined {
	if (!headers) return undefined;
	const v = headers["retry-after"] ?? headers["Retry-After"];
	if (!v) return undefined;
	const secs = Number(v);
	if (Number.isFinite(secs)) return secs * 1000;
	const at = Date.parse(v);
	return Number.isFinite(at) ? Math.max(0, at - Date.now()) : undefined;
}

/** Digs the real cause out of RetryError wrappers and APICallError. */
export function describeProviderError(err: unknown): ProviderErrorFacts {
	let e: unknown = err;
	if (RetryError.isInstance(e)) e = e.lastError ?? e;
	if (APICallError.isInstance(e)) {
		return {
			message: e.message,
			statusCode: e.statusCode,
			isRetryable: e.isRetryable,
			retryAfterMs: retryAfter(e.responseHeaders),
			body: e.responseBody?.slice(0, 500),
		};
	}
	const anyErr = e as { message?: string; statusCode?: number; status?: number; code?: string };
	return {
		message: anyErr?.message ?? String(e),
		statusCode: anyErr?.statusCode ?? anyErr?.status,
		isRetryable: anyErr?.code ? ["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN"].includes(anyErr.code) : undefined,
	};
}

/** 429, 5xx (except 501) and status-less network failures are transient. */
export function isTransient(f: ProviderErrorFacts): boolean {
	if (f.statusCode !== undefined) {
		if (f.statusCode === 429 || f.statusCode === 408) return true;
		if (f.statusCode >= 500 && f.statusCode !== 501) return true;
		return false;
	}
	if (f.isRetryable) return true;
	return /timeout|timed out|ECONNRESET|ETIMEDOUT|fetch failed|network|socket/i.test(f.message);
}

export interface ErrorLogContext {
	kind: string;
	providerName: string;
	modelId?: string;
	phase: string;
}

export function logProviderError(err: unknown, ctx: ErrorLogContext): void {
	const f = describeProviderError(err);
	const extra = [f.statusCode ? `HTTP ${f.statusCode}` : "", f.body ? `body: ${f.body}` : ""].filter(Boolean).join(" | ");
	writeLog("provider-errors", "error", `${ctx.kind}/${ctx.providerName} ${ctx.modelId ?? ""} ${ctx.phase}: ${f.message}${extra ? ` | ${extra}` : ""}`);
}

/** Wraps a model so every generate/stream failure lands in provider-errors.log. Errors are rethrown. */
export function withErrorLogging(model: LanguageModel, ctx: ErrorLogContext): LanguageModel {
	if (typeof model === "string") return model;
	return wrapLanguageModel({
		model: model as LanguageModelV4,
		middleware: {
			specificationVersion: "v4",
			wrapGenerate: async ({ doGenerate }) => {
				try {
					return await doGenerate();
				} catch (err) {
					logProviderError(err, { ...ctx, phase: "generate" });
					throw err;
				}
			},
			wrapStream: async ({ doStream }) => {
				try {
					return await doStream();
				} catch (err) {
					logProviderError(err, { ...ctx, phase: "stream" });
					throw err;
				}
			},
		},
	});
}
