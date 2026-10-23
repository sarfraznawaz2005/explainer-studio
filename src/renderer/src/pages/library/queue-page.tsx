import { Link } from "@tanstack/react-router";
import { CircleCheck, CircleX, Clapperboard, Copy, ListVideo, Loader2, RotateCcw, Square, X } from "lucide-react";
import { toast } from "sonner";
import { renderChannels, type JobStep, type RenderJobView } from "@shared/ipc/render";
import { QUALITIES, RESOLUTIONS } from "@shared/render";
import { Button } from "@renderer/components/ui/button";
import { confirm } from "@renderer/components/ui/confirm";
import { EmptyState } from "@renderer/components/ui/misc";
import { Badge, Card, PageHeader, Tooltip } from "@renderer/components/ui/primitives";
import { duration, timeAgo, timeLeft } from "@renderer/lib/format";
import { call, errorText } from "@renderer/lib/ipc";
import { cn } from "@renderer/lib/utils";
import { jobActive, useRenders } from "@renderer/stores/render";

const STEP_LABEL: Record<JobStep, string> = {
	waiting: "Waiting",
	browser: "Render browser",
	bundling: "Preparing",
	chapters: "Rendering",
	joining: "Joining chapters",
	thumbnails: "Thumbnails",
	finishing: "Finishing",
	done: "Done",
};

const settingsText = (j: RenderJobView) => `${RESOLUTIONS[j.settings.resolution].label} · ${j.settings.fps} fps · ${QUALITIES[j.settings.quality].label}`;

async function cancelJob(j: RenderJobView) {
	const ok = await confirm({
		title: "Cancel this render?",
		description: j.status === "running" ? "The chapters rendered so far are deleted. The draft is not changed." : "The job is removed from the queue. The draft is not changed.",
		tone: "danger",
		confirmLabel: "Cancel render",
		cancelLabel: "Keep rendering",
	});
	if (!ok) return;
	await call(renderChannels.cancelJob, { jobId: j.id }).catch((err) => toast.error("Could not cancel", { description: errorText(err) }));
}

async function retryJob(j: RenderJobView) {
	try {
		await call(renderChannels.retryJob, { jobId: j.id });
		const done = j.chapters.filter((c) => c.state === "done").length;
		toast.success("Render started again", { description: done ? `${done} finished chapter${done === 1 ? " is" : "s are"} kept.` : undefined });
	} catch (err) {
		toast.error("Could not start again", { description: errorText(err) });
	}
}

async function clearJob(j: RenderJobView) {
	if (j.status === "error") {
		const ok = await confirm({ title: "Remove this failed render?", description: "Its finished chapters are deleted, so it cannot be started again. The draft is not changed.", tone: "danger", confirmLabel: "Remove" });
		if (!ok) return;
	}
	try {
		await call(renderChannels.clearJob, { jobId: j.id });
		useRenders.setState((s) => ({ queue: s.queue.filter((x) => x.id !== j.id) }));
	} catch (err) {
		toast.error("Could not remove", { description: errorText(err) });
	}
}

function ChapterStrip({ job }: { job: RenderJobView }) {
	const total = job.chapters.reduce((n, c) => n + c.frames, 0) || 1;
	return (
		<div className="flex h-2 gap-1" aria-hidden>
			{job.chapters.map((c, i) => (
				<Tooltip key={i} content={`${i + 1}. ${c.title}: ${c.state === "done" ? "done" : c.state === "rendering" ? `${Math.round(c.progress * 100)}%` : c.state === "error" ? "failed" : "waiting"}`}>
					<div className="h-full min-w-1.5 overflow-hidden rounded-full bg-muted" style={{ flex: c.frames / total }}>
						<div
							className={cn("h-full rounded-full transition-[width] duration-300", c.state === "error" ? "bg-danger" : c.state === "done" ? "bg-success" : "bg-primary")}
							style={{ width: `${c.state === "error" ? 100 : c.progress * 100}%` }}
						/>
					</div>
				</Tooltip>
			))}
		</div>
	);
}

function ActiveJob({ job }: { job: RenderJobView }) {
	const pct = Math.round(job.progress * 100);
	const running = job.status === "running";
	const cur = job.chapters.findIndex((c) => c.state !== "done");
	return (
		<Card className="p-5" data-testid="active-job">
			<div className="flex items-start gap-4">
				<div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary-soft-foreground">
					{running ? <Loader2 className="size-5 animate-spin" /> : <ListVideo className="size-5" />}
				</div>
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-2">
						<h3 className="truncate text-[15px] font-semibold">{job.title}</h3>
						<Badge tone={running ? "primary" : "neutral"}>{running ? STEP_LABEL[job.step] : "Waiting"}</Badge>
						{job.resumes ? <Badge>Resumed</Badge> : null}
					</div>
					<p className="mt-0.5 truncate text-[12px] text-muted-foreground">
						{settingsText(job)} · {duration(job.durationMs)} · {job.chapters.length} chapters
					</p>
				</div>
				<Button variant="outline" size="sm" onClick={() => void cancelJob(job)}>
					<Square className="fill-current" />
					Cancel
				</Button>
			</div>
			{running ? (
				<div className="mt-4 space-y-2.5" aria-live="polite">
					<div className="flex items-baseline justify-between gap-3 text-[13px]">
						<span className="truncate text-muted-foreground">{job.detail ?? (cur >= 0 ? `Chapter ${cur + 1}` : "")}</span>
						<span className="shrink-0 tabular-nums">
							<span className="font-semibold">{pct}%</span>
							{job.etaMs !== null ? <span className="text-muted-foreground"> · {timeLeft(job.etaMs)} left</span> : null}
						</span>
					</div>
					<div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="Render progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
						<div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${pct}%` }} />
					</div>
					<ChapterStrip job={job} />
				</div>
			) : null}
		</Card>
	);
}

function FinishedJob({ job }: { job: RenderJobView }) {
	const done = job.status === "done";
	const failed = job.status === "error";
	const kept = job.chapters.filter((c) => c.state === "done").length;
	const failedAt = job.chapters.findIndex((c) => c.state === "error");
	return (
		<li className="flex items-start gap-3 px-4 py-3" data-testid={`job-${job.status}`}>
			<span className="mt-0.5">{done ? <CircleCheck className="size-4 text-success" /> : failed ? <CircleX className="size-4 text-danger" /> : <X className="size-4 text-muted-foreground" />}</span>
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-2">
					<span className="truncate text-[13px] font-medium">{job.title}</span>
					<span className="shrink-0 text-[12px] text-muted-foreground">{timeAgo(job.finishedAt ?? job.createdAt)}</span>
				</div>
				<div className="text-[12px] text-muted-foreground">
					{done ? `${settingsText(job)} · ${duration(job.durationMs)}` : failed ? `Stopped${failedAt >= 0 ? ` in chapter ${failedAt + 1}` : ""}. ${kept} of ${job.chapters.length} chapters are kept.` : "Cancelled"}
				</div>
				{failed && job.error ? (
					<p data-selectable className="mt-1.5 line-clamp-3 rounded-md bg-danger-soft px-2 py-1.5 font-mono text-[11px] text-danger">
						{job.error}
					</p>
				) : null}
			</div>
			<div className="flex shrink-0 items-center gap-1.5">
				{done ? (
					<Button size="sm" variant="outline" asChild>
						<Link to="/library">
							<Clapperboard />
							Open in Videos
						</Link>
					</Button>
				) : null}
				{failed ? (
					<>
						<Tooltip content="Copy the error text">
							<Button size="icon-sm" variant="ghost" aria-label="Copy the error text" onClick={() => void navigator.clipboard.writeText(`${job.title}\n${job.error ?? ""}`).then(() => toast.success("Copied"))}>
								<Copy />
							</Button>
						</Tooltip>
						<Button size="sm" onClick={() => void retryJob(job)}>
							<RotateCcw />
							{failedAt >= 0 ? `Resume at chapter ${failedAt + 1}` : "Try again"}
						</Button>
					</>
				) : null}
				<Tooltip content="Remove from the list">
					<Button size="icon-sm" variant="ghost" aria-label="Remove from the list" onClick={() => void clearJob(job)}>
						<X />
					</Button>
				</Tooltip>
			</div>
		</li>
	);
}

export function QueuePage() {
	const queue = useRenders((s) => s.queue);
	const active = queue.filter(jobActive).sort((a, b) => (a.status === "running" ? -1 : b.status === "running" ? 1 : a.createdAt.localeCompare(b.createdAt)));
	const finished = queue.filter((j) => !jobActive(j));
	return (
		<div className="space-y-6">
			<PageHeader title="Render queue" description="Videos being rendered in the background, with progress and time left. One video renders at a time." />
			{!queue.length ? (
				<EmptyState
					icon={ListVideo}
					title="Nothing is rendering"
					description="Start a render from the Studio. You can keep working while it runs, and Windows tells you when it is done."
					actions={
						<Button variant="outline" asChild>
							<Link to="/drafts">Open drafts</Link>
						</Button>
					}
				/>
			) : null}
			{active.length ? (
				<section className="space-y-3">
					{active.map((j) => (
						<ActiveJob key={j.id} job={j} />
					))}
				</section>
			) : null}
			{finished.length ? (
				<section>
					<h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">Finished</h2>
					<Card className="overflow-hidden p-0">
						<ul className="divide-y">
							{finished.map((j) => (
								<FinishedJob key={j.id} job={j} />
							))}
						</ul>
					</Card>
				</section>
			) : null}
		</div>
	);
}
