import { ExternalLink, ImagePlus, Loader2, RefreshCw, Search, Star, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { LICENSES } from "@shared/assets";
import { pictureChannels as ch, type PicturesState, type PictureView } from "@shared/ipc/pictures";
import type { Estimate, PlanSettings } from "@shared/planner";
import { shortCredit, type FigureMeta } from "@shared/source";
import { Button } from "@renderer/components/ui/button";
import { confirm } from "@renderer/components/ui/confirm";
import { Dialog, DialogContent } from "@renderer/components/ui/dialog";
import { Badge, Label, Textarea, Tooltip } from "@renderer/components/ui/primitives";
import { Switch } from "@renderer/components/ui/switch";
import { call, errorText } from "@renderer/lib/ipc";
import { cn } from "@renderer/lib/utils";
import { usePlanner } from "@renderer/stores/planner";

const ORIGIN: Record<PictureView["origin"], string> = { mine: "Yours", web: "Web", source: "Material" };

/** A draft's pictures; reloads when a planner run for the draft ends. */
export function useDraftPictures(draftId: string) {
	const [state, setState] = useState<PicturesState | null>(null);
	const finished = usePlanner((s) => s.finished[draftId] ?? 0);
	const reload = useCallback(() => {
		void call(ch.list, { draftId })
			.then(setState)
			.catch(() => setState(null));
	}, [draftId]);
	useEffect(reload, [reload, finished]);
	return { state, setState, reload };
}

/** Picture details by file name, for the preview (the render builds the same from the draft). */
export function metaOf(state: PicturesState | null): Record<string, FigureMeta> | undefined {
	if (!state) return undefined;
	const out: Record<string, FigureMeta> = {};
	for (const p of state.pictures)
		out[p.file] = { width: p.width, height: p.height, photo: p.origin !== "source", ...(p.focus ? { focus: p.focus } : {}), ...(p.credit ? { credit: shortCredit(p.credit) } : {}) };
	return out;
}

/**
 * The pictures of one video: the user's own (added here), photos found on the
 * web, and figures from the material. Click a picture to describe it, mark it
 * "must use", swap a web photo for another, or remove it.
 */
export function PicturesPanel({
	draftId,
	state,
	setState,
	disabled,
	find,
	columns = 3,
}: {
	draftId: string;
	state: PicturesState | null;
	setState: (s: PicturesState) => void;
	disabled?: boolean;
	/** Wizard only: search the web now (with the cost check). */
	find?: () => Promise<void>;
	columns?: number;
}) {
	const [busy, setBusy] = useState<string | null>(null);
	const [open, setOpen] = useState<PictureView | null>(null);
	const pictures = state?.pictures ?? [];
	const mine = pictures.filter((p) => p.origin === "mine").length;
	const web = pictures.filter((p) => p.origin === "web").length;

	const add = async () => {
		setBusy("add");
		try {
			const before = pictures.length;
			const s = await call(ch.add, { draftId });
			setState(s);
			const n = s.pictures.length - before;
			if (n > 0) toast.success(n === 1 ? "Picture added" : `${n} pictures added`, { description: s.vision ? "The AI looks at them before the script is written. You can also describe them yourself." : "Describe each one, so the script knows what it shows." });
		} catch (err) {
			toast.error("Could not add the pictures", { description: errorText(err) });
		} finally {
			setBusy(null);
		}
	};

	return (
		<div className="space-y-3">
			<div className="flex flex-wrap gap-2">
				<Button size="sm" variant="outline" onClick={() => void add()} disabled={disabled || busy !== null}>
					{busy === "add" ? <Loader2 className="animate-spin" /> : <ImagePlus />}
					Add my pictures
				</Button>
				{find ? (
					<Tooltip content="Searches Wikidata, Openverse and NASA for free photos of the people, places and things in the outline">
						<Button
							size="sm"
							variant="ghost"
							disabled={disabled || busy !== null}
							onClick={() => {
								setBusy("find");
								void find().finally(() => setBusy(null));
							}}
						>
							<Search />
							{web ? "Find more photos" : "Find photos now"}
						</Button>
					</Tooltip>
				) : null}
			</div>
			{pictures.length ? (
				<>
					<p className="text-[12px] text-muted-foreground">
						{[mine ? `${mine} yours` : "", web ? `${web} from the web` : "", pictures.length - mine - web ? `${pictures.length - mine - web} from the material` : ""].filter(Boolean).join(" · ")}. Click one to change it.
					</p>
					<ul className="grid gap-2" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
						{pictures.map((p) => (
							<li key={p.id}>
								<button type="button" onClick={() => setOpen(p)} className="group relative block aspect-[4/3] w-full overflow-hidden rounded-lg border bg-muted text-left" aria-label={`Picture: ${p.caption ?? p.file}`}>
									<img src={p.url} alt="" loading="lazy" className="size-full object-cover transition-transform group-hover:scale-105" />
									<span className="absolute left-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">{ORIGIN[p.origin]}</span>
									{p.mustUse ? <Star className="absolute right-1 top-1 size-3.5 fill-amber-400 text-amber-400 drop-shadow" aria-label="Must use" /> : null}
									{p.usedIn ? <span className="absolute bottom-1 right-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">In {p.usedIn} scene{p.usedIn > 1 ? "s" : ""}</span> : null}
								</button>
							</li>
						))}
					</ul>
				</>
			) : (
				<p className="text-[12px] text-muted-foreground">No pictures yet. Add your own photos, or let the app find free photos on the web before it writes the script.</p>
			)}
			{open ? (
				<PictureDialog
					draftId={draftId}
					picture={state?.pictures.find((p) => p.id === open.id) ?? open}
					disabled={disabled}
					onState={setState}
					onClose={() => setOpen(null)}
				/>
			) : null}
		</div>
	);
}

function PictureDialog({ draftId, picture: p, disabled, onState, onClose }: { draftId: string; picture: PictureView; disabled?: boolean; onState: (s: PicturesState) => void; onClose: () => void }) {
	const [caption, setCaption] = useState(p.caption ?? "");
	const [busy, setBusy] = useState<string | null>(null);
	const [stamp, setStamp] = useState(0);
	const run = async (what: string, fn: () => Promise<PicturesState>, done?: string) => {
		setBusy(what);
		try {
			onState(await fn());
			if (done) toast.success(done);
			return true;
		} catch (err) {
			toast.error("Could not do that", { description: errorText(err) });
			return false;
		} finally {
			setBusy(null);
		}
	};
	const saveCaption = () => {
		if ((p.caption ?? "") === caption.trim()) return;
		void run("caption", () => call(ch.update, { draftId, id: p.id, caption: caption.trim() || null }));
	};
	const remove = async () => {
		if (!(await confirm({ title: "Remove this picture?", description: p.origin === "source" ? "It is no longer offered to the script." : "The picture file is deleted from this video.", confirmLabel: "Remove", tone: "danger" }))) return;
		if (await run("remove", () => call(ch.remove, { draftId, id: p.id }), "Picture removed")) onClose();
	};
	const lic = p.credit ? LICENSES[p.credit.license] : null;
	return (
		<Dialog open onOpenChange={(o) => !o && onClose()}>
			<DialogContent title={p.subject ?? (p.origin === "mine" ? "Your picture" : p.origin === "web" ? "Photo from the web" : "Picture from the material")} description={`${p.width} × ${p.height} · ${p.file}`} className="w-[min(94vw,760px)]">
				<div className="mt-4 grid grid-cols-[1fr_260px] gap-5">
					<div className="flex max-h-[60vh] items-center justify-center overflow-hidden rounded-lg border bg-muted">
						{/* The swap keeps the file name, so a stamp makes the window load the new picture. */}
						<img src={`${p.url}${stamp ? `?v=${stamp}` : ""}`} alt={p.caption ?? ""} className="max-h-[60vh] w-auto object-contain" />
					</div>
					<div className="space-y-4">
						<div className="space-y-1.5">
							<Label htmlFor="pic-caption">What it shows</Label>
							<Textarea id="pic-caption" value={caption} maxLength={500} disabled={disabled} onChange={(e) => setCaption(e.target.value)} onBlur={saveCaption} placeholder="For example: Imran Khan lifting the 1992 Cricket World Cup" className="min-h-20 text-[13px]" />
							<p className="text-[11px] text-muted-foreground">The script writer reads this to decide where the picture fits.</p>
						</div>
						<div className="flex items-center justify-between gap-3">
							<div>
								<p className="text-[13px] font-medium">Must use</p>
								<p className="text-[11px] text-muted-foreground">The script shows it in a scene.</p>
							</div>
							<Switch ariaLabel="Must use" checked={p.mustUse} disabled={disabled || busy !== null} onChange={(v) => void run("must", () => call(ch.update, { draftId, id: p.id, mustUse: v }))} />
						</div>
						{p.credit && lic ? (
							<div className="space-y-1 rounded-lg border bg-subtle/60 p-2.5 text-[12px]">
								<div className="flex items-center gap-2">
									<Badge tone={lic.credit ? "warning" : "success"}>{lic.short}</Badge>
									<span className="text-muted-foreground">{lic.credit ? "Credit is added for you" : "No credit needed"}</span>
								</div>
								<p className="line-clamp-2">
									“{p.credit.title}”{p.credit.creator ? ` by ${p.credit.creator}` : ""}
								</p>
								<a href={p.credit.pageUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
									Source page <ExternalLink className="size-3" />
								</a>
							</div>
						) : null}
						<div className="flex flex-wrap gap-2">
							{p.origin === "web" ? (
								<Button
									size="sm"
									variant="outline"
									disabled={disabled || busy !== null}
									onClick={() => void run("another", () => call(ch.another, { draftId, id: p.id }), "Swapped for another photo").then((ok) => ok && setStamp(Date.now()))}
								>
									{busy === "another" ? <Loader2 className="animate-spin" /> : <RefreshCw />}
									Find another
								</Button>
							) : null}
							<Button size="sm" variant="ghost" className={cn("text-danger hover:bg-danger-soft")} disabled={disabled || busy !== null || p.usedIn > 0} onClick={() => void remove()}>
								<Trash2 />
								Remove
							</Button>
						</div>
						{p.usedIn > 0 ? <p className="text-[11px] text-muted-foreground">Shown in {p.usedIn} scene{p.usedIn > 1 ? "s" : ""}. Change those scenes before you remove it.</p> : null}
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}

/** The wizard's "find photos now": cost check, then the planner run (progress shows in the wizard). */
export async function findPhotosNow(draftId: string, settings: PlanSettings, confirmCost: (e: Estimate, what: string) => Promise<boolean | null>): Promise<void> {
	try {
		const e = await call(ch.estimate, { draftId, settings });
		const confirmed = await confirmCost(e, "Finding photos");
		if (confirmed === null) return;
		await call(ch.find, { draftId, settings, confirmedCost: confirmed });
	} catch (err) {
		toast.error("Could not start", { description: errorText(err) });
	}
}
