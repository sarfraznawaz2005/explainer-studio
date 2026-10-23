import { z } from "zod";
import { defineChannel, NoInput, Ok } from "./channels";

export const PROVIDER_KINDS = [
	"opencode",
	"anthropic",
	"claude-subscription",
	"openrouter",
	"openai",
	"google",
	"groq",
	"deepseek",
	"xai",
	"ollama",
	"zai",
	"custom",
] as const;
export const ProviderKind = z.enum(PROVIDER_KINDS);
export type ProviderKind = z.infer<typeof ProviderKind>;

export type ProviderMeta = {
	label: string;
	/** One line under the label in the picker. */
	blurb: string;
	needsKey: boolean;
	needsBaseUrl: boolean;
	/** Shown in the form. Warnings and limits the user should know before relying on it. */
	note?: string;
	/** Where to get a key. Opened through the link allowlist. */
	keyUrl?: string;
	/** Cost hint for the picker. */
	price: "free" | "paid" | "subscription" | "local";
};

/** Labels and which fields each provider kind needs in the form. */
export const PROVIDER_META: Record<ProviderKind, ProviderMeta> = {
	opencode: {
		label: "OpenCode Zen (free)",
		blurb: "Free models, no key needed",
		needsKey: false,
		needsBaseUrl: false,
		price: "free",
		note: "Free and rate limited. The free tier uses an unofficial gate that can stop working without notice. Add a paid OpenCode Zen key to avoid it.",
	},
	anthropic: { label: "Anthropic API", blurb: "Claude models with your API key", needsKey: true, needsBaseUrl: false, price: "paid", keyUrl: "https://console.anthropic.com/settings/keys" },
	"claude-subscription": {
		label: "Claude subscription",
		blurb: "Uses your Claude Code login",
		needsKey: false,
		needsBaseUrl: false,
		price: "subscription",
		note: "Runs your locally installed, logged-in Claude Code through the official Agent SDK. Personal use only.",
	},
	openrouter: {
		label: "OpenRouter",
		blurb: "Hundreds of models, one key",
		needsKey: true,
		needsBaseUrl: false,
		price: "paid",
		keyUrl: "https://openrouter.ai/keys",
		note: "A free key works with the model openrouter/free. It picks a free model per request, so answers vary and free models may log what you send.",
	},
	openai: { label: "OpenAI", blurb: "GPT models", needsKey: true, needsBaseUrl: false, price: "paid", keyUrl: "https://platform.openai.com/api-keys" },
	google: { label: "Google Gemini", blurb: "Gemini models, free tier available", needsKey: true, needsBaseUrl: false, price: "paid", keyUrl: "https://aistudio.google.com/apikey" },
	groq: { label: "Groq", blurb: "Very fast open models", needsKey: true, needsBaseUrl: false, price: "paid", keyUrl: "https://console.groq.com/keys" },
	deepseek: { label: "DeepSeek", blurb: "Low-cost strong models", needsKey: true, needsBaseUrl: false, price: "paid", keyUrl: "https://platform.deepseek.com/api_keys" },
	xai: { label: "xAI Grok", blurb: "Grok models", needsKey: true, needsBaseUrl: false, price: "paid", keyUrl: "https://console.x.ai" },
	ollama: { label: "Ollama", blurb: "Models on this PC", needsKey: false, needsBaseUrl: true, price: "local", note: "Ollama must be running. Default address: http://localhost:11434/v1" },
	zai: { label: "Z.AI (GLM)", blurb: "GLM models", needsKey: true, needsBaseUrl: false, price: "paid", keyUrl: "https://z.ai/manage-apikey/apikey-list" },
	custom: { label: "Custom", blurb: "Any OpenAI-compatible server", needsKey: true, needsBaseUrl: true, price: "paid", note: "Use the API root, for example https://api.example.com/v1" },
};

export const MODEL_SLOTS = ["planner", "vision", "cheap"] as const;
export const ModelSlot = z.enum(MODEL_SLOTS);
export type ModelSlot = z.infer<typeof ModelSlot>;

export const SLOT_META: Record<ModelSlot, { label: string; description: string }> = {
	planner: { label: "Planner", description: "Writes the outline and script. Use your strongest model." },
	vision: { label: "Vision", description: "Reads scanned pages and pictures. The model must accept images." },
	cheap: { label: "Quick tasks", description: "Titles, tags and small fixes. A small or free model is fine." },
};

const Id = z.uuid();
/** Model ids: "claude-sonnet-5-5", "llama3.2:latest", "anthropic/claude-x", "models/gemini-x@001". */
export const ModelId = z.string().trim().min(1).max(200).regex(/^[\w.:/@+-]+$/, "Model id has characters that are not allowed");
const BaseUrl = z
	.string()
	.trim()
	.max(500)
	.refine((u) => u === "" || /^https?:\/\/[^\s]+$/i.test(u), "Use an http:// or https:// address");
const ApiKey = z.string().max(500);

/** A provider as the renderer sees it. The key never leaves main; only whether one is saved. */
export const ProviderView = z.object({
	id: z.string(),
	kind: ProviderKind,
	name: z.string(),
	baseUrl: z.string().nullable(),
	defaultModel: z.string().nullable(),
	hasKey: z.boolean(),
	enabled: z.boolean(),
	isDefault: z.boolean(),
	/** null = never tested. */
	testOk: z.boolean().nullable(),
	testError: z.string().nullable(),
	testedAt: z.string().nullable(),
});
export type ProviderView = z.infer<typeof ProviderView>;

export const TestResult = z.object({
	ok: z.boolean(),
	error: z.string().optional(),
	/** Rate limit, timeout or 5xx: says nothing about the key. */
	transient: z.boolean().optional(),
	model: z.string().optional(),
	ms: z.number().optional(),
});
export type TestResult = z.infer<typeof TestResult>;

/** Unsaved form values. With `id` and no `apiKey`, main uses the saved key. */
export const ProviderDraft = z.object({
	id: Id.optional(),
	kind: ProviderKind,
	apiKey: ApiKey.optional(),
	baseUrl: BaseUrl.nullable().optional(),
});
export type ProviderDraft = z.infer<typeof ProviderDraft>;

export const SlotValue = z.object({ providerId: z.string(), modelId: z.string() });
export type SlotValue = z.infer<typeof SlotValue>;
export const Slots = z.object({ planner: SlotValue.nullable(), vision: SlotValue.nullable(), cheap: SlotValue.nullable() });
export type Slots = z.infer<typeof Slots>;

export const Billing = z.enum(["api", "free", "subscription", "unknown"]);
export type Billing = z.infer<typeof Billing>;

export const UsageRow = z.object({
	id: z.string(),
	providerName: z.string(),
	providerKind: z.string(),
	model: z.string(),
	slot: z.string().nullable(),
	purpose: z.string(),
	attempt: z.number(),
	ok: z.boolean(),
	error: z.string().nullable(),
	inputTokens: z.number(),
	outputTokens: z.number(),
	cacheReadTokens: z.number(),
	cacheWriteTokens: z.number(),
	costUsd: z.number().nullable(),
	billing: Billing,
	durationMs: z.number(),
	createdAt: z.string(),
});
export type UsageRow = z.infer<typeof UsageRow>;

export const UsageSummary = z.object({
	days: z.number(),
	calls: z.number(),
	failed: z.number(),
	inputTokens: z.number(),
	outputTokens: z.number(),
	/** Sum of known API costs. Calls with an unknown price are counted in `unpriced`. */
	costUsd: z.number(),
	unpriced: z.number(),
});
export type UsageSummary = z.infer<typeof UsageSummary>;

export const aiChannels = {
	list: defineChannel("ai:providers:list", NoInput, z.array(ProviderView)),
	save: defineChannel(
		"ai:providers:save",
		z.object({
			id: Id.optional(),
			kind: ProviderKind,
			name: z.string().trim().min(1).max(80),
			/** Omit to keep the saved key. An empty string removes it. */
			apiKey: ApiKey.optional(),
			baseUrl: BaseUrl.nullable(),
			defaultModel: ModelId.nullable(),
		}),
		ProviderView,
	),
	remove: defineChannel("ai:providers:remove", z.object({ id: Id }), Ok),
	setEnabled: defineChannel("ai:providers:setEnabled", z.object({ id: Id, enabled: z.boolean() }), Ok),
	setDefault: defineChannel("ai:providers:setDefault", z.object({ id: Id }), Ok),
	test: defineChannel("ai:providers:test", z.object({ id: Id, modelId: ModelId.optional() }), TestResult),
	models: defineChannel("ai:providers:models", z.object({ id: Id, refresh: z.boolean().optional() }), z.array(z.string())),
	/** Models for unsaved form values. A typed key is used once and not stored. */
	draftModels: defineChannel("ai:providers:draftModels", ProviderDraft, z.array(z.string())),
	/** Tries one model with unsaved form values. Saves nothing. */
	draftTest: defineChannel("ai:providers:draftTest", ProviderDraft.extend({ modelId: ModelId.optional() }), TestResult),
	getSlots: defineChannel("ai:slots:get", NoInput, Slots),
	setSlot: defineChannel("ai:slots:set", z.object({ slot: ModelSlot, value: z.object({ providerId: Id, modelId: ModelId }).nullable() }), Ok),
	usageSummary: defineChannel("ai:usage:summary", z.object({ days: z.number().int().min(1).max(3650) }), UsageSummary),
	usageRecent: defineChannel("ai:usage:recent", z.object({ limit: z.number().int().min(1).max(500), failedOnly: z.boolean().optional() }), z.array(UsageRow)),
	claudeStatus: defineChannel("ai:claude:status", NoInput, z.object({ loggedIn: z.boolean(), cliFound: z.boolean() })),
};
