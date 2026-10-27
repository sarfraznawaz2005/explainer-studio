import { z } from "zod";

/**
 * Messages between the app window and the sandbox page that runs AI video code
 * (es-preview://app/code-preview.html). Both sides check what they get: the
 * sandbox runs untrusted code, so its messages are data, never commands.
 */

/** The sandbox page: its own scheme and origin (served by src/main/app/preview-protocol.ts). */
export const PREVIEW_SCHEME = "es-preview";
export const PREVIEW_ORIGIN = `${PREVIEW_SCHEME}://app`;
export const PREVIEW_PAGE = "/code-preview.html";

/** A part of an AI design, named by the code's data-id attribute ("s3-title"). */
export const PartId = z.string().regex(/^[A-Za-z][\w.:-]{0,59}$/);

/** Sandbox → app. */
export const FromPreview = z.discriminatedUnion("type", [
	z.object({ type: z.literal("ready") }),
	z.object({ type: z.enum(["frame", "seeked"]), frame: z.number().int().min(0).max(10_000_000) }),
	z.object({ type: z.enum(["play", "pause", "ended"]) }),
	z.object({ type: z.literal("code-error"), message: z.string().max(2000), scene: z.number().int().min(-1).max(10_000) }),
	/** Pick mode: the user clicked a part of the picture that has a data-id. */
	z.object({ type: z.literal("picked"), id: PartId, text: z.string().max(200) }),
]);
export type FromPreview = z.infer<typeof FromPreview>;

/** App → sandbox. Props are PlanVideoProps (checked again there by the plan schema). */
export type ToPreview = { type: "props"; props: Record<string, unknown>; initialFrame?: number } | { type: "seek"; frame: number } | { type: "toggle" } | { type: "pick"; on: boolean };

/** One problem the test draw found. scene -1 = the whole file. */
export const CheckIssue = z.object({ frame: z.number().int(), scene: z.number().int(), message: z.string().max(2000) });
export type CheckIssue = z.infer<typeof CheckIssue>;

/** What the test draw returns: errors must be fixed; warnings are sent to the AI but do not block. */
export const CheckResult = z.object({ errors: z.array(CheckIssue).max(200), warnings: z.array(CheckIssue).max(200), frames: z.number().int() });
export type CheckResult = z.infer<typeof CheckResult>;

/** Frames the test draw looks at: just after each scene starts, after its last sentence starts, and near its end. */
export function checkFrames(scenes: { from: number; durationInFrames: number; sentences: { from: number }[] }[]): { frame: number; scene: number; settled: boolean }[] {
	const out: { frame: number; scene: number; settled: boolean }[] = [];
	scenes.forEach((s, scene) => {
		const last = s.from + s.durationInFrames - 1;
		const lastSentence = s.sentences.at(-1)?.from ?? 0;
		const picks = [
			{ frame: s.from + Math.min(3, s.durationInFrames - 1), settled: false },
			{ frame: Math.min(last, s.from + lastSentence + 20), settled: true },
			{ frame: Math.max(s.from, last - 2), settled: true },
		];
		for (const p of picks) if (!out.some((o) => o.frame === p.frame)) out.push({ ...p, scene });
	});
	return out;
}
