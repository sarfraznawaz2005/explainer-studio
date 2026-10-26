import { Code2, Sparkles, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { plannerChannels } from "@shared/ipc/planner";
import type { VideoPlan } from "@shared/plan/schema";
import type { Estimate } from "@shared/planner";
import { Button } from "@renderer/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@renderer/components/ui/dialog";
import { Badge, Label, Textarea, Tooltip } from "@renderer/components/ui/primitives";
import { Select } from "@renderer/components/ui/select";
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
export function CodeDialog({ draftId, plan, open, onOpenChange, seenErrors, onStarted }: { draftId: string; plan: VideoPlan; open: boolean; onOpenChange: (o: boolean) => void; seenErrors: SeenError[]; onStarted: (label: string) => void }) {
	const hasCode = !!plan.meta.code;
	const [mode, setMode] = useState<"change" | "new">(hasCode ? "change" : "new");
	const [wish, setWish] = useState("");
	const [estimate, setEstimate] = useState<Estimate | null>(null);
	const [estError, setEstError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const change = hasCode && mode === "change";
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
			call(plannerChannels.codeEstimate, { draftId, wish: wishText, change })
				.then((e) => live && setEstimate(e))
				.catch((err) => live && setEstError(errorText(err)));
		}, 300);
		return () => {
			live = false;
			clearTimeout(t);
		};
	}, [open, draftId, change, wishText]);

	const start = async () => {
		setBusy(true);
		try {
			await call(plannerChannels.newCode, { draftId, wish: wishText, change, seenErrors: errors.length ? errors : undefined, confirmedCost: true });
			onOpenChange(false);
			onStarted(change ? "Change the AI design" : "New AI design");
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
					{hasCode ? (
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
						<Label htmlFor="code-wish">{change ? "What should change?" : "What should it look like? (optional)"}</Label>
						<Textarea
							id="code-wish"
							value={wish}
							maxLength={600}
							onChange={(e) => setWish(e.target.value)}
							placeholder={change ? "For example: calmer motion, bigger text, a darker background, more drawings in scene 4" : "For example: a comic book, hand-drawn on paper, a 1980s arcade game, calm watercolours, a news show"}
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
						{change ? "Change design" : "Make design"}
						{estimate?.needsConfirm && estimate.costUsd ? ` (${usd(estimate.costUsd.low)})` : ""}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
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
