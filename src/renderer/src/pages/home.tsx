import { Link } from "@tanstack/react-router";
import { ArrowRight, CircleCheck, Clapperboard, FileStack, FileText, ListChecks, ListVideo, Loader2, Plus, Sparkles, Timer, TriangleAlert, Upload, Wand2 } from "lucide-react";
import { useEffect, useState } from "react";
import { libraryChannels, type DraftSummary, type VideoView } from "@shared/ipc/library";
import { Button } from "@renderer/components/ui/button";
import { Card } from "@renderer/components/ui/primitives";
import { duration, timeAgo, timeLeft } from "@renderer/lib/format";
import { call } from "@renderer/lib/ipc";
import { modKey } from "@renderer/lib/utils";
import { jobActive, useRenders } from "@renderer/stores/render";
import type { RenderJobView } from "@shared/ipc/render";

const STEPS = [
	{ icon: Upload, title: "Add material", text: "PDF, Word, web page, notes, or a photo of a textbook page." },
	{ icon: ListChecks, title: "Approve the outline", text: "Pick the audience — kindergarten to PhD — and shape the chapters." },
	{ icon: Wand2, title: "Preview and edit", text: "Every scene is designed for its idea. Change any line or visual." },
	{ icon: Clapperboard, title: "Render and publish", text: "MP4, thumbnail, captions, chapters and a ready YouTube description." },
];

/** Planning stages continue in the wizard; drafts with a script open in the Studio. */
const draftLink = (d: DraftSummary) => (d.badge === "source" || d.badge === "outline" || d.badge === "script" ? "/new" : "/studio");

const DRAFT_STAGE: Record<DraftSummary["badge"], string> = {
	source: "Material added",
	outline: "Outline",
	script: "Script",
	voice: "Needs voice",
	ready: "Ready to render",
	rendering: "Rendering",
	failed: "Render failed",
	rendered: "Rendered",
};

function QueueCard({ jobs }: { jobs: RenderJobView[] }) {
	const active = jobs.filter(jobActive);
	const last = jobs.find((j) => !jobActive(j));
	return (
		<Card className="flex flex-col p-4" data-testid="home-queue">
			<div className="mb-3 flex items-center justify-between">
				<h2 className="text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">Render queue</h2>
				<Button variant="link" size="sm" asChild>
					<Link to="/queue">
						Open <ArrowRight />
					</Link>
				</Button>
			</div>
			{active.length ? (
				<ul className="space-y-3">
					{active.slice(0, 3).map((j) => (
						<li key={j.id}>
							<div className="flex items-center justify-between gap-2 text-[13px]">
								<span className="flex min-w-0 items-center gap-1.5 font-medium">
									{j.status === "running" ? <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" /> : <ListVideo className="size-3.5 shrink-0 text-muted-foreground" />}
									<span className="truncate">{j.title}</span>
								</span>
								<span className="shrink-0 tabular-nums text-muted-foreground">{j.status === "queued" ? "Waiting" : `${Math.round(j.progress * 100)}%`}</span>
							</div>
							<div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
								<div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${Math.round(j.progress * 100)}%` }} />
							</div>
							<div className="mt-1 truncate text-[11.5px] text-muted-foreground">
								{j.detail ?? ""}
								{j.etaMs ? ` · ${timeLeft(j.etaMs)}` : ""}
							</div>
						</li>
					))}
					{active.length > 3 ? <li className="text-[12px] text-muted-foreground">and {active.length - 3} more waiting</li> : null}
				</ul>
			) : (
				<div className="flex flex-1 flex-col justify-center gap-1 text-[13px] text-muted-foreground">
					<span>Nothing is rendering.</span>
					{last ? (
						<span className="flex items-center gap-1.5 text-[12px]">
							{last.status === "done" ? <CircleCheck className="size-3.5 text-success" /> : <TriangleAlert className="size-3.5 text-warning" />}
							Last: <span className="truncate font-medium text-foreground">{last.title}</span> · {last.status === "done" ? "done" : last.status === "error" ? "failed" : "cancelled"} {timeAgo(last.finishedAt ?? last.createdAt)}
						</span>
					) : null}
				</div>
			)}
		</Card>
	);
}

export function HomePage() {
	const version = useRenders((s) => s.libraryVersion);
	const jobs = useRenders((s) => s.queue);
	const inQueue = jobs.filter(jobActive).length;
	const [data, setData] = useState<{ videos: VideoView[]; drafts: DraftSummary[] } | null>(null);
	useEffect(() => {
		void Promise.all([call(libraryChannels.videos), call(libraryChannels.drafts)])
			.then(([videos, drafts]) => setData({ videos, drafts }))
			.catch(() => setData({ videos: [], drafts: [] }));
	}, [version]);
	const minutes = Math.round((data?.videos.reduce((n, v) => n + v.durationMs, 0) ?? 0) / 60_000);
	const STATS = [
		{ icon: Clapperboard, label: "Videos", value: String(data?.videos.length ?? 0) },
		{ icon: FileStack, label: "Drafts", value: String(data?.drafts.length ?? 0) },
		{ icon: Timer, label: "Minutes rendered", value: String(minutes) },
		{ icon: ListVideo, label: "In queue", value: String(inQueue) },
	];
	const drafts = (data?.drafts ?? []).filter((d) => d.badge !== "rendered").slice(0, 4);
	const videos = (data?.videos ?? []).slice(0, 3);
	const empty = !!data && !data.videos.length && !data.drafts.length;
	return (
		<div className="space-y-8">
			<section className="relative overflow-hidden rounded-2xl border bg-card p-8 shadow-xs">
				<div className="pointer-events-none absolute -right-24 -top-24 size-80 rounded-full bg-primary/15 blur-3xl" />
				<div className="pointer-events-none absolute -bottom-32 right-40 size-72 rounded-full bg-[oklch(0.7_0.15_200)]/10 blur-3xl" />
				<div className="relative max-w-2xl">
					<div className="mb-4 inline-flex items-center gap-1.5 rounded-full border bg-subtle px-2.5 py-1 text-[12px] font-medium text-muted-foreground">
						<Sparkles className="size-3.5 text-primary" />
						Explainer videos for YouTube, Shorts, TikTok and Reels
					</div>
					<h1 className="text-[28px] font-semibold leading-tight tracking-tight">Explainer Studio</h1>
					<p className="mt-3 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
						Start from your own material or just a topic, choose who it is for, and get a clear, step-by-step explainer with narration, motion graphics, photos, music and sound.
					</p>
					<div className="mt-6 flex flex-wrap items-center gap-2">
						<Button size="lg" asChild>
							<Link to="/new">
								<Plus />
								New video
							</Link>
						</Button>
						<Button size="lg" variant="outline" asChild>
							<Link to="/drafts">
								<FileText />
								Open drafts
							</Link>
						</Button>
						<span className="ml-2 text-[12px] text-muted-foreground">
							or press <span className="font-medium text-foreground">{modKey} N</span>
						</span>
					</div>
				</div>
			</section>

			<section className="grid grid-cols-4 gap-3">
				{STATS.map((s) => (
					<Card key={s.label} className="p-4">
						<div className="flex items-center justify-between text-muted-foreground">
							<span className="text-[12px] font-medium">{s.label}</span>
							<s.icon className="size-4" />
						</div>
						<div className="mt-2 text-2xl font-semibold tabular-nums tracking-tight">{s.value}</div>
					</Card>
				))}
			</section>

			<section className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] gap-3">
				<Card className="p-4" data-testid="home-drafts">
					<div className="mb-2 flex items-center justify-between">
						<h2 className="text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">Continue working</h2>
						<Button variant="link" size="sm" asChild>
							<Link to="/drafts">
								All drafts <ArrowRight />
							</Link>
						</Button>
					</div>
					{drafts.length ? (
						<ul className="divide-y">
							{drafts.map((d) => (
								<li key={d.id}>
									<Link to={draftLink(d)} search={{ draft: d.id }} className="group flex items-center gap-3 py-2.5">
										<div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary-soft-foreground">
											<FileStack className="size-4" />
										</div>
										<div className="min-w-0 flex-1">
											<div className="truncate text-[13px] font-semibold group-hover:underline">{d.title}</div>
											<div className="truncate text-[12px] text-muted-foreground">
												{d.series ? `Ep. ${d.series.episode} · ` : ""}
												{d.level} · {DRAFT_STAGE[d.badge]} · {timeAgo(d.updatedAt)}
											</div>
										</div>
										<ArrowRight className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
									</Link>
								</li>
							))}
						</ul>
					) : (
						<p className="py-6 text-[13px] text-muted-foreground">No drafts in progress. Start a new video to make one.</p>
					)}
				</Card>
				<QueueCard jobs={jobs} />
			</section>

			{videos.length ? (
				<section>
					<div className="mb-3 flex items-center justify-between">
						<h2 className="text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">Recent videos</h2>
						<Button variant="link" size="sm" asChild>
							<Link to="/library">
								View library <ArrowRight />
							</Link>
						</Button>
					</div>
					<div className="grid grid-cols-3 gap-3">
						{videos.map((v) => (
							<Link key={v.id} to="/library" className="group">
								<Card className="overflow-hidden p-0 transition-shadow group-hover:shadow-md">
									<div className="flex aspect-video items-center justify-center bg-muted text-muted-foreground">
										{v.thumbnails[0] ? <img src={v.thumbnails[0]} alt="" className="size-full object-cover" /> : <Clapperboard className="size-6" />}
									</div>
									<div className="px-3 py-2.5">
										<div className="truncate text-[13px] font-semibold">{v.title}</div>
										<div className="truncate text-[12px] text-muted-foreground">
											{duration(v.durationMs)} · {timeAgo(v.createdAt)}
										</div>
									</div>
								</Card>
							</Link>
						))}
					</div>
				</section>
			) : null}

			{empty ? (
			<section>
				<h2 className="mb-3 text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">How it works</h2>
				<div className="grid grid-cols-4 gap-3">
					{STEPS.map((s, i) => (
						<Card key={s.title} className="group relative p-5 transition-shadow hover:shadow-md">
							<div className="flex items-center justify-between">
								<div className="flex size-9 items-center justify-center rounded-xl bg-primary-soft text-primary-soft-foreground">
									<s.icon className="size-[18px]" />
								</div>
								<span className="text-[12px] font-semibold tabular-nums text-muted-foreground/70">0{i + 1}</span>
							</div>
							<h3 className="mt-4 text-sm font-semibold">{s.title}</h3>
							<p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{s.text}</p>
						</Card>
					))}
				</div>
			</section>
			) : null}
		</div>
	);
}
