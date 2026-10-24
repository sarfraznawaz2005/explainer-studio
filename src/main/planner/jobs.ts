import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ModelSlot, ProviderKind } from "@shared/ipc/ai";
import { plannerEvents, type PlanDraft, type PlannerUpdate, type RegenerateTarget } from "@shared/ipc/planner";
import { VideoPlan } from "@shared/plan/schema";
import { Outline, PlanSettings, QualityReport, type Estimate, type PlanStep } from "@shared/planner";
import { Source } from "@shared/source";
import type { Draft } from "@shared/models";
import { ai, priceBook } from "../ai";
import { describeProviderError } from "../ai/providers/errors";
import { appFolders } from "../app/folders";
import { writeLog } from "../app/logger";
import { getMainWindow } from "../app/window";
import { repos } from "../db/repos";
import { redact } from "../security/redact";
import { plannerAiFrom } from "./ai";
import { outlineCalls, priceEstimate, scriptCalls, tokens, type SlotTarget } from "./estimate";
import { KnowledgeChunk } from "./knowledge";
import { generateOutline } from "./outline";
import { generatePlan, type ScriptProgress } from "./run";
import { aiSceneSchema, figureRefs, PlannerError, scriptSystem, type ChapterContext } from "./script";
import { findScene, mergeVoice, regenerateChapter, regenerateScene, replaceChapter, replaceScene, scenePrompt } from "./edit";
import { audienceFor } from "./audience";
import { jsonInstructions } from "../ai/structured";
import { findPictures, picturesCalls } from "../pictures/find";
import { pictureFitter } from "../pictures/library";
import { LookRecipe, lookSummary } from "@shared/plan/look";
import { avoidList, designLook, lookCalls, type LookBrief } from "./look";

/** Planner runs in the background, one per draft. Results are saved to the draft; progress goes to the window. */
const jobs = new Map<string, { abort: AbortController; draftId: string; last: PlannerUpdate }>();

function emit(u: PlannerUpdate) {
	const job = jobs.get(u.jobId);
	if (job) job.last = u;
	getMainWindow()?.webContents.send(plannerEvents.update, u);
}

const runningFor = (draftId: string) => [...jobs.values()].find((j) => j.draftId === draftId && j.last.state === "running") ?? null;

/** True while the planner writes this draft's outline or script. */
export const plannerBusy = (draftId: string) => runningFor(draftId) !== null;

function mustDraft(id: string): Draft {
	const d = repos.drafts.get(id);
	if (!d) throw new Error("This draft was not found. It may have been deleted.");
	return d;
}

const parsed = <T>(schema: { safeParse: (v: unknown) => { success: boolean; data?: T } }, v: unknown): T | null => {
	if (v === null || v === undefined) return null;
	const r = schema.safeParse(v);
	return r.success ? r.data! : null;
};

export function planDraft(id: string): PlanDraft {
	const d = mustDraft(id);
	return {
		id: d.id,
		title: d.title,
		level: d.level,
		stage: d.stage,
		settings: parsed(PlanSettings, d.settings),
		outline: parsed(Outline, d.outline),
		plan: parsed(VideoPlan, d.plan),
		report: parsed(QualityReport, d.report),
		running: runningFor(id)?.last ?? null,
		updatedAt: d.updatedAt,
	};
}

/* ---------- Knowledge map file (long sources) ---------- */

const mapFile = (draftId: string) => join(appFolders().drafts, draftId, "plan", "knowledge-map.json");

function readMap(draftId: string): KnowledgeChunk[] | null {
	const f = mapFile(draftId);
	if (!existsSync(f)) return null;
	try {
		return KnowledgeChunk.array().parse(JSON.parse(readFileSync(f, "utf8")));
	} catch {
		return null;
	}
}

async function writeMap(draftId: string, map: KnowledgeChunk[] | null) {
	if (!map) return;
	const f = mapFile(draftId);
	await mkdir(join(f, ".."), { recursive: true });
	await writeFile(`${f}.part`, JSON.stringify(map));
	await rename(`${f}.part`, f);
}

/* ---------- Estimate ---------- */

async function slotTarget(slot: ModelSlot): Promise<SlotTarget> {
	const d = ai().describeSlot(slot);
	const kind = d.kind as ProviderKind;
	return { provider: d.providerName, kind, model: d.modelId, price: await priceBook().price(kind, d.modelId).catch(() => null) };
}

export async function priced(step: PlanStep, calls: ReturnType<typeof outlineCalls>): Promise<Estimate> {
	const slots = [...new Set<ModelSlot>(["planner", ...calls.map((c) => c.slot)])];
	const targets = new Map(await Promise.all(slots.map(async (s) => [s, await slotTarget(s)] as const)));
	return priceEstimate(step, calls, (s) => targets.get(s)!);
}

function scriptContext(d: Draft, settings: PlanSettings, outline: Outline): ChapterContext {
	return { source: Source.parse(d.source), outline, settings, map: readMap(d.id) };
}

/** A vision model is set up (checks web photos, describes the user's own). */
export function visionReady(): boolean {
	try {
		ai().describeSlot("vision");
		return true;
	} catch {
		return false;
	}
}

/** The script step searches the web for photos first, once, when the settings ask for it. */
const searchesFirst = (source: Source, settings: PlanSettings) => settings.webPictures && !source.pictureSearch;

export async function estimateStep(req: { draftId: string; step: PlanStep; settings: PlanSettings; outline?: Outline }): Promise<Estimate> {
	const d = mustDraft(req.draftId);
	const source = Source.parse(d.source);
	if (req.step === "outline") return priced("outline", outlineCalls(source, req.settings));
	const outline = req.outline ?? parsed(Outline, d.outline);
	if (!outline) throw new Error("Make the outline first.");
	if (req.step === "pictures") return priced("pictures", picturesCalls(outline, req.settings, source, visionReady()));
	const pictures = searchesFirst(source, req.settings) ? picturesCalls(outline, req.settings, source, visionReady()) : [];
	const look = req.settings.style === "free" ? lookCalls(lookBrief(d, req.settings, outline)) : [];
	return priced("script", [...pictures, ...scriptCalls(scriptContext(d, req.settings, outline)), ...look]);
}

/* ---------- AI free-form look ---------- */

/** AI looks of the user's latest other videos, so a new look is not a copy of them. */
function recentLooks(exceptId: string): string[] {
	const out: string[] = [];
	for (const d of repos.drafts.list({ orderBy: "updatedAt", limit: 12 })) {
		if (d.id === exceptId) continue;
		const look = (d.plan as { meta?: { look?: unknown } } | null)?.meta?.look;
		const r = look ? LookRecipe.safeParse(look) : null;
		if (r?.success) out.push(lookSummary(r.data));
		if (out.length >= 3) break;
	}
	return out;
}

function lookBrief(d: Draft, settings: PlanSettings, outline: Outline | null, current?: LookRecipe, wish?: string): LookBrief {
	return {
		title: outline?.title ?? d.title,
		subject: outline?.subject || undefined,
		level: settings.level,
		tone: settings.tone,
		language: settings.language,
		vertical: settings.format === "vertical",
		avoid: avoidList(current, recentLooks(d.id)),
		wish,
	};
}

/** The draft's settings for a look: saved settings, else what the plan says. */
function lookSettings(d: Draft, plan: VideoPlan): PlanSettings {
	return parsed(PlanSettings, d.settings) ?? PlanSettings.parse({ level: plan.meta.level, language: plan.meta.language, format: plan.meta.height > plan.meta.width ? "vertical" : "landscape" });
}

export async function estimateLook(req: { draftId: string; wish?: string }): Promise<Estimate> {
	const d = mustDraft(req.draftId);
	const plan = parsed(VideoPlan, d.plan);
	if (!plan) throw new Error("This draft has no script yet.");
	return priced("look", lookCalls(lookBrief(d, lookSettings(d, plan), parsed(Outline, d.outline), plan.meta.look, req.wish)));
}

/**
 * Designs a new AI look for a draft and returns it. Nothing is saved here: the Studio
 * puts it into the plan as a normal edit, so it can be undone.
 */
export async function newLook(req: { draftId: string; wish?: string; confirmedCost: boolean }): Promise<LookRecipe> {
	const d = mustDraft(req.draftId);
	if (runningFor(d.id)) throw new Error("Wait for the AI to finish before changing the look.");
	const plan = parsed(VideoPlan, d.plan);
	if (!plan) throw new Error("This draft has no script yet.");
	const brief = lookBrief(d, lookSettings(d, plan), parsed(Outline, d.outline), plan.meta.look, req.wish);
	await checkCost(() => priced("look", lookCalls(brief)), req.confirmedCost);
	return designLook(plannerAiFrom(ai(), d.id), brief);
}

/** Finds the outline's photos and saves them to the draft. Returns the new Source. */
async function runPictures(draftId: string, outline: Outline, settings: PlanSettings, signal: AbortSignal, tell: (f: number, detail: string) => void): Promise<Source> {
	const d = mustDraft(draftId);
	const vision = visionReady();
	const r = await findPictures({
		draftDir: join(appFolders().drafts, draftId),
		source: Source.parse(d.source),
		outline,
		settings,
		ai: plannerAiFrom(ai(), draftId, signal),
		vision,
		deps: { signal, log: (m) => writeLog("pictures", "info", m), fit: pictureFitter(), format: settings.format },
		onProgress: (p) => tell(p.total ? p.done / p.total : 0, p.detail),
	});
	repos.drafts.update(draftId, { source: r.source });
	writeLog("pictures", "info", `draft ${draftId}: ${r.added} photos added (vision=${vision})${r.skipped.length ? `; none good for: ${r.skipped.join("; ")}` : ""}`);
	return r.source;
}

export async function startPictures(req: { draftId: string; settings: PlanSettings; confirmedCost: boolean }): Promise<string> {
	const d = mustDraft(req.draftId);
	const outline = parsed(Outline, d.outline);
	if (!outline) throw new Error("Make the outline first.");
	await checkCost(() => estimateStep({ draftId: d.id, step: "pictures", settings: req.settings }), req.confirmedCost);
	return start(d.id, "pictures", async (signal, tell) => {
		await runPictures(d.id, outline, req.settings, signal, (f, detail) => tell(f * 0.98, detail));
	});
}

/* ---------- Runs ---------- */

function failMessage(err: unknown): string {
	if (err instanceof PlannerError) return err.message;
	const m = describeProviderError(err).message || String(err);
	return redact(m);
}

function start(draftId: string, step: PlanStep, run: (signal: AbortSignal, tell: (progress: number, detail: string, chapters?: PlannerUpdate["chapters"]) => void) => Promise<void>): string {
	if (runningFor(draftId)) throw new Error("This draft is already being planned. Wait for it to finish or stop it.");
	const jobId = randomUUID();
	const abort = new AbortController();
	const first: PlannerUpdate = { jobId, draftId, step, state: "running", progress: 0, detail: "Starting" };
	jobs.set(jobId, { abort, draftId, last: first });
	emit(first);
	const tell = (progress: number, detail: string, chapters?: PlannerUpdate["chapters"]) => emit({ jobId, draftId, step, state: "running", progress: Math.min(1, Math.max(0, progress)), detail, chapters });
	const t0 = Date.now();
	void (async () => {
		try {
			await run(abort.signal, tell);
			writeLog("planner", "info", `${step} for draft ${draftId} done in ${Math.round((Date.now() - t0) / 1000)} s`);
			emit({ ...jobs.get(jobId)!.last, state: "done", progress: 1, detail: "Done" });
		} catch (err) {
			const last = jobs.get(jobId)!.last;
			if (abort.signal.aborted) {
				writeLog("planner", "info", `${step} for draft ${draftId} cancelled`);
				emit({ ...last, state: "cancelled", detail: "Stopped" });
			} else {
				writeLog("planner", "error", `${step} for draft ${draftId} failed`, err);
				emit({ ...last, state: "error", error: failMessage(err) });
			}
		} finally {
			// Keep the last state briefly so a window reload can still read it, then forget the job.
			setTimeout(() => jobs.delete(jobId), 60_000).unref?.();
		}
	})();
	return jobId;
}

/** Paid runs start only after the user confirmed the estimate in the wizard. */
async function checkCost(est: () => Promise<Estimate>, confirmed: boolean) {
	if (confirmed) return;
	if ((await est()).needsConfirm) throw new Error("This run may cost money. Confirm the estimate first.");
}

export async function startOutline(req: { draftId: string; settings: PlanSettings; confirmedCost: boolean }): Promise<string> {
	const d = mustDraft(req.draftId);
	const source = Source.parse(d.source);
	if (!source.stats.words) throw new Error("This draft has no text to plan from.");
	await checkCost(() => estimateStep({ draftId: d.id, step: "outline", settings: req.settings }), req.confirmedCost);
	repos.drafts.update(d.id, { settings: req.settings, level: req.settings.level });
	return start(d.id, "outline", async (signal, tell) => {
		const planAi = plannerAiFrom(ai(), d.id, signal);
		const { outline, map } = await generateOutline(source, req.settings, planAi, (p) => {
			if (p.step === "map") tell((p.done / Math.max(1, p.total)) * 0.6, `Summarising long material: part ${Math.min(p.done + 1, p.total)} of ${p.total}`);
			else tell(p.done ? 1 : source.stats.chars > 60_000 ? 0.6 : 0.05, p.done ? "Outline ready" : "Writing the outline");
		});
		await writeMap(d.id, map);
		repos.drafts.update(d.id, { outline, stage: "outline", title: outline.title, plan: null, report: null });
	});
}

export function saveOutline(draftId: string, outline: Outline): void {
	mustDraft(draftId);
	if (runningFor(draftId)) throw new Error("Wait for the planner to finish before editing.");
	repos.drafts.update(draftId, { outline, title: outline.title });
}

const WEIGHT: Record<ScriptProgress["chapters"][number], number> = { waiting: 0, writing: 0.1, checking: 0.6, fixing: 0.8, done: 1 };

export async function startScript(req: { draftId: string; settings: PlanSettings; confirmedCost: boolean }): Promise<string> {
	const d = mustDraft(req.draftId);
	const settings = req.settings;
	const outline = parsed(Outline, d.outline);
	if (!outline) throw new Error("Make the outline first.");
	if (!outline.approved) throw new Error("Approve the outline first.");
	let ctx = scriptContext(d, settings, outline);
	await checkCost(() => estimateStep({ draftId: d.id, step: "script", settings, outline }), req.confirmedCost);
	repos.drafts.update(d.id, { settings, level: settings.level });
	return start(d.id, "script", async (signal, tell) => {
		const planAi = plannerAiFrom(ai(), d.id, signal);
		// Photos first, so the script can show them. A failed search never stops the script.
		const first = searchesFirst(Source.parse(d.source), settings) ? 0.15 : 0;
		if (first) {
			try {
				const source = await runPictures(d.id, outline, settings, signal, (f, detail) => tell(f * first, `Pictures: ${detail}`));
				ctx = { ...ctx, source };
			} catch (err) {
				if (signal.aborted) throw err;
				writeLog("pictures", "warn", `draft ${d.id}: picture search failed, writing the script without it`, err);
			}
		}
		const { plan, report } = await generatePlan(ctx, planAi, {
			signal,
			onProgress: (p) => {
				const working = p.chapters.map((c, i) => (c !== "waiting" && c !== "done" ? i + 1 : 0)).filter(Boolean);
				const progress = p.chapters.reduce((n, c) => n + WEIGHT[c], 0) / Math.max(1, p.total);
				tell(first + progress * (0.97 - first), working.length ? `Writing chapter ${working.join(" and ")} of ${p.total}` : `${p.done} of ${p.total} chapters done`, p.chapters);
			},
		});
		let final = plan;
		if (settings.style === "free") {
			tell(0.97, "Designing the look");
			try {
				const look = await designLook(planAi, lookBrief(d, settings, outline));
				final = { ...plan, meta: { ...plan.meta, look } };
			} catch (err) {
				if (signal.aborted) throw err;
				// The video still works: "free" without a recipe uses the default AI look.
				writeLog("planner", "warn", `draft ${d.id}: look design failed, using the default look`, err);
			}
		}
		tell(0.99, "Saving the plan");
		repos.drafts.update(d.id, { plan: final, report, stage: "preview" });
	});
}

/** Edits one sentence. The voice clip and measured length go: the timing falls back to an estimate until it is voiced again. */
export function saveSentence(draftId: string, sentenceId: string, text: string): void {
	const d = mustDraft(draftId);
	if (runningFor(draftId)) throw new Error("Wait for the planner to finish before editing.");
	const plan = parsed(VideoPlan, d.plan);
	if (!plan) throw new Error("This draft has no script yet.");
	let found = false;
	const next: VideoPlan = {
		...plan,
		chapters: plan.chapters.map((ch) => ({
			...ch,
			scenes: ch.scenes.map((sc) => ({
				...sc,
				narration: sc.narration.map((n) => {
					if (n.id !== sentenceId) return n;
					found = true;
					return n.text === text ? n : { id: n.id, text };
				}),
			})),
		})),
	};
	if (!found) throw new Error("This sentence was not found. The script may have been written again.");
	repos.drafts.update(draftId, { plan: VideoPlan.parse(next) });
}

/* ---------- Studio edits ---------- */

/** Saves a Studio edit of the whole plan. Voice clips stay only for sentences whose words did not change. */
export function savePlan(draftId: string, plan: VideoPlan): VideoPlan {
	const d = mustDraft(draftId);
	if (runningFor(draftId)) throw new Error("Wait for the AI to finish before editing.");
	const stored = parsed(VideoPlan, d.plan);
	if (!stored) throw new Error("This draft has no script yet.");
	const next = VideoPlan.parse(mergeVoice(stored, plan));
	repos.drafts.update(draftId, { plan: next, title: next.meta.title });
	return next;
}

function regenerateCalls(ctx: ChapterContext, plan: VideoPlan, target: RegenerateTarget) {
	if (target.kind === "chapter") {
		const oi = ctx.outline.chapters.findIndex((c) => c.id === target.chapterId);
		if (oi < 0) throw new Error("This chapter is not in the outline any more.");
		return scriptCalls({ ...ctx, outline: { ...ctx.outline, chapters: [ctx.outline.chapters[oi]!] } });
	}
	if (!findScene(plan, target.sceneId)) throw new Error("This scene is no longer in the script.");
	const a = audienceFor(ctx.settings.level);
	const sys = scriptSystem(ctx.settings, figureRefs(ctx.source)).length + jsonInstructions(aiSceneSchema(a, figureRefs(ctx.source), target.type)).length;
	return [{ slot: "planner" as const, input: tokens(sys + scenePrompt(ctx, plan, target.sceneId, { type: target.type }).length), output: 1500 }];
}

function editContext(d: Draft, instructions?: string): { ctx: ChapterContext; plan: VideoPlan } {
	const settings = parsed(PlanSettings, d.settings);
	const outline = parsed(Outline, d.outline);
	const plan = parsed(VideoPlan, d.plan);
	if (!settings || !outline || !plan) throw new Error("This draft has no script yet.");
	return { ctx: { ...scriptContext(d, settings, outline), instructions }, plan };
}

export async function estimateRegenerate(req: { draftId: string; target: RegenerateTarget }): Promise<Estimate> {
	const { ctx, plan } = editContext(mustDraft(req.draftId));
	return priced(req.target.kind, regenerateCalls(ctx, plan, req.target));
}

/**
 * Rewrites one scene or one chapter in the background. When it finishes, the new
 * part goes into the plan as it is then (the Studio cannot edit while it runs),
 * so nothing else in the plan changes.
 */
export async function startRegenerate(req: { draftId: string; target: RegenerateTarget; instructions?: string; confirmedCost: boolean }): Promise<string> {
	const d = mustDraft(req.draftId);
	const { ctx, plan } = editContext(d, req.instructions);
	const target = req.target;
	await checkCost(() => priced(target.kind, regenerateCalls(ctx, plan, target)), req.confirmedCost);
	return start(d.id, target.kind, async (signal, tell) => {
		const planAi = plannerAiFrom(ai(), d.id, signal);
		let next: VideoPlan;
		if (target.kind === "scene") {
			tell(0.1, "Writing the new scene");
			next = await regenerateScene(ctx, plan, target.sceneId, planAi, { type: target.type, instructions: req.instructions });
		} else {
			tell(0.05, "Writing the chapter again");
			const STEP_P: Record<string, number> = { writing: 0.1, checking: 0.6, fixing: 0.8, done: 0.97 };
			next = await regenerateChapter(ctx, plan, target.chapterId, planAi, (s) => tell(STEP_P[s] ?? 0.5, s === "checking" ? "Checking facts and level" : s === "fixing" ? "Fixing flagged sentences" : "Writing the chapter again"), signal);
		}
		signal.throwIfAborted();
		// Merge into the plan as stored now, keeping the voice of every untouched sentence.
		const now = parsed(VideoPlan, mustDraft(d.id).plan) ?? plan;
		const merged =
			target.kind === "scene"
				? replaceScene(now, target.sceneId, findScene(next, target.sceneId)!.scene)
				: replaceChapter(now, target.chapterId, next.chapters.find((c) => c.id === target.chapterId)!.scenes.filter((s) => s.id !== "hook"));
		repos.drafts.update(d.id, { plan: mergeVoice(now, merged) });
	});
}

export function cancelPlanner(jobId: string): void {
	jobs.get(jobId)?.abort.abort(new Error("Cancelled by the user"));
}

export function cancelAllPlanner(): void {
	for (const j of jobs.values()) j.abort.abort(new Error("The app is closing"));
}
