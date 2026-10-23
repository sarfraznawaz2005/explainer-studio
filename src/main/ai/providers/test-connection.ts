import { generateText, type LanguageModel } from "ai";
import { describeProviderError, isTransient } from "./errors";
import type { TestConnectionResult } from "./types";

/** Builds the failure result with a transient flag so callers can tell "busy" from "broken". */
export function testConnectionFailure(err: unknown): TestConnectionResult {
	const f = describeProviderError(err);
	return { success: false, error: cleanMessage(f.message, f.body), transient: isTransient(f), retryAfterMs: f.retryAfterMs };
}

/** HTTP failure from a plain fetch probe. */
export function httpFailure(status: number, message: string): TestConnectionResult {
	return { success: false, error: message, transient: isTransient({ message, statusCode: status }) };
}

/** Pulls a readable message out of a JSON or HTML error body when the SDK message is vague. */
function cleanMessage(message: string, body?: string): string {
	if (!body) return message;
	try {
		const j = JSON.parse(body) as { error?: { message?: string } | string; message?: string };
		const inner = typeof j.error === "string" ? j.error : j.error?.message ?? j.message;
		if (inner) return inner;
	} catch {
		/* not JSON */
	}
	return message;
}

/**
 * Real 5-token generation. A model list alone does not prove the model serves requests.
 * 45 s: a first request through a local proxy (account rotation, cold start) or to a
 * thinking model can take 25 s or more, and then answers in a few seconds.
 */
export async function probeModel(model: LanguageModel, timeoutMs = 45_000): Promise<TestConnectionResult> {
	try {
		await generateText({ model, prompt: "Hi", maxOutputTokens: 5, maxRetries: 0, abortSignal: AbortSignal.timeout(timeoutMs) });
		return { success: true };
	} catch (err) {
		const f = testConnectionFailure(err);
		// "The operation was aborted due to timeout" says little; name the wait and the likely cause.
		if (/timeout|timed out|aborted/i.test(f.error ?? "")) return { ...f, error: `No answer within ${Math.round(timeoutMs / 1000)} seconds. The server may be slow or busy; try again.` };
		return f;
	}
}
