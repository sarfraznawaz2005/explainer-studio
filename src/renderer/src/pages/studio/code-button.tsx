import { Code2, Crosshair, SlidersHorizontal, Sparkles, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { plannerChannels } from "@shared/ipc/planner";
import { NO_TWEAKS, usesTweaks, type CodeTweaks } from "@shared/plan/code";
import type { VideoPlan } from "@shared/plan/schema";
import type { Estimate } from "@shared/planner";
import { Button } from "@renderer/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@renderer/components/ui/dialog";
import { Badge, Label, Textarea, Tooltip } from "@renderer/components/ui/primitives";
import { Select } from "@renderer/components/ui/select";
import { Slider } from "@renderer/components/ui/slider";
import { call, errorText } from "@renderer/lib/ipc";
import { costLine, usd } from "./edit-panel";

/** A code error the preview saw: where, and what. */
export type SeenError = { scene: number; message: string };

export const seenErrorText = (e: SeenError) => (e.scene >= 0 ? `Scene ${e.scene + 1}: ${e.message}` : e.message);

/**
 * "AI free-form" style: asks the AI for a new design, or for a change to the
 * current one. Runs as a background job; the Studio brings the result in as one
 * undo step.
 */
export function CodeDialog({ draftId, plan, open, onOpenChange, seenErrors, onStarted, part }: { draftId: string; plan: VideoPlan; open: boolean; onOpenChange: (o: boolean) => void; seenErrors: SeenError[]; onStarted: (label: string) => void; part?: DesignPart | null }) {
	const hasCode = !!plan.meta.code;
	const [mode, setMode] = useState<"change" | "new">(hasCode ? "change" : "new");
	const [wish, setWish] = useState("");
	const [estimate, setEstimate] = useState<Estimate | null>(null);
	const [estError, setEstError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	// A clicked part is always a change of the current design.
	const change = hasCode && (mode === "change" || !!part);
	const onePart = change && part ? part : undefined;
	const errors = change ? seenErrors.slice(0, 10).map(seenErrorText) : [];
	const wishText = wish.trim() || undefined;

	useEffect(() => {
		if (open) setMode(hasCode ? (seenErrors.length ? "change" : mode) : "new");
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [open, hasCode]);

	useEffect(() => {
		if (!open) return;
		let live = true;
		setEstimate(null);
		setEstError(null);
		const t = setTimeout(() => {
			call(plannerChannels.codeEstimate, { draftId, wish: wishText, change, part: onePart })
				.then((e) => live && setEstimate(e))
				.catch((err) => live && setEstError(errorText(err)));
		}, 300);
		return () => {
			live = false;
			clearTimeout(t);
		};
	}, [open, draftId, change, wishText, onePart]);

	const start = async () => {
		setBusy(true);
		try {
			await call(plannerChannels.newCode, { draftId, wish: wishText, change, part: onePart, seenErrors: errors.length ? errors : undefined, confirmedCost: true });
			onOpenChange(false);
			onStarted(onePart ? "Change one part of the AI design" : change ? "Change the AI design" : "New AI design");
		} catch (err) {
			toast.error("Could not start", { description: errorText(err) });
		} finally {
			setBusy(false);
		}
	};

	return (
		<Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
			<DialogContent title="AI design" description="The AI writes the video's picture as code: layout, colours, type, drawings and motion. The script and voice stay the same. The code is tested before it is used. You can undo it." className="w-[min(92vw,540px)]">
				<div className="mt-4 space-y-3.5">
					{hasCode ? (
						<div className="rounded-md border bg-subtle/60 px-3 py-2 text-[12.5px]">
							<p className="font-medium">Now: {plan.meta.code!.name}</p>
							{plan.meta.code!.idea ? <p className="text-muted-foreground">{plan.meta.code!.idea}</p> : null}
						</div>
					) : null}
					{onePart ? (
						<div className="rounded-md border border-warning/40 bg-warning-soft/40 px-3 py-2 text-[12.5px]" data-testid="code-part">
							<p className="flex items-center gap-1.5 font-medium">
								<Crosshair className="size-3.5" />
								Only this part changes: {onePart.id}
							</p>
							{onePart.text ? <p className="truncate text-muted-foreground">“{onePart.text}”</p> : null}
						</div>
					) : null}
					{hasCode && !onePart ? (
						<div className="space-y-1.5">
							<Label>What to do</Label>
							<Select<"change" | "new">
								ariaLabel="Change or new design"
								value={mode}
								onChange={setMode}
								options={[
									{ value: "change", label: "Change this design", hint: "Keeps what you do not ask to change" },
									{ value: "new", label: "Make a new design", hint: "A different idea" },
								]}
							/>
						</div>
					) : null}
					<div className="space-y-1.5">
						<Label htmlFor="code-wish">{onePart ? "What should change in this part?" : change ? "What should change?" : "What should it look like? (optional)"}</Label>
						<Textarea
							id="code-wish"
							value={wish}
							maxLength={600}
							onChange={(e) => setWish(e.target.value)}
							placeholder={onePart ? "For example: bigger and bolder, in the accent colour, slide in from the left, a hand-drawn underline" : change ? "For example: calmer motion, bigger text, a darker background, more drawings in scene 4" : "For example: a comic book, hand-drawn on paper, a 1980s arcade game, calm watercolours, a news show"}
							className="min-h-20 text-[13px]"
						/>
					</div>
					{errors.length ? (
						<p className="flex items-start gap-1.5 text-[12px] text-warning">
							<TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
							The AI also fixes the {errors.length} error{errors.length === 1 ? "" : "s"} the preview found.
						</p>
					) : null}
					<p className="text-[12px] text-muted-foreground" data-testid="code-cost">
						{estError ? <span className="text-danger">{estError}</span> : estimate ? costLine(estimate) : "Working out the cost…"}
					</p>
				</div>
				<DialogFooter>
					<Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
						Cancel
					</Button>
					<Button onClick={() => void start()} loading={busy} disabled={!estimate || !!estError} data-testid="code-start">
						<Sparkles />
						{onePart ? "Change this part" : change ? "Change design" : "Make design"}
						{estimate?.needsConfirm && estimate.costUsd ? ` (${usd(estimate.costUsd.low)})` : ""}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

/** A part of the design the user clicked in the preview. */
export type DesignPart = { id: string; text: string };

/** True when the design names its parts (data-id), so a part can be clicked and changed alone. */
export const hasParts = (plan: VideoPlan) => !!plan.meta.code && /data-id/.test(plan.meta.code.source);

/** "Change one part": turns on pick mode in the preview. */
export function PickPartButton({ picking, disabled, onToggle }: { picking: boolean; disabled: boolean; onToggle: () => void }) {
	return (
		<Tooltip content={picking ? "Stop picking (Esc)" : "Click a part of the picture, then say how it should change. The rest stays the same."}>
			<Button variant={picking ? "default" : "outline"} size="sm" disabled={disabled} onClick={onToggle} data-testid="pick-part">
				<Crosshair />
				{picking ? "Click a part…" : "Change one part"}
			</Button>
		</Tooltip>
	);
}

/** The header button: the design's name; opens the dialog. */
export function CodeButton({ plan, disabled, onOpen }: { plan: VideoPlan; disabled: boolean; onOpen: () => void }) {
	const code = plan.meta.code;
	return (
		<Tooltip content={code ? `AI design: ${code.name}. Click to change it or make a new one.` : "Make the AI design"}>
			<Button variant="outline" size="sm" disabled={disabled} onClick={onOpen} data-testid="code-design">
				<Code2 />
				<span className="max-w-32 truncate">{code ? code.name : "Make design"}</span>
			</Button>
		</Tooltip>
	);
}

/**
 * Quick tweaks for an AI design, with no AI call: accent colour, text size,
 * spacing and motion speed. The design reads them (video.tweaks); designs made
 * before tweaks existed do not, so the bar shows only for designs that do.
 * Each change is one undo step, made when a slider is let go.
 */
export function CodeTweaksBar({ plan, disabled, onApply }: { plan: VideoPlan; disabled: boolean; onApply: (tweaks: CodeTweaks | undefined, label: string) => void }) {
	const saved = plan.meta.tweaks ?? NO_TWEAKS;
	const [draft, setDraft] = useState<CodeTweaks>(saved);
	useEffect(() => setDraft(saved), [saved]);
	if (!plan.meta.code || !usesTweaks(plan.meta.code.source)) return null;
	const set = (patch: Partial<CodeTweaks>, label: string) => {
		const next = { ...saved, ...patch };
		onApply(next, label);
	};
	const pct = (v: number) => `${Math.round(v * 100)}%`;
	const slider = (key: "text" | "space" | "speed", label: string, min: number, max: number) => (
		<label className="flex min-w-0 flex-1 items-center gap-2">
			<span className="shrink-0 text-muted-foreground">{label}</span>
			<Slider ariaLabel={label} value={draft[key]} min={min} max={max} step={0.05} disabled={disabled} onChange={(v) => setDraft({ ...draft, [key]: v })} onCommit={(v) => set({ [key]: v }, `${label}: ${pct(v)}`)} />
			<span className="w-10 shrink-0 text-right tabular-nums">{pct(draft[key])}</span>
		</label>
	);
	const changed = saved.accent !== undefined || saved.text !== 1 || saved.space !== 1 || saved.speed !== 1;
	return (
		<div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border bg-subtle/60 px-3 py-2 text-[12.5px]" data-testid="code-tweaks">
			<span className="flex items-center gap-1.5 font-medium">
				<SlidersHorizontal className="size-3.5" />
				Quick tweaks
			</span>
			<label className="flex items-center gap-2">
				<span className="text-muted-foreground">Accent</span>
				<input type="color" aria-label="Accent colour" disabled={disabled} value={draft.accent ?? "#6366f1"} onChange={(e) => setDraft({ ...draft, accent: e.target.value })} onBlur={(e) => e.target.value !== saved.accent && set({ accent: e.target.value }, "Accent colour")} className="h-7 w-9 cursor-pointer rounded border bg-card p-0.5" />
			</label>
			{slider("text", "Text size", 0.85, 1.15)}
			{slider("space", "Spacing", 0.8, 1.25)}
			{slider("speed", "Motion speed", 0.5, 2)}
			<Button size="sm" variant="ghost" disabled={disabled || !changed} onClick={() => onApply(undefined, "Reset tweaks")}>
				Reset
			</Button>
		</div>
	);
}

/** Shown under the preview when the AI code failed somewhere: the built-in scene is drawn there. */
export function CodeErrors({ errors, onFix, disabled }: { errors: SeenError[]; onFix: () => void; disabled: boolean }) {
	if (!errors.length) return null;
	const scenes = [...new Set(errors.map((e) => e.scene))];
	const whole = scenes.includes(-1);
	return (
		<div className="flex items-center gap-2 rounded-lg border border-warning/40 bg-warning-soft/40 px-3 py-2 text-[12.5px]" data-testid="code-errors">
			<Badge tone="warning">
				<TriangleAlert className="size-3" />
				AI code error
			</Badge>
			<Tooltip content={errors.slice(0, 6).map(seenErrorText).join("\n")}>
				<span className="min-w-0 flex-1 truncate">{whole ? "The design's code does not run. The video shows the built-in scenes." : `Scene ${scenes.map((s) => s + 1).join(", ")} shows the built-in scene instead.`}</span>
			</Tooltip>
			<Button size="sm" variant="outline" onClick={onFix} disabled={disabled}>
				Fix with AI
			</Button>
		</div>
	);
}
