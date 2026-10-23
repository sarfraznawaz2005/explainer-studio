import { renderChannels } from "@shared/ipc/render";
import { notifyLibraryChanged, queueDraft, renderCheck, renderDefaults, renderQueue, setRenderDefaults, videoEntry } from "../render";
import { cancelRender, revealRender, startRender } from "../render/manager";
import { handle } from "./register";

const ok = { ok: true as const };

export function registerRenderIpc(): void {
	handle(renderChannels.startTest, () => ({
		jobId: startRender({
			entryPoint: videoEntry(),
			compositionId: "TestCard",
			inputProps: { title: "Explainer Studio", subtitle: "Render engine test" },
			fileStem: "test-render",
		}),
	}));
	handle(renderChannels.cancel, ({ jobId }) => {
		cancelRender(jobId);
		return ok;
	});
	handle(renderChannels.reveal, ({ jobId }) => {
		revealRender(jobId);
		return ok;
	});

	handle(renderChannels.check, ({ draftId }) => renderCheck(draftId));
	handle(renderChannels.queue, async ({ draftId, settings, remember }) => {
		const jobId = await queueDraft(draftId, settings, remember);
		notifyLibraryChanged();
		return { jobId };
	});
	handle(renderChannels.jobs, () => renderQueue.list());
	handle(renderChannels.cancelJob, ({ jobId }) => {
		renderQueue.cancel(jobId);
		return ok;
	});
	handle(renderChannels.retryJob, ({ jobId }) => {
		renderQueue.retry(jobId);
		return ok;
	});
	handle(renderChannels.clearJob, async ({ jobId }) => {
		await renderQueue.clear(jobId);
		return ok;
	});
	handle(renderChannels.getDefaults, () => renderDefaults());
	handle(renderChannels.setDefaults, (s) => setRenderDefaults(s));
}
