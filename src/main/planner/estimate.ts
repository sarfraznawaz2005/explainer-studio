import type { ModelSlot, ProviderKind } from "@shared/ipc/ai";
import type { Estimate, PlanSettings, PlanStep } from "@shared/planner";
import type { Source } from "@shared/source";
import { costOf, type Price } from "../ai/pricing";
import { jsonInstructions } from "../ai/structured";
import { audienceFor } from "./audience";
import { FACT_SYSTEM, FactCheckResult } from "./checks";
import { chunkSections, KnowledgeChunk, MAP_SYSTEM, needsMap } from "./knowledge";
import { AiOutline, outlinePrompt, outlineSystem } from "./outline";
import { chapterScriptSchema, chapterSource, chapterWords, scriptPrompt, scriptSystem, type ChapterContext } from "./script";

/**
 * Cost and time before a run (PLAN.md section 5). Input tokens come from the
 * real prompts the run will send; output tokens from the narration length the
 * outline asks for. The high end adds repair rounds and a revise call per chapter.
 */

export const CHARS_PER_TOKEN = 3.8;
export const tokens = (chars: number) => Math.ceil(chars / CHARS_PER_TOKEN);
/** Narration words → output tokens: JSON, props and on-screen text roughly double the spoken words. */
const OUT_PER_WORD = 1.35 * 2;
export const CONCURRENCY = 2;

export type EstimateCall = { slot: ModelSlot; input: number; output: number; extra?: boolean };
export type SlotTarget = { provider: string; kind: ProviderKind; model: string; price: Price | null };

export function outlineCalls(source: Source, s: PlanSettings): EstimateCall[] {
	const calls: EstimateCall[] = [];
	let mapTokens = 0;
	if (needsMap(source)) {
		const sys = MAP_SYSTEM.length + jsonInstructions(KnowledgeChunk).length;
		for (const chunk of chunkSections(source)) {
			calls.push({ slot: "cheap", input: tokens(sys + chunk.length + 80), output: 1500 });
			mapTokens += 1500;
		}
	}
	const prompt = needsMap(source) ? outlinePrompt({ ...source, sections: [] }, s, null).length + mapTokens * CHARS_PER_TOKEN : outlinePrompt(source, s, null).length;
	calls.push({ slot: "planner", input: tokens(outlineSystem(s).length + jsonInstructions(AiOutline).length + prompt), output: 2500 });
	return calls;
}

export function scriptCalls(ctx: ChapterContext): EstimateCall[] {
	const a = audienceFor(ctx.settings.level);
	const sys = scriptSystem(ctx.settings).length + jsonInstructions(chapterScriptSchema(a)).length;
	const factSys = FACT_SYSTEM.length + jsonInstructions(FactCheckResult).length;
	return ctx.outline.chapters.flatMap((_, i) => {
		const words = chapterWords(ctx, i);
		const src = chapterSource(ctx, i).length;
		return [
			{ slot: "planner" as const, input: tokens(sys + scriptPrompt(ctx, i).length), output: Math.round(words * OUT_PER_WORD + 300) },
			{ slot: "planner" as const, input: tokens(factSys + src) + Math.round(words * 1.6), output: 400 },
			{ slot: "planner" as const, input: tokens(src) + 900, output: 600, extra: true },
		];
	});
}

export function billingOf(t: SlotTarget): Estimate["billing"] {
	if (t.kind === "ollama") return "free";
	if (t.kind === "claude-subscription") return "subscription";
	if (!t.price) return "unknown";
	return t.price.input === 0 && t.price.output === 0 ? "free" : "api";
}

const usage = (input: number, output: number) => ({ inputTokens: input, outputTokens: output, cacheReadTokens: 0, cacheWriteTokens: 0 });

export function priceEstimate(step: PlanStep, calls: EstimateCall[], target: (slot: ModelSlot) => SlotTarget): Estimate {
	const base = calls.filter((c) => !c.extra);
	const sum = (cs: EstimateCall[], k: "input" | "output") => cs.reduce((n, c) => n + c[k], 0);
	const planner = target("planner");
	const billings = [...new Set(calls.map((c) => c.slot))].map((sl) => billingOf(target(sl)));
	const billing: Estimate["billing"] = billings.includes("api") ? "api" : billings.includes("unknown") ? "unknown" : billings.includes("subscription") ? "subscription" : "free";

	// Cost per slot: low = one try per call; high = every call once more for repairs (+25%) plus the revise calls.
	let low = 0;
	let high = 0;
	let known = true;
	for (const c of calls) {
		const t = target(c.slot);
		const b = billingOf(t);
		if (b === "free") continue;
		if (!t.price) {
			known = false;
			continue;
		}
		const usd = costOf(usage(c.input, c.output), t.price);
		if (!c.extra) low += usd;
		high += c.extra ? usd : usd * 1.25;
	}
	const overhead = planner.kind === "claude-subscription" ? 8 : 4;
	const callSeconds = (cs: EstimateCall[]) => cs.reduce((n, c) => n + overhead + c.output / 55, 0);
	const parallel = step === "script" || step === "research" ? CONCURRENCY : 1;
	return {
		step,
		calls: base.length,
		inputTokens: sum(base, "input"),
		outputTokens: sum(base, "output"),
		provider: planner.provider,
		model: planner.model,
		billing,
		costUsd: billing === "free" ? { low: 0, high: 0 } : known ? { low, high: Math.max(high, low) } : null,
		seconds: { low: Math.round(callSeconds(base) / parallel), high: Math.round((callSeconds(calls) * 1.3) / parallel) },
		needsConfirm: billing === "api" || billing === "unknown",
	};
}

