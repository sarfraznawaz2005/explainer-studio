import { plannerChannels as ch } from "@shared/ipc/planner";
import { cancelPlanner, estimateCode, estimateLook, startCode, estimateRegenerate, estimateStep, newLook, planDraft, saveOutline, savePlan, saveSentence, startOutline, startRegenerate, startScript } from "../planner/jobs";
import { estimateTopic, startTopic } from "../ingest/jobs";
import { handle } from "./register";

export function registerPlannerIpc(): void {
	handle(ch.get, ({ draftId }) => planDraft(draftId));
	handle(ch.estimate, (req) => estimateStep(req));
	handle(ch.outline, async (req) => ({ jobId: await startOutline(req) }));
	handle(ch.saveOutline, ({ draftId, outline }) => {
		saveOutline(draftId, outline);
		return { ok: true as const };
	});
	handle(ch.script, async (req) => ({ jobId: await startScript(req) }));
	handle(ch.cancel, ({ jobId }) => {
		cancelPlanner(jobId);
		return { ok: true as const };
	});
	handle(ch.savePlan, ({ draftId, plan }) => ({ plan: savePlan(draftId, plan) }));
	handle(ch.regenerateEstimate, (req) => estimateRegenerate(req));
	handle(ch.regenerate, async (req) => ({ jobId: await startRegenerate(req) }));
	handle(ch.lookEstimate, (req) => estimateLook(req));
	handle(ch.newLook, async (req) => ({ look: await newLook(req) }));
	handle(ch.codeEstimate, (req) => estimateCode(req));
	handle(ch.newCode, async (req) => ({ jobId: await startCode(req) }));
	handle(ch.topicEstimate, (req) => estimateTopic(req));
	handle(ch.topicStart, async (req) => ({ jobId: await startTopic(req) }));
	handle(ch.saveSentence, ({ draftId, sentenceId, text }) => {
		saveSentence(draftId, sentenceId, text);
		return { ok: true as const };
	});
}
