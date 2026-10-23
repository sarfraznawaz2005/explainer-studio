import { Link, useNavigate } from "@tanstack/react-router";
import { Clapperboard, ClipboardCopy, Copy, FileWarning, FolderOpen, LayoutGrid, List, MoreHorizontal, Play, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { libraryChannels, type VideoView } from "@shared/ipc/library";
import { Button } from "@renderer/components/ui/button";
import { confirm } from "@renderer/components/ui/confirm";
import { Dialog, DialogContent } from "@renderer/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, EmptyState, Segmented } from "@renderer/components/ui/misc";
import { Badge, Card, Input, PageHeader } from "@renderer/components/ui/primitives";
import { Select } from "@renderer/components/ui/select";
import { bytes, duration, timeAgo } from "@renderer/lib/format";
import { call, errorText } from "@renderer/lib/ipc";
import { cn } from "@renderer/lib/utils";
import { useRenders } from "@renderer/stores/render";
import { RenderDialog } from "../studio/render-dialog";

type Sort = "new" | "old" | "long" | "title";
const SORTS: { value: Sort; label: string }[] = [
	{ value: "new", label: "Newest first" },
	{ value: "old", label: "Oldest first" },
	{ value: "long", label: "Longest first" },
	{ value: "title", label: "Title A–Z" },
];
const resLabel = (v: VideoView) => (v.height >= 2160 ? "4K" : `${v.height}p`) + (v.fps === 60 ? "60" : "");

/** Actions shared by the grid, the list and the player. */
function useVideoActions(reload: () => void) {
	const navigate = useNavigate();
	const [renderFor, setRenderFor] = useState<string | null>(null);
	return {
		renderFor,
		setRenderFor,
		reveal: (v: VideoView) => void call(libraryChannels.revealVideo, { videoId: v.id }).catch((err) => toast.error("Could not open the folder", { description: errorText(err) })),
		copyPack: async (v: VideoView) => {
			try {
				await call(libraryChannels.copyPack, { videoId: v.id });
				toast.success("YouTube pack copied", { description: "Title, description with chapters and credits, and tags." });
			} catch (err) {
				toast.error("Could not copy", { description: errorText(err) });
			}
		},
		duplicate: async (v: VideoView) => {
			try {
				const { draftId } = await call(libraryChannels.duplicateVideo, { videoId: v.id });
				toast.success("New draft made", { description: v.title, action: { label: "Open in Studio", onClick: () => void navigate({ to: "/studio", search: { draft: draftId } }) } });
			} catch (err) {
				toast.error("Could not make a draft", { description: errorText(err) });
			}
		},
		remove: async (v: VideoView) => {
			const ok = await confirm({
				title: "Delete this video?",
				description: (
					<>
						<span className="font-medium text-foreground">{v.title}</span> is deleted from this PC: the video file, thumbnails, captions and YouTube text ({bytes(v.sizeBytes)}). The draft is kept.
					</>
				),
				tone: "danger",
				confirmLabel: "Delete video",
			});
			if (!ok) return false;
			try {
				await call(libraryChannels.removeVideo, { videoId: v.id });
				toast.success("Video deleted");
				reload();
				return true;
			} catch (err) {
				toast.error("Could not delete", { description: errorText(err) });
				return false;
			}
		},
	};
}
type Actions = ReturnType<typeof useVideoActions>;

function VideoMenu({ v, a, onPlay }: { v: VideoView; a: Actions; onPlay: () => void }) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant="ghost" size="icon-sm" aria-label={`Actions for ${v.title}`}>
					<MoreHorizontal />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent>
				<DropdownMenuItem icon={Play} onSelect={onPlay}>
					Play
				</DropdownMenuItem>
				<DropdownMenuItem icon={FolderOpen} onSelect={() => a.reveal(v)}>
					Show in folder
				</DropdownMenuItem>
				<DropdownMenuItem icon={ClipboardCopy} onSelect={() => void a.copyPack(v)}>
					Copy YouTube pack
				</DropdownMenuItem>
				<DropdownMenuSeparator />
				{v.draftId ? (
					<DropdownMenuItem icon={RefreshCw} onSelect={() => a.setRenderFor(v.draftId)}>
						Render again
					</DropdownMenuItem>
				) : null}
				<DropdownMenuItem icon={Copy} onSelect={() => void a.duplicate(v)}>
					Duplicate as draft
				</DropdownMenuItem>
				<DropdownMenuSeparator />
				<DropdownMenuItem icon={Trash2} danger onSelect={() => void a.remove(v)}>
					Delete
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function Thumb({ v, className, onPlay }: { v: VideoView; className?: string; onPlay: () => void }) {
	return (
		<button type="button" onClick={onPlay} aria-label={`Play ${v.title}`} className={cn("group relative block aspect-video overflow-hidden bg-muted", className)}>
			{v.thumbnails[0] ? (
				<img src={v.thumbnails[0]} alt="" className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" draggable={false} />
			) : (
				<span className="flex size-full items-center justify-center text-muted-foreground">
					<Clapperboard className="size-6" />
				</span>
			)}
			<span className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/25">
				<span className="flex size-11 scale-90 items-center justify-center rounded-full bg-white/95 text-black opacity-0 shadow-lg transition-all group-hover:scale-100 group-hover:opacity-100">
					<Play className="size-5 translate-x-px fill-current" />
				</span>
			</span>
			<span className="absolute bottom-1.5 right-1.5 rounded bg-black/75 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-white">{duration(v.durationMs)}</span>
			{!v.fileOk ? (
				<span className="absolute left-1.5 top-1.5">
					<Badge tone="danger">
						<FileWarning className="size-3" /> File missing
					</Badge>
				</span>
			) : null}
		</button>
	);
}

function PlayerDialog({ v, a, onClose }: { v: VideoView | null; a: Actions; onClose: () => void }) {
	const [thumb, setThumb] = useState(0);
	useEffect(() => setThumb(0), [v?.id]);
	return (
		<Dialog open={!!v} onOpenChange={(o) => !o && onClose()}>
			{v ? (
				<DialogContent title={v.title} description={`${v.level ? `${v.level} · ` : ""}${duration(v.durationMs)} · ${v.width} × ${v.height}, ${v.fps} fps · ${bytes(v.sizeBytes)}`} className="flex max-h-[92vh] w-[min(94vw,1040px)] flex-col">
					<div className="-mx-6 mt-4 min-h-0 flex-1 overflow-y-auto px-6">
						{v.fileOk ? (
							<video key={v.id} src={v.videoUrl} poster={v.thumbnails[0]} controls autoPlay className="aspect-video w-full rounded-xl bg-black" data-testid="video-player" />
						) : (
							<div className="flex aspect-video w-full items-center justify-center rounded-xl border border-dashed text-[13px] text-muted-foreground">The video file was moved or deleted outside the app.</div>
						)}
						<div className="mt-5 grid grid-cols-[1fr_300px] gap-6">
							<div className="min-w-0">
								<div className="mb-2 flex items-center justify-between">
									<h3 className="text-[13px] font-semibold">YouTube description</h3>
									<Button size="sm" variant="outline" onClick={() => void a.copyPack(v)}>
										<ClipboardCopy />
										Copy pack
									</Button>
								</div>
								<pre data-selectable className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-xl border bg-subtle/60 p-3 font-sans text-[12px] leading-relaxed">
									{v.youtube?.description ?? "No description."}
								</pre>
								{v.youtube?.tags.length ? <p className="mt-2 text-[12px] text-muted-foreground">Tags: {v.youtube.tags.join(", ")}</p> : null}
							</div>
							<div>
								<h3 className="mb-2 text-[13px] font-semibold">Thumbnails</h3>
								{v.thumbnails[thumb] ? <img src={v.thumbnails[thumb]} alt={`Thumbnail ${thumb + 1}`} className="aspect-video w-full rounded-lg border object-cover" /> : null}
								<div className="mt-2 flex gap-2">
									{v.thumbnails.map((t, i) => (
										<button key={t} type="button" onClick={() => setThumb(i)} aria-label={`Thumbnail ${i + 1}`} aria-pressed={i === thumb} className={cn("w-1/3 overflow-hidden rounded-md border-2", i === thumb ? "border-primary" : "border-transparent opacity-70 hover:opacity-100")}>
											<img src={t} alt="" className="aspect-video w-full object-cover" />
										</button>
									))}
								</div>
								<p className="mt-2 text-[12px] text-muted-foreground">Three looks to test in YouTube Studio. The files are in the video folder.</p>
								<Button size="sm" variant="ghost" className="mt-1 -ml-2" onClick={() => a.reveal(v)}>
									<FolderOpen />
									Show in folder
								</Button>
							</div>
						</div>
					</div>
				</DialogContent>
			) : null}
		</Dialog>
	);
}

export function LibraryPage() {
	const version = useRenders((s) => s.libraryVersion);
	const [videos, setVideos] = useState<VideoView[] | null>(null);
	const [query, setQuery] = useState("");
	const [level, setLevel] = useState("all");
	const [sort, setSort] = useState<Sort>("new");
	const [view, setView] = useState<"grid" | "list">(() => (localStorage.getItem("library.view") === "list" ? "list" : "grid"));
	const [playing, setPlaying] = useState<VideoView | null>(null);
	const load = useCallback(() => void call(libraryChannels.videos).then(setVideos).catch((err) => toast.error("Could not load the videos", { description: errorText(err) })), []);
	useEffect(load, [load, version]);
	const a = useVideoActions(load);

	const levels = useMemo(() => [...new Set((videos ?? []).map((v) => v.level).filter(Boolean))].sort(), [videos]);
	const shown = useMemo(() => {
		const q = query.trim().toLowerCase();
		const list = (videos ?? []).filter((v) => (level === "all" || v.level === level) && (!q || v.title.toLowerCase().includes(q) || v.youtube?.tags.some((t) => t.includes(q))));
		const by: Record<Sort, (x: VideoView, y: VideoView) => number> = {
			new: (x, y) => y.createdAt.localeCompare(x.createdAt),
			old: (x, y) => x.createdAt.localeCompare(y.createdAt),
			long: (x, y) => y.durationMs - x.durationMs,
			title: (x, y) => x.title.localeCompare(y.title),
		};
		return list.sort(by[sort]);
	}, [videos, query, level, sort]);

	const setViewSaved = (v: "grid" | "list") => {
		setView(v);
		localStorage.setItem("library.view", v);
	};

	return (
		<div>
			<PageHeader
				title="Videos"
				description="Everything you have rendered, with its thumbnails, captions and YouTube description."
				actions={
					<div className="relative">
						<Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
						<Input placeholder="Search videos" aria-label="Search videos" className="w-64 pl-8" value={query} onChange={(e) => setQuery(e.target.value)} disabled={!videos?.length} />
					</div>
				}
			/>
			{videos && !videos.length ? (
				<EmptyState
					icon={Clapperboard}
					title="No videos yet"
					description="When a render finishes, the video lands here. You can play it, open its folder, copy the YouTube pack, or make a new version."
					actions={
						<Button asChild>
							<Link to="/drafts">
								<Plus />
								Render a draft
							</Link>
						</Button>
					}
				/>
			) : null}
			{videos?.length ? (
				<>
					<div className="mb-4 flex items-center gap-2">
						<Select
							ariaLabel="Filter by level"
							className="w-48"
							value={level}
							onChange={setLevel}
							options={[{ value: "all", label: "All levels" }, ...levels.map((l) => ({ value: l, label: l }))]}
						/>
						<Select ariaLabel="Sort" className="w-44" value={sort} onChange={setSort} options={SORTS} />
						<span className="ml-1 text-[12px] text-muted-foreground">
							{shown.length} of {videos.length}
						</span>
						<div className="ml-auto">
							<Segmented
								ariaLabel="View"
								value={view}
								onChange={setViewSaved}
								options={[
									{ value: "grid", label: "Grid", icon: LayoutGrid },
									{ value: "list", label: "List", icon: List },
								]}
							/>
						</div>
					</div>
					{!shown.length ? <p className="py-16 text-center text-[13px] text-muted-foreground">No video matches. Clear the search or the filter.</p> : null}
					{view === "grid" ? (
						<div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
							{shown.map((v) => (
								<Card key={v.id} className="group overflow-hidden p-0" data-testid="video-card">
									<Thumb v={v} onPlay={() => setPlaying(v)} />
									<div className="flex items-start gap-2 p-3">
										<div className="min-w-0 flex-1">
											<h3 className="line-clamp-2 text-[13px] font-semibold leading-snug">{v.title}</h3>
											<p className="mt-1 text-[12px] text-muted-foreground">
												{v.level ? `${v.level} · ` : ""}
												{resLabel(v)} · {timeAgo(v.createdAt)}
											</p>
										</div>
										<VideoMenu v={v} a={a} onPlay={() => setPlaying(v)} />
									</div>
								</Card>
							))}
						</div>
					) : (
						<Card className="overflow-hidden p-0">
							<ul className="divide-y">
								{shown.map((v) => (
									<li key={v.id} className="flex items-center gap-4 px-3 py-2.5" data-testid="video-row">
										<Thumb v={v} className="w-36 shrink-0 rounded-md" onPlay={() => setPlaying(v)} />
										<div className="min-w-0 flex-1">
											<h3 className="truncate text-[13px] font-semibold">{v.title}</h3>
											<p className="mt-0.5 text-[12px] text-muted-foreground">{v.level || "No level"}</p>
										</div>
										<span className="w-16 text-right text-[12px] tabular-nums text-muted-foreground">{resLabel(v)}</span>
										<span className="w-16 text-right text-[12px] tabular-nums text-muted-foreground">{bytes(v.sizeBytes)}</span>
										<span className="w-24 text-right text-[12px] text-muted-foreground">{timeAgo(v.createdAt)}</span>
										<VideoMenu v={v} a={a} onPlay={() => setPlaying(v)} />
									</li>
								))}
							</ul>
						</Card>
					)}
				</>
			) : null}
			<PlayerDialog v={playing} a={a} onClose={() => setPlaying(null)} />
			<RenderDialog draftId={a.renderFor} open={!!a.renderFor} onOpenChange={(o) => !o && a.setRenderFor(null)} />
		</div>
	);
}
