import { ChevronDown, Shapes, Sparkles, Wand2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { plannerChannels, type RegenerateTarget } from "@shared/ipc/planner";
import { convertScene, SWAP_TYPES } from "@shared/plan/convert";
import { SCENE_GROUPS, SCENE_LABELS } from "@shared/plan/describe";
import type { Scene, SceneType } from "@shared/plan/schema";
import type { Estimate } from "@shared/planner";
import { Button } from "@renderer/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@renderer/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@renderer/components/ui/misc";
import { Label, Textarea } from "@renderer/components/ui/primitives";
import { Select } from "@renderer/components/ui/select";
import { call, errorText } from "@renderer/lib/ipc";
import { PropsForm } from "./props-form";
import { SCENE_ICONS } from "./scene-meta";

const TRANSITIONS = [
	{ value: "fade", label: "Fade" },
	{ value: "slide", label: "Slide" },
	{ value: "zoom", label: "Zoom" },
	{ value: "none", label: "Cut" },
] as const;

export const usd = (n: number) => (n < 0.01 ? "under $0.01" : `about $${n.toFixed(2)}`);

/** What a rewrite costs, in one line. */
export function costLine(e: Estimate): string {
	const time = `${Math.max(5, Math.round(e.seconds.low))}–${Math.max(10, Math.round(e.seconds.high))} s`;
	if (e.billing === "free") return `Free with ${e.provider}. Takes ${time}.`;
	if (e.billing === "subscription") return `Uses your ${e.provider} plan, no extra cost. Takes ${time}.`;
	if (!e.costUsd) return `${e.provider} ${e.model}: the price is not known. Takes ${time}.`;
	return `${e.provider} ${e.model}: ${usd(e.costUsd.low)}${e.costUsd.high > e.costUsd.low * 1.5 ? ` (up to ${usd(e.costUsd.high).replace("about ", "")})` : ""}. Takes ${time}.`;
}

/** Dialog for an AI rewrite of one scene or one chapter. Shows the cost before anything runs. */
export function RegenerateDialog({ draftId, target, title, open, onOpenChange, onStarted }: { draftId: string; target: RegenerateTarget; title: string; open: boolean; onOpenChange: (o: boolean) => void; onStarted: () => void }) {
	const [type, setType] = useState<SceneType | "auto">("auto");
	const [instructions, setInstructions] = useState("");
	const [estimate, setEstimate] = useState<Estimate | null>(null);
	const [estError, setEstError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const full: RegenerateTarget = target.kind === "scene" ? { ...target, type: type === "auto" ? undefined : type } : target;
	const key = JSON.stringify(full);
	useEffect(() => {
		if (!open) return;
		let live = true;
		setEstimate(null);
		setEstError(null);
		call(plannerChannels.regenerateEstimate, { draftId, target: JSON.parse(key) as RegenerateTarget })
			.then((e) => live && setEstimate(e))
			.catch((err) => live && setEstError(errorText(err)));
		return () => {
			live = false;
		};
	}, [open, draftId, key]);
	const start = async () => {
		setBusy(true);
		try {
			await call(plannerChannels.regenerate, { draftId, target: full, instructions: instructions.trim() || undefined, confirmedCost: true });
			onOpenChange(false);
			onStarted();
		} catch (err) {
			toast.error("Could not start", { description: errorText(err) });
		} finally {
			setBusy(false);
		}
	};
	const typeOptions = [{ value: "auto" as const, label: "Let the AI pick" }, ...SWAP_TYPES.map((t) => ({ value: t, label: SCENE_LABELS[t] }))];
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				title={title}
				description={target.kind === "scene" ? "The AI writes this scene again from the source. Every other scene stays as it is. You can undo it." : "The AI writes this chapter again from the source and checks facts and level. Other chapters stay as they are. You can undo it."}
				className="w-[min(92vw,520px)]"
			>
				<div className="mt-4 space-y-3.5">
					{target.kind === "scene" ? (
						<div className="space-y-1.5">
							<Label>Scene type</Label>
							<Select<SceneType | "auto"> ariaLabel="Scene type for the rewrite" value={type} onChange={setType} options={typeOptions} />
						</div>
					) : null}
					<div className="space-y-1.5">
						<Label htmlFor="regen-wish">What should change? (optional)</Label>
						<Textarea id="regen-wish" value={instructions} maxLength={500} onChange={(e) => setInstructions(e.target.value)} placeholder="For example: simpler words, add an everyday example, show it as a timeline" className="min-h-20 text-[13px]" />
					</div>
					<p className="text-[12px] text-muted-foreground" data-testid="regen-cost">
						{estError ? <span className="text-danger">{estError}</span> : estimate ? costLine(estimate) : "Working out the cost…"}
					</p>
				</div>
				<DialogFooter>
					<Button variant="ghost" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button onClick={() => void start()} loading={busy} disabled={!estimate || !!estError} data-testid="regen-start">
						<Sparkles />
						{estimate?.needsConfirm && estimate.costUsd ? `Rewrite (${usd(estimate.costUsd.low)})` : "Rewrite"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

/** Edit tools for one scene: change type, AI rewrite, transition and the content form. */
export function SceneEditTools({ draftId, scene, disabled, onEdit, onRewriteStarted }: { draftId: string; scene: Scene; disabled: boolean; onEdit: (next: Scene, label: string) => void; onRewriteStarted: () => void }) {
	const [rewrite, setRewrite] = useState(false);
	const cards = scene.type === "title" || scene.type === "chapter";
	const swap = (t: SceneType) => {
		try {
			onEdit(convertScene(scene, t), `Change to ${SCENE_LABELS[t].toLowerCase()}`);
		} catch (err) {
			toast.error("Could not change the type", { description: errorText(err) });
		}
	};
	return (
		<div className="space-y-3">
			<div className="flex flex-wrap gap-1.5">
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button variant="outline" size="sm" disabled={disabled || cards} data-testid="swap-type">
							<Shapes />
							Change type
							<ChevronDown className="opacity-60" />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="start">
						<div className="max-h-[60vh] overflow-y-auto">
							{SCENE_GROUPS.map((g, gi) => {
								const types = g.types.filter((t) => SWAP_TYPES.includes(t) && t !== scene.type);
								if (!types.length) return null;
								return (
									<div key={g.name}>
										{gi ? <DropdownMenuSeparator /> : null}
										<div className="px-2 pb-0.5 pt-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">{g.name}</div>
										{types.map((t) => (
											<DropdownMenuItem key={t} icon={SCENE_ICONS[t]} onSelect={() => swap(t)}>
												{SCENE_LABELS[t]}
											</DropdownMenuItem>
										))}
									</div>
								);
							})}
						</div>
					</DropdownMenuContent>
				</DropdownMenu>
				<Button variant="outline" size="sm" disabled={disabled || cards} onClick={() => setRewrite(true)} data-testid="regen-scene">
					<Wand2 />
					Rewrite with AI
				</Button>
			</div>
			{cards ? <p className="text-[11.5px] text-muted-foreground">Title and chapter cards come from the outline. Edit the words here, or change the outline.</p> : null}
			<div className="space-y-1">
				<Label>Transition in</Label>
				<Select
					ariaLabel="Transition in"
					value={scene.transition.type}
					disabled={disabled}
					onChange={(v) => onEdit({ ...scene, transition: { ...scene.transition, type: v } }, "Change transition")}
					options={TRANSITIONS.map((t) => ({ value: t.value, label: t.label }))}
				/>
			</div>
			<PropsForm key={`${scene.id}:${scene.type}`} type={scene.type} props={scene.props as Record<string, unknown>} disabled={disabled} onCommit={(props) => onEdit({ ...scene, props } as Scene, "Edit scene")} />
			<RegenerateDialog draftId={draftId} target={{ kind: "scene", sceneId: scene.id }} title="Rewrite this scene with AI" open={rewrite} onOpenChange={setRewrite} onStarted={onRewriteStarted} />
		</div>
	);
}
