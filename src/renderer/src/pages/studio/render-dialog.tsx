import { Link, useNavigate } from "@tanstack/react-router";
import { AlertTriangle, CircleCheck, Clapperboard, ListVideo, Loader2, Music2, ScrollText } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { renderChannels, type RenderCheck } from "@shared/ipc/render";
import { outputSize, QUALITIES, RESOLUTIONS, type Quality, type RenderSettings, type Resolution } from "@shared/render";
import { Button } from "@renderer/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@renderer/components/ui/dialog";
import { Segmented } from "@renderer/components/ui/misc";
import { Label, Tooltip } from "@renderer/components/ui/primitives";
import { Switch } from "@renderer/components/ui/switch";
import { duration } from "@renderer/lib/format";
import { call, errorText } from "@renderer/lib/ipc";
import { cn } from "@renderer/lib/utils";
import { jobActive, useRenders } from "@renderer/stores/render";

const RES_OPTIONS = (Object.keys(RESOLUTIONS) as Resolution[]).map((r) => ({ value: r, label: r === "2160p" ? "4K" : r }));
const FPS_OPTIONS = [
	{ value: "30", label: "30 fps" },
	{ value: "60", label: "60 fps" },
] as const;
const QUALITY_OPTIONS = (Object.keys(QUALITIES) as Quality[]).map((q) => ({ value: q, label: QUALITIES[q].label }));

function CheckRow({ ok, icon, children }: { ok: boolean | null; icon?: ReactNode; children: ReactNode }) {
	return (
		<li className="flex items-start gap-2.5 px-3 py-2.5 text-[13px]">
			<span className={cn("mt-0.5 shrink-0", ok === true ? "text-success" : ok === false ? "text-warning" : "text-muted-foreground")}>
				{icon ?? (ok === false ? <AlertTriangle className="size-4" /> : <CircleCheck className="size-4" />)}
			</span>
			<div className="min-w-0 flex-1">{children}</div>
		</li>
	);
}

/** The Render button and its dialog: checks before rendering, then the output settings. */
export function RenderButton({ draftId }: { draftId: string }) {
	const [open, setOpen] = useState(false);
	const active = useRenders((s) => s.queue.find((j) => j.draftId === draftId && jobActive(j)));
	return (
		<>
			<Tooltip content={active ? "This draft is rendering" : "Render the final video"}>
				<Button size="sm" onClick={() => setOpen(true)} data-testid="render-button">
					{active ? <Loader2 className="animate-spin" /> : <Clapperboard />}
					{active ? `Rendering ${Math.round(active.progress * 100)}%` : "Render"}
				</Button>
			</Tooltip>
			<RenderDialog draftId={draftId} open={open} onOpenChange={setOpen} />
		</>
	);
}

/** The render dialog on its own (Videos and Drafts open it for re-renders). */
export function RenderDialog({ draftId, open, onOpenChange }: { draftId: string | null; open: boolean; onOpenChange: (o: boolean) => void }) {
	return (
		<Dialog open={open && !!draftId} onOpenChange={onOpenChange}>
			{open && draftId ? <RenderDialogBody draftId={draftId} onClose={() => onOpenChange(false)} /> : null}
		</Dialog>
	);
}

function RenderDialogBody({ draftId, onClose }: { draftId: string; onClose: () => void }) {
	const navigate = useNavigate();
	const [check, setCheck] = useState<RenderCheck | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [settings, setSettings] = useState<RenderSettings | null>(null);
	const [remember, setRemember] = useState(false);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		void call(renderChannels.check, { draftId })
			.then((c) => {
				setCheck(c);
				setSettings(c.defaults);
			})
			.catch((err) => setError(errorText(err)));
	}, [draftId]);

	const start = async () => {
		if (!settings) return;
		setBusy(true);
		try {
			await call(renderChannels.queue, { draftId, settings, remember });
			onClose();
			toast.success("Added to the render queue", {
				description: "The video renders in the background. You can keep working.",
				action: { label: "Open queue", onClick: () => void navigate({ to: "/queue" }) },
			});
		} catch (err) {
			toast.error("The render did not start", { description: errorText(err) });
		} finally {
			setBusy(false);
		}
	};

	const missing = check ? check.sentences - check.voiced : 0;
	// The check counts the brand intro and outro only when the saved default adds them.
	const brandMs = check?.brand ? (check.brand.intro + check.brand.outro) * 1000 : 0;
	const shownMs = check && settings ? check.durationMs + (settings.brand === check.defaults.brand ? 0 : settings.brand ? brandMs : -brandMs) : 0;
	const size = settings ? outputSize({ width: 1920, height: 1080 }, settings.resolution) : null;
	const heavy = settings && (settings.resolution === "2160p" || (settings.resolution === "1440p" && settings.fps === 60));

	return (
		<DialogContent title="Render video" description="The video renders in the background. You can keep working, and Windows tells you when it is done." className="w-[min(94vw,580px)]">
			{error ? (
				<p className="mt-4 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2.5 text-[13px] text-danger">{error}</p>
			) : !check || !settings ? (
				<div className="flex h-48 items-center justify-center gap-2 text-[13px] text-muted-foreground">
					<Loader2 className="size-4 animate-spin" /> Checking the draft…
				</div>
			) : (
				<div className="mt-5 space-y-5">
					<div className="rounded-xl border bg-subtle/60 px-4 py-3">
						<div className="truncate text-[14px] font-semibold">{check.title}</div>
						<div className="mt-0.5 text-[12px] text-muted-foreground">
							{check.series ? `Episode ${check.series.episode} of ${check.series.title} · ` : ""}
							{duration(shownMs)} · {check.chapters} chapters · {check.scenes} scenes
						</div>
					</div>

					<ul className="divide-y overflow-hidden rounded-xl border" aria-label="Checks">
						<CheckRow ok={missing === 0}>
							{missing === 0 ? (
								<span>All {check.sentences} sentences have voice.</span>
							) : (
								<span>
									<span className="font-medium">{missing} of {check.sentences} sentences have no voice yet.</span> Those parts will be silent. Close this and click <span className="font-medium">Make voice</span> first.
								</span>
							)}
						</CheckRow>
						<CheckRow ok={null} icon={<Music2 className="size-4" />}>
							{check.musicBeds || check.effects ? `${check.musicBeds} music bed${check.musicBeds === 1 ? "" : "s"} and ${check.effects} sound effect${check.effects === 1 ? "" : "s"}.` : "No music or sound effects."}
						</CheckRow>
						<CheckRow ok={null} icon={<ScrollText className="size-4" />}>
							{check.credits.length ? (
								<details>
									<summary className="cursor-pointer">
										{check.credits.length} credit line{check.credits.length === 1 ? "" : "s"} will be added to the YouTube description.
									</summary>
									<ul className="mt-1.5 space-y-1 text-[12px] text-muted-foreground" data-selectable>
										{check.credits.map((c) => (
											<li key={c}>{c}</li>
										))}
									</ul>
								</details>
							) : (
								"No credits are needed. Every sound used is public domain or CC0."
							)}
						</CheckRow>
					</ul>

					{check.activeJobId ? (
						<div className="flex items-center justify-between gap-3 rounded-xl border border-primary/30 bg-primary-soft px-4 py-3 text-[13px]">
							<span>This draft is already in the render queue.</span>
							<Button size="sm" variant="outline" asChild onClick={onClose}>
								<Link to="/queue">
									<ListVideo />
									Open queue
								</Link>
							</Button>
						</div>
					) : null}

					<div className="grid grid-cols-[110px_1fr] items-center gap-x-4 gap-y-3.5">
						<Label>Resolution</Label>
						<Segmented ariaLabel="Resolution" value={settings.resolution} onChange={(v) => setSettings({ ...settings, resolution: v })} options={RES_OPTIONS} />
						<Label>Frame rate</Label>
						<Segmented ariaLabel="Frame rate" value={String(settings.fps) as "30" | "60"} onChange={(v) => setSettings({ ...settings, fps: Number(v) as 30 | 60 })} options={[...FPS_OPTIONS]} />
						<Label>Quality</Label>
						<div className="flex items-center gap-3">
							<Segmented ariaLabel="Quality" value={settings.quality} onChange={(v) => setSettings({ ...settings, quality: v })} options={QUALITY_OPTIONS} />
							<span className="text-[12px] text-muted-foreground">{QUALITIES[settings.quality].hint}</span>
						</div>
					</div>
					<p className="text-[12px] text-muted-foreground">
						Output: {size?.width} × {size?.height}, {settings.fps} fps, H.264 MP4 with AAC sound. Plus 3 thumbnails, captions (SRT) and the YouTube text.
						{heavy ? " This setting renders much slower than 1080p." : ""}
					</p>
					{check.brand ? (
						<label className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5">
							<span className="min-w-0 text-[13px]">
								Add the brand kit <span className="font-medium">{check.brand.name}</span>
								<span className="block text-[12px] text-muted-foreground">
									{[check.brand.intro ? `${check.brand.intro} s intro` : null, check.brand.outro ? `${check.brand.outro} s outro with end screen` : null, check.brand.watermark ? "watermark" : null].filter(Boolean).join(", ") || "Colours only"}
								</span>
							</span>
							<Switch checked={settings.brand} onChange={(v) => setSettings({ ...settings, brand: v })} ariaLabel="Add the brand kit" />
						</label>
					) : (
						<p className="text-[12px] text-muted-foreground">
							No brand kit yet.{" "}
							<Link to="/brand" className="font-medium text-primary hover:underline" onClick={onClose}>
								Set one up
							</Link>{" "}
							to add your intro, outro and watermark.
						</p>
					)}
					<label className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5">
						<span className="text-[13px]">Use these settings for every new render</span>
						<Switch checked={remember} onChange={setRemember} ariaLabel="Use these settings for every new render" />
					</label>
				</div>
			)}
			<DialogFooter>
				<Button variant="ghost" onClick={onClose}>
					Cancel
				</Button>
				<Button onClick={() => void start()} loading={busy} disabled={!check || !settings || !!check.activeJobId} data-testid="render-start">
					{busy ? null : <Clapperboard />}
					Start render
				</Button>
			</DialogFooter>
		</DialogContent>
	);
}
