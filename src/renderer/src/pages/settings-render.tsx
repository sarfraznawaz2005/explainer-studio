import { Player } from "@remotion/player";
import { CircleCheck, CircleX, Clapperboard, FolderOpen, Square } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { renderChannels, type RenderStage } from "@shared/ipc/render";
import { QUALITIES, RESOLUTIONS, type Quality, type RenderSettings as Defaults, type Resolution } from "@shared/render";
import { Segmented } from "@renderer/components/ui/misc";
import { TEST_CARD, testCardDefaults } from "@video/compositions";
import { TestCard } from "@video/TestCard";
import { Button } from "@renderer/components/ui/button";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@renderer/components/ui/primitives";
import { call, errorText } from "@renderer/lib/ipc";
import { cn } from "@renderer/lib/utils";
import { isActive, useRenders } from "@renderer/stores/render";

const STAGE_LABEL: Record<RenderStage, string> = {
	queued: "Starting",
	browser: "Render browser",
	bundling: "Preparing",
	rendering: "Rendering",
	encoding: "Finishing",
	done: "Done",
	cancelled: "Cancelled",
	error: "Failed",
};

/** Default resolution, frame rate and quality for new renders. Saved at once. */
function RenderDefaults() {
	const [s, setS] = useState<Defaults | null>(null);
	useEffect(() => {
		void call(renderChannels.getDefaults).then(setS);
	}, []);
	const save = async (next: Defaults) => {
		setS(next);
		try {
			setS(await call(renderChannels.setDefaults, next));
		} catch (err) {
			toast.error("Could not save", { description: errorText(err) });
		}
	};
	return (
		<Card>
			<CardHeader>
				<CardTitle>Render defaults</CardTitle>
				<CardDescription>Used for every new render. You can change them for one video in the Render dialog.</CardDescription>
			</CardHeader>
			<CardContent>
				{s ? (
					<div className="grid grid-cols-[120px_1fr] items-center gap-x-4 gap-y-3.5 text-[13px]">
						<span className="font-medium">Resolution</span>
						<Segmented
							ariaLabel="Default resolution"
							value={s.resolution}
							onChange={(v) => void save({ ...s, resolution: v })}
							options={(Object.keys(RESOLUTIONS) as Resolution[]).map((r) => ({ value: r, label: r === "2160p" ? "4K" : r }))}
						/>
						<span className="font-medium">Frame rate</span>
						<Segmented
							ariaLabel="Default frame rate"
							value={String(s.fps) as "30" | "60"}
							onChange={(v) => void save({ ...s, fps: Number(v) as 30 | 60 })}
							options={[
								{ value: "30", label: "30 fps" },
								{ value: "60", label: "60 fps" },
							]}
						/>
						<span className="font-medium">Quality</span>
						<div className="flex items-center gap-3">
							<Segmented ariaLabel="Default quality" value={s.quality} onChange={(v) => void save({ ...s, quality: v })} options={(Object.keys(QUALITIES) as Quality[]).map((q) => ({ value: q, label: QUALITIES[q].label }))} />
							<span className="text-[12px] text-muted-foreground">{QUALITIES[s.quality].hint}</span>
						</div>
					</div>
				) : null}
			</CardContent>
		</Card>
	);
}

/** Settings → Rendering: defaults, then preview the test composition and render it to MP4. */
export function RenderSettings() {
	const jobId = useRenders((s) => s.testJobId);
	const job = useRenders((s) => (s.testJobId ? s.jobs[s.testJobId] : undefined));
	const active = isActive(job);

	const start = async () => {
		try {
			const r = await call(renderChannels.startTest);
			useRenders.setState({ testJobId: r.jobId });
		} catch (err) {
			toast.error("Could not start the render", { description: errorText(err) });
		}
	};

	const cancel = async () => {
		if (!jobId) return;
		await call(renderChannels.cancel, { jobId }).catch((err) => toast.error("Could not cancel", { description: errorText(err) }));
	};

	const reveal = async () => {
		if (!jobId) return;
		await call(renderChannels.reveal, { jobId }).catch((err) => toast.error("Could not open the folder", { description: errorText(err) }));
	};

	const pct = Math.round((job?.progress ?? 0) * 100);

	return (
		<div className="space-y-5">
			<RenderDefaults />
			<Card>
				<CardHeader>
					<div className="flex items-center gap-2">
						<CardTitle>Render engine test</CardTitle>
						<Badge tone="primary">Remotion</Badge>
					</div>
					<CardDescription>
						Preview a 10-second test video, then render it to an MP4 file. The first render downloads a small render browser (about 90 MB) once.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="overflow-hidden rounded-xl border bg-black shadow-sm">
						<Player
							component={TestCard}
							inputProps={testCardDefaults}
							durationInFrames={TEST_CARD.durationInFrames}
							fps={TEST_CARD.fps}
							compositionWidth={TEST_CARD.width}
							compositionHeight={TEST_CARD.height}
							style={{ width: "100%", aspectRatio: `${TEST_CARD.width} / ${TEST_CARD.height}` }}
							controls
							loop
							acknowledgeRemotionLicense
						/>
					</div>

					<div className="flex items-center gap-3">
						{active ? (
							<Button variant="outline" onClick={() => void cancel()}>
								<Square className="fill-current" />
								Cancel render
							</Button>
						) : (
							<Button onClick={() => void start()}>
								<Clapperboard />
								Render test video
							</Button>
						)}
						{job?.stage === "done" ? (
							<Button variant="ghost" onClick={() => void reveal()}>
								<FolderOpen />
								Show in folder
							</Button>
						) : null}
					</div>

					{job ? (
						<div className="rounded-xl border bg-subtle p-4" aria-live="polite">
							<div className="mb-2 flex items-center gap-2 text-[13px]">
								{job.stage === "done" ? <CircleCheck className="size-4 text-success" /> : null}
								{job.stage === "error" ? <CircleX className="size-4 text-danger" /> : null}
								<span className="font-medium">{STAGE_LABEL[job.stage]}</span>
								<span className="truncate text-muted-foreground">{job.error ?? job.detail}</span>
								{active ? <span className="ml-auto font-medium tabular-nums">{pct}%</span> : null}
							</div>
							<div
								className="h-1.5 overflow-hidden rounded-full bg-muted"
								role="progressbar"
								aria-valuemin={0}
								aria-valuemax={100}
								aria-valuenow={job.stage === "done" ? 100 : pct}
							>
								<div
									className={cn(
										"h-full rounded-full transition-[width] duration-200",
										job.stage === "error" ? "bg-danger" : job.stage === "done" ? "bg-success" : "bg-primary",
									)}
									style={{ width: `${job.stage === "done" ? 100 : pct}%` }}
								/>
							</div>
							{job.outputPath ? (
								<p data-selectable className="mt-2 truncate font-mono text-[12px] text-muted-foreground">
									{job.outputPath}
								</p>
							) : null}
						</div>
					) : null}
				</CardContent>
			</Card>
		</div>
	);
}
