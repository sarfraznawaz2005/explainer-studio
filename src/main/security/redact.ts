/**
 * Masks secrets in text before it reaches a log file, an error message or the renderer.
 * Two layers: exact values the app knows are secret (registered when a key is
 * opened), and patterns for common key formats.
 */
const known = new Set<string>();
const MASK = "[REDACTED]";

/** Remember a secret value so it is masked wherever it appears later. */
export function registerSecret(value: string | null | undefined): void {
	if (value && value.length >= 8) known.add(value);
}

export function forgetSecret(value: string): void {
	known.delete(value);
}

const PATTERNS: [RegExp, string][] = [
	// Provider key formats: OpenAI/Anthropic/OpenRouter (sk-...), Google (AIza...), GitHub tokens.
	[/\bsk-[A-Za-z0-9_-]{16,}/g, MASK],
	[/\bAIza[0-9A-Za-z_-]{30,}/g, MASK],
	[/\bgh[pousr]_[A-Za-z0-9]{30,}/g, MASK],
	// Authorization headers.
	[/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{12,}/gi, `$1 ${MASK}`],
	// key=value and "key": "value" pairs.
	[/\b((?:api[_-]?key|x-api-key|access[_-]?token|refresh[_-]?token|token|secret|password|passwd|authorization)["']?\s*[:=]\s*["']?)([^\s"',;&]{6,})/gi, `$1${MASK}`],
	// Query string credentials.
	[/([?&](?:key|api_key|apikey|token|access_token|sig)=)[^&\s#]+/gi, `$1${MASK}`],
];

export function redact(text: string): string {
	let out = text;
	for (const s of known) out = out.split(s).join(MASK);
	for (const [re, rep] of PATTERNS) out = out.replace(re, rep);
	return out;
}

/** Error to safe text: message plus stack, both redacted. */
export function redactError(err: unknown): string {
	if (err instanceof Error) return redact(err.stack ?? `${err.name}: ${err.message}`);
	return redact(typeof err === "string" ? err : JSON.stringify(err));
}
