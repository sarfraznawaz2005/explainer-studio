import type { z } from "zod";
import type { ModelSlot } from "@shared/ipc/ai";
import { writeLog } from "../app/logger";
import { redact } from "../security/redact";
import type { PriceBook } from "./pricing";
import { priceCall } from "./pricing";
import { createProviderAdapter } from "./providers";
import { describeProviderError } from "./providers/errors";
import type { CallUsage, ImageInput, ProviderAdapter, ProviderConfig } from "./providers/types";
import { NO_USAGE, runText } from "./run";
import type { AiStore, Resolved } from "./store";
import { generateChecked, generateStructured, type CheckedRequest, type StructuredRequest, type StructuredResult, type TurnRunner } from "./structured";

/** Who is calling and why. `purpose` is a short tag for the usage log, e.g. "plan.outline". */
export type CallContext = {
	slot: ModelSlot;
	purpose: string;
	draftId?: string | null;
	abortSignal?: AbortSignal;
	maxOutputTokens?: number;
};

/**
 * The one entry point for AI calls in main. It resolves the slot, builds the
 * adapter, and writes one usage row per model call (repair rounds and failures
 * included) with tokens and cost.
 */
export function createAiService(deps: { store: AiStore; prices: PriceBook; buildAdapter?: (c: ProviderConfig) => ProviderAdapter }) {
	const build = deps.buildAdapter ?? createProviderAdapter;

	const target = async (slot: ModelSlot): Promise<Resolved & { adapter: ProviderAdapter }> => {
		const r = deps.store.resolveSlot(slot);
		return { ...r, adapter: build(await deps.store.toConfig(r.provider)) };
	};

	const runner = (t: Resolved & { adapter: ProviderAdapter }, ctx: CallContext): TurnRunner => {
		// Start loading prices while the model works; the first call of the day fetches them.
		const price = deps.prices.price(t.kind, t.modelId).catch(() => null);
		return async ({ system, messages, attempt }) => {
			const started = Date.now();
			const record = async (ok: boolean, usage: CallUsage, reportedUsd: number | undefined, error: string | null) => {
				const { billing, costUsd } = priceCall(t.kind, await price, usage, reportedUsd);
				try {
					deps.store.recordUsage({
						providerId: t.provider.id,
						providerKind: t.kind,
						providerName: t.provider.name,
						model: t.modelId,
						slot: ctx.slot,
						purpose: ctx.purpose,
						attempt,
						draftId: ctx.draftId ?? null,
						ok,
						error,
						...usage,
						costUsd,
						billing,
						durationMs: Date.now() - started,
					});
				} catch (err) {
					writeLog("ai", "error", "could not record usage", err);
				}
			};
			try {
				const r = await runText(t.adapter, { modelId: t.modelId, system, messages, maxOutputTokens: ctx.maxOutputTokens, abortSignal: ctx.abortSignal });
				await record(true, r.usage, r.costUsd, null);
				return r;
			} catch (err) {
				const usage = (err as { usage?: CallUsage }).usage ?? NO_USAGE;
				await record(false, usage, undefined, redact(describeProviderError(err).message));
				throw err;
			}
		};
	};

	return {
		/** Which provider and model a slot would use right now (throws when none is set up). */
		describeSlot(slot: ModelSlot): { providerName: string; kind: string; modelId: string } {
			const r = deps.store.resolveSlot(slot);
			return { providerName: r.provider.name, kind: r.kind, modelId: r.modelId };
		},

		/** A zod-valid object from the slot's model, with up to 2 repair rounds. */
		async generateStructured<S extends z.ZodType>(req: StructuredRequest<S>, ctx: CallContext): Promise<StructuredResult<z.output<S>>> {
			const t = await target(ctx.slot);
			return generateStructured(runner(t, ctx), req);
		},

		/** A reply checked by the caller (code, for example), with repair rounds. */
		async generateChecked<T>(req: CheckedRequest<T>, ctx: CallContext): Promise<StructuredResult<T>> {
			const t = await target(ctx.slot);
			return generateChecked(runner(t, ctx), req);
		},

		/** Plain text from the slot's model. */
		async generateText(req: { system: string; prompt: string; images?: ImageInput[] }, ctx: CallContext): Promise<string> {
			const t = await target(ctx.slot);
			const r = await runner(t, ctx)({ system: req.system, messages: [{ role: "user", content: req.prompt, images: req.images }], attempt: 1 });
			return r.text.trim();
		},
	};
}

export type AiService = ReturnType<typeof createAiService>;
