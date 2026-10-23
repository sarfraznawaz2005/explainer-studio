import type { z } from "zod";
import type { ModelSlot } from "@shared/ipc/ai";
import type { AiService } from "../ai/service";
import { generateStructured, type StructuredRequest, type TurnRunner } from "../ai/structured";

/** What the planner needs from the AI layer: one zod-valid value per call (with repair rounds). */
export type PlannerAi = {
	structured<S extends z.ZodType>(req: StructuredRequest<S>, call: { slot: ModelSlot; purpose: string; maxOutputTokens?: number }): Promise<z.output<S>>;
};

/** The app's AI service, tied to one draft and one cancel signal. */
export function plannerAiFrom(service: AiService, draftId: string, signal?: AbortSignal): PlannerAi {
	return {
		async structured(req, call) {
			const r = await service.generateStructured(req, { slot: call.slot, purpose: call.purpose, draftId, abortSignal: signal, maxOutputTokens: call.maxOutputTokens });
			return r.value;
		},
	};
}

/** A planner AI over a plain turn runner (tests and the real-model test suite). */
export function plannerAiFromRunner(run: (slot: ModelSlot, purpose: string) => TurnRunner): PlannerAi {
	return {
		async structured(req, call) {
			return (await generateStructured(run(call.slot, call.purpose), req)).value;
		},
	};
}
