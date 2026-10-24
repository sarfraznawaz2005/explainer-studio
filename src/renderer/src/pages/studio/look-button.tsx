import { Palette, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { plannerChannels } from "@shared/ipc/planner";
import { DEFAULT_LOOK, fixLook, type LookRecipe } from "@shared/plan/look";
import type { VideoPlan } from "@shared/plan/schema";
import type { Estimate } from "@shared/planner";
import { Button } from "@renderer/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@renderer/components/ui/dialog";
import { Label, Textarea, Tooltip } from "@renderer/components/ui/primitives";
import { call, errorText } from "@renderer/lib/ipc";
import { costLine, usd } from "./edit-panel";

/** The look's colours as small dots. */
function Swatches({ look }: { look: LookRecipe }) {
	const c = fixLook(look).colors;
	return (
		<span className="inline-flex items-center gap-1">
			{[c.background, c.text, c.accent, c.accent2, c.accent3].map((col, i) => (
				<span key={i} className="size-3.5 rounded-full border border-black/15" style={{ background: col }} />
			))}
		</span>
	);
}

/**
 * "AI free-form" style: shows the current look and asks the AI for a new one.
 * The new look goes into the plan as a normal edit, so Undo brings the old one back.
 */
export function LookButton({ draftId, plan, disabled, apply }: { draftId: string; plan: VideoPlan; disabled: boolean; apply: (next: VideoPlan, label: string) => Promise<void> }) {
	const [open, setOpen] = useState(false);
	const [wish, setWish] = useState("");
	const [estimate, setEstimate] = useState<Estimate | null>(null);
	const [estError, setEstError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const look = plan.meta.look ?? DEFAULT_LOOK;
	useEffect(() => {
		if (!open) return;
		let live = true;
		setEstimate(null);
		setEstError(null);
		call(plannerChannels.lookEstimate, { draftId })
			.then((e) => live && setEstimate(e))
			.catch((err) => live && setEstError(errorText(err)));
		return () => {
			live = false;
		};
	}, [open, draftId]);
	const make = async () => {
		setBusy(true);
		try {
			const r = await call(plannerChannels.newLook, { draftId, wish: wish.trim() || undefined, confirmedCost: true });
			await apply({ ...plan, meta: { ...plan.meta, style: "free", look: r.look } }, `New look: ${r.look.name}`);
			toast.success(`New look: ${r.look.name}`, { description: r.look.idea || undefined });
			setOpen(false);
		} catch (err) {
			toast.error("Could not make a new look", { description: errorText(err) });
		} finally {
			setBusy(false);
		}
	};
	return (
		<>
			<Tooltip content={`Look: ${look.name}. Click for a new one.`}>
				<Button variant="outline" size="sm" disabled={disabled} onClick={() => setOpen(true)} data-testid="new-look">
					<Palette />
					<Swatches look={look} />
				</Button>
			</Tooltip>
			<Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
				<DialogContent title="New AI look" description="The AI designs new colours, fonts, background and motion for this video. The script stays the same. You can undo it." className="w-[min(92vw,520px)]">
					<div className="mt-4 space-y-3.5">
						<div className="flex items-center gap-2.5 rounded-md border bg-subtle/60 px-3 py-2 text-[12.5px]">
							<Swatches look={look} />
							<div className="min-w-0">
								<p className="font-medium">Now: {plan.meta.look ? look.name : "Default AI look"}</p>
								{plan.meta.look?.idea ? <p className="truncate text-muted-foreground">{look.idea}</p> : null}
							</div>
						</div>
						<div className="space-y-1.5">
							<Label htmlFor="look-wish">What should it feel like? (optional)</Label>
							<Textarea id="look-wish" value={wish} maxLength={300} onChange={(e) => setWish(e.target.value)} placeholder="For example: dark and dramatic, like an old map, bright for kids, calm and serious" className="min-h-16 text-[13px]" />
						</div>
						<p className="text-[12px] text-muted-foreground">{estError ? <span className="text-danger">{estError}</span> : estimate ? costLine(estimate) : "Working out the cost…"}</p>
					</div>
					<DialogFooter>
						<Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
							Cancel
						</Button>
						<Button onClick={() => void make()} loading={busy} disabled={!estimate || !!estError} data-testid="new-look-start">
							<Sparkles />
							{estimate?.needsConfirm && estimate.costUsd ? `Make a new look (${usd(estimate.costUsd.low)})` : "Make a new look"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
