import { useNavigate } from "@tanstack/react-router";
import { ArrowDown, ArrowUp, Clapperboard, FileStack, Library, MoreHorizontal, Pencil, Plus, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { STYLE_LABELS } from "@shared/plan/schema";
import type { BrandKitView } from "@shared/brand";
import { brandChannels } from "@shared/ipc/brand";
import { libraryChannels, type DraftSummary } from "@shared/ipc/library";
import { seriesChannels, type Episode, type SeriesView } from "@shared/ipc/series";
import { Button } from "@renderer/components/ui/button";
import { confirm } from "@renderer/components/ui/confirm";
import { Dialog, DialogContent, DialogFooter } from "@renderer/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, EmptyState } from "@renderer/components/ui/misc";
import { Badge, Card, Input, Label, PageHeader, Textarea, Tooltip } from "@renderer/components/ui/primitives";
import { Select } from "@renderer/components/ui/select";
import { Switch } from "@renderer/components/ui/switch";
import { duration } from "@renderer/lib/format";
import { call, errorText } from "@renderer/lib/ipc";
import { useRenders } from "@renderer/stores/render";

const DEFAULT_KIT = "__default__";
/** "af_heart" → "Heart". */
const voiceLabel = (id: string) => {
	const n = id.split("_")[1] ?? id;
	return n.charAt(0).toUpperCase() + n.slice(1);
};

function SeriesDialog({ open, onOpenChange, series, kits, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; series: SeriesView | null; kits: BrandKitView[]; onSaved: (s: SeriesView) => void }) {
	const [title, setTitle] = useState("");
	const [description, setDescription] = useState("");
	const [kit, setKit] = useState(DEFAULT_KIT);
	const [busy, setBusy] = useState(false);
	useEffect(() => {
		if (!open) return;
		setTitle(series?.title ?? "");
		setDescription(series?.description ?? "");
		setKit(series?.brandKitId ?? DEFAULT_KIT);
	}, [open, series]);
	const save = async () => {
		if (!title.trim()) return;
		setBusy(true);
		try {
			const form = { title: title.trim(), description: description.trim(), brandKitId: kit === DEFAULT_KIT ? null : kit };
			const s = series ? await call(seriesChannels.update, { id: series.id, form }) : await call(seriesChannels.create, form);
			onOpenChange(false);
			onSaved(s);
		} catch (err) {
			toast.error("Could not save the series", { description: errorText(err) });
		} finally {
			setBusy(false);
		}
	};
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent title={series ? "Edit series" : "New series"} description="A series groups videos under one name and numbers them as episodes. Episodes share one style, voice and brand kit." className="w-[min(92vw,500px)]">
				<div className="mt-4 space-y-3.5">
					<div className="space-y-1.5">
						<Label htmlFor="series-title">Name</Label>
						<Input id="series-title" autoFocus value={title} maxLength={120} placeholder="For example: Class 11 Computer Science, Unit 2" onChange={(e) => setTitle(e.target.value)} data-testid="series-title" />
					</div>
					<div className="space-y-1.5">
						<Label htmlFor="series-desc">Description (optional)</Label>
						<Textarea id="series-desc" value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} className="min-h-16 text-[13px]" />
					</div>
					<div className="space-y-1.5">
						<Label>Brand kit</Label>
						<Select
							ariaLabel="Brand kit for this series"
							value={kit}
							onChange={setKit}
							options={[{ value: DEFAULT_KIT, label: kits.length ? "The default kit" : "The default kit (none yet)" }, ...kits.map((k) => ({ value: k.id, label: k.name }))]}
						/>
					</div>
				</div>
				<DialogFooter>
					<Button variant="ghost" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button onClick={() => void save()} loading={busy} disabled={!title.trim()} data-testid="series-save">
						{series ? "Save" : "Create series"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function AddDraftDialog({ series, open, onOpenChange, onAdded }: { series: SeriesView | null; open: boolean; onOpenChange: (o: boolean) => void; onAdded: (s: SeriesView) => void }) {
	const [drafts, setDrafts] = useState<DraftSummary[] | null>(null);
	const [pick, setPick] = useState<string | undefined>();
	const [look, setLook] = useState(true);
	const [busy, setBusy] = useState(false);
	useEffect(() => {
		if (!open) return;
		setPick(undefined);
		setLook(true);
		void call(libraryChannels.drafts)
			.then(setDrafts)
			.catch(() => setDrafts([]));
	}, [open]);
	const choices = (drafts ?? []).filter((d) => d.series?.id !== series?.id);
	const hasLook = !!(series?.look.style || series?.look.voice);
	const add = async () => {
		if (!series || !pick) return;
		setBusy(true);
		try {
			const s = await call(seriesChannels.addDraft, { seriesId: series.id, draftId: pick, applyLook: look });
			onOpenChange(false);
			onAdded(s);
			toast.success(`Added as episode ${s.episodes.find((e) => e.draftId === pick)?.episode ?? ""}`);
		} catch (err) {
			toast.error("Could not add the draft", { description: errorText(err) });
		} finally {
			setBusy(false);
		}
	};
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent title="Add an episode" description={series ? `The draft becomes the next episode of "${series.title}".` : ""} className="w-[min(92vw,520px)]">
				<div className="mt-4 space-y-3.5">
					<div className="space-y-1.5">
						<Label>Draft</Label>
						<Select
							ariaLabel="Draft to add"
							value={pick}
							onChange={setPick}
							placeholder={drafts === null ? "Loading…" : choices.length ? "Choose a draft" : "No other drafts"}
							disabled={!choices.length}
							options={choices.map((d) => ({ value: d.id, label: `${d.title} · ${d.level}${d.series ? ` (now in ${d.series.title})` : ""}` }))}
						/>
					</div>
					{hasLook ? (
						<label className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5">
							<span className="text-[13px]">
								Use the series style and voice
								<span className="block text-[12px] text-muted-foreground">
									{[series?.look.style ? STYLE_LABELS[series.look.style] : null, series?.look.voice ? voiceLabel(series.look.voice.voice) : null].filter(Boolean).join(" · ")}. A new voice means the voice is made again.
								</span>
							</span>
							<Switch checked={look} onChange={setLook} ariaLabel="Use the series style and voice" />
						</label>
					) : (
						<p className="text-[12px] text-muted-foreground">This is the first episode. Its style and voice become the series look.</p>
					)}
				</div>
				<DialogFooter>
					<Button variant="ghost" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button onClick={() => void add()} loading={busy} disabled={!pick} data-testid="episode-add">
						<Plus />
						Add episode
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function EpisodeRow({ e, first, last, onMove, onRemove, onOpen }: { e: Episode; first: boolean; last: boolean; onMove: (by: -1 | 1) => void; onRemove: () => void; onOpen: () => void }) {
	return (
		<li className="flex items-center gap-3 px-4 py-2.5" data-testid="episode-row">
			<span className="w-12 shrink-0 text-[12px] font-semibold tabular-nums text-muted-foreground" data-testid="episode-number">
				Ep. {e.episode}
			</span>
			<div className="flex aspect-video w-20 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted text-muted-foreground">
				{e.video?.thumbnail ? <img src={e.video.thumbnail} alt="" className="size-full object-cover" /> : <FileStack className="size-4" />}
			</div>
			<button type="button" className="min-w-0 flex-1 text-left" onClick={onOpen}>
				<div className="truncate text-[13.5px] font-semibold hover:underline">{e.title}</div>
				<div className="text-[12px] text-muted-foreground">
					{e.level}
					{e.durationMs ? ` · ${duration(e.durationMs)}` : ""}
					{e.video ? " · rendered" : ""}
				</div>
			</button>
			<Tooltip content="Move up">
				<Button variant="ghost" size="icon-sm" aria-label="Move up" disabled={first} onClick={() => onMove(-1)}>
					<ArrowUp />
				</Button>
			</Tooltip>
			<Tooltip content="Move down">
				<Button variant="ghost" size="icon-sm" aria-label="Move down" disabled={last} onClick={() => onMove(1)}>
					<ArrowDown />
				</Button>
			</Tooltip>
			<Tooltip content="Take out of the series">
				<Button variant="ghost" size="icon-sm" aria-label={`Take ${e.title} out of the series`} onClick={onRemove}>
					<X />
				</Button>
			</Tooltip>
		</li>
	);
}

export function SeriesPage() {
	const navigate = useNavigate();
	const version = useRenders((s) => s.libraryVersion);
	const [list, setList] = useState<SeriesView[] | null>(null);
	const [kits, setKits] = useState<BrandKitView[]>([]);
	const [editing, setEditing] = useState<SeriesView | null | "new">(null);
	const [adding, setAdding] = useState<SeriesView | null>(null);
	const load = useCallback(() => void call(seriesChannels.list).then(setList).catch((err) => toast.error("Could not load the series", { description: errorText(err) })), []);
	useEffect(load, [load, version]);
	useEffect(() => void call(brandChannels.list).then(setKits).catch(() => setKits([])), []);
	const kitName = useMemo(() => new Map(kits.map((k) => [k.id, k.name])), [kits]);
	const replace = (s: SeriesView) => setList((l) => (l ? (l.some((x) => x.id === s.id) ? l.map((x) => (x.id === s.id ? s : x)) : [s, ...l]) : [s]));

	const move = async (draftId: string, by: -1 | 1) => {
		try {
			replace(await call(seriesChannels.move, { draftId, by }));
		} catch (err) {
			toast.error("Could not move the episode", { description: errorText(err) });
		}
	};
	const takeOut = async (s: SeriesView, e: Episode) => {
		const ok = await confirm({
			title: "Take this episode out?",
			description: (
				<>
					<span className="font-medium text-foreground">{e.title}</span> leaves "{s.title}". The draft and its videos are kept. The other episodes are numbered again.
				</>
			),
			confirmLabel: "Take out",
		});
		if (!ok) return;
		try {
			await call(seriesChannels.removeDraft, { draftId: e.draftId });
			load();
		} catch (err) {
			toast.error("Could not take it out", { description: errorText(err) });
		}
	};
	const remove = async (s: SeriesView) => {
		const ok = await confirm({
			title: "Delete this series?",
			description: (
				<>
					<span className="font-medium text-foreground">{s.title}</span> is deleted. Its {s.episodes.length} draft{s.episodes.length === 1 ? "" : "s"} and all videos are kept, outside any series.
				</>
			),
			tone: "danger",
			confirmLabel: "Delete series",
		});
		if (!ok) return;
		try {
			await call(seriesChannels.remove, { id: s.id });
			toast.success("Series deleted");
			load();
		} catch (err) {
			toast.error("Could not delete", { description: errorText(err) });
		}
	};
	const open = (e: Episode) => (e.badge === "source" || e.badge === "outline" || e.badge === "script" ? navigate({ to: "/new", search: { draft: e.draftId } }) : navigate({ to: "/studio", search: { draft: e.draftId } }));

	return (
		<div>
			<PageHeader
				title="Series"
				description="Group videos into numbered episodes that share one style, voice and brand kit."
				actions={
					<Button onClick={() => setEditing("new")} data-testid="series-new">
						<Plus />
						New series
					</Button>
				}
			/>
			{list && !list.length ? (
				<EmptyState
					icon={Library}
					title="No series yet"
					description='Make a series for a course or a unit, for example "Class 11 CS – Unit 2". Add drafts as episodes; they are numbered for you.'
					actions={
						<Button onClick={() => setEditing("new")}>
							<Plus />
							New series
						</Button>
					}
				/>
			) : null}
			<div className="space-y-4">
				{list?.map((s) => (
					<Card key={s.id} className="overflow-hidden p-0" data-testid="series-card">
						<div className="flex items-start justify-between gap-4 border-b px-4 py-3.5">
							<div className="min-w-0">
								<div className="flex items-center gap-2">
									<h2 className="truncate text-[15px] font-semibold">{s.title}</h2>
									<Badge tone="neutral">
										{s.episodes.length} episode{s.episodes.length === 1 ? "" : "s"}
									</Badge>
								</div>
								{s.description ? <p className="mt-0.5 line-clamp-2 text-[12.5px] text-muted-foreground">{s.description}</p> : null}
								<div className="mt-1.5 flex flex-wrap gap-1.5 text-[11.5px] text-muted-foreground">
									{s.look.style ? <span className="rounded-md bg-muted px-1.5 py-0.5">Style: {STYLE_LABELS[s.look.style]}</span> : null}
									{s.look.voice ? <span className="rounded-md bg-muted px-1.5 py-0.5">Voice: {voiceLabel(s.look.voice.voice)}</span> : null}
									<span className="rounded-md bg-muted px-1.5 py-0.5">Brand: {s.brandKitId ? (kitName.get(s.brandKitId) ?? "kit") : "default kit"}</span>
									{s.videosWithoutDraft ? <span className="rounded-md bg-muted px-1.5 py-0.5">{s.videosWithoutDraft} older video(s) without a draft</span> : null}
								</div>
							</div>
							<div className="flex shrink-0 items-center gap-1.5">
								<Button variant="outline" size="sm" onClick={() => setAdding(s)} data-testid="series-add-episode">
									<Plus />
									Add episode
								</Button>
								<DropdownMenu>
									<DropdownMenuTrigger asChild>
										<Button variant="ghost" size="icon-sm" aria-label={`Actions for ${s.title}`}>
											<MoreHorizontal />
										</Button>
									</DropdownMenuTrigger>
									<DropdownMenuContent>
										<DropdownMenuItem icon={Pencil} onSelect={() => setEditing(s)}>
											Edit
										</DropdownMenuItem>
										<DropdownMenuSeparator />
										<DropdownMenuItem icon={Trash2} danger onSelect={() => void remove(s)}>
											Delete series
										</DropdownMenuItem>
									</DropdownMenuContent>
								</DropdownMenu>
							</div>
						</div>
						{s.episodes.length ? (
							<ul className="divide-y">
								{s.episodes.map((e, i) => (
									<EpisodeRow key={e.draftId} e={e} first={i === 0} last={i === s.episodes.length - 1} onMove={(by) => void move(e.draftId, by)} onRemove={() => void takeOut(s, e)} onOpen={() => void open(e)} />
								))}
							</ul>
						) : (
							<p className="flex items-center gap-2 px-4 py-6 text-[13px] text-muted-foreground">
								<Clapperboard className="size-4" /> No episodes yet. Click Add episode to put a draft in this series.
							</p>
						)}
					</Card>
				))}
			</div>
			<SeriesDialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)} series={editing === "new" ? null : editing} kits={kits} onSaved={replace} />
			<AddDraftDialog series={adding} open={!!adding} onOpenChange={(o) => !o && setAdding(null)} onAdded={replace} />
		</div>
	);
}
