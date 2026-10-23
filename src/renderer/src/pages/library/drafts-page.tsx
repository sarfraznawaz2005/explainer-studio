import { Link, useNavigate } from "@tanstack/react-router";
import { Clapperboard, Copy, FileStack, GraduationCap, Library, MoreHorizontal, Plus, Search, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { LEVELS, type Level } from "@shared/ipc/ingest";
import { libraryChannels, type DraftBadge, type DraftSummary } from "@shared/ipc/library";
import { seriesChannels, type SeriesView } from "@shared/ipc/series";
import { Button } from "@renderer/components/ui/button";
import { confirm } from "@renderer/components/ui/confirm";
import { Dialog, DialogContent, DialogFooter } from "@renderer/components/ui/dialog";
import { Select } from "@renderer/components/ui/select";
import { Switch } from "@renderer/components/ui/switch";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, EmptyState } from "@renderer/components/ui/misc";
import { Badge, Card, Input, Label, PageHeader } from "@renderer/components/ui/primitives";
import { duration, timeAgo } from "@renderer/lib/format";
import { call, errorText } from "@renderer/lib/ipc";
import { useRenders } from "@renderer/stores/render";
import { RenderDialog } from "../studio/render-dialog";

const BADGE: Record<DraftBadge, { label: string; tone: "neutral" | "primary" | "success" | "warning" | "danger" }> = {
	source: { label: "Material added", tone: "neutral" },
	outline: { label: "Outline", tone: "neutral" },
	script: { label: "Script", tone: "neutral" },
	voice: { label: "Needs voice", tone: "warning" },
	ready: { label: "Ready to render", tone: "success" },
	rendering: { label: "Rendering", tone: "primary" },
	failed: { label: "Render failed", tone: "danger" },
	rendered: { label: "Rendered", tone: "success" },
};

/** "Make a KG version of this PhD video": same material, outline and script written again for the new level. */
function LevelDialog({ draft, onOpenChange }: { draft: DraftSummary | null; onOpenChange: (o: boolean) => void }) {
	const navigate = useNavigate();
	const [level, setLevel] = useState<Level | undefined>();
	const [busy, setBusy] = useState(false);
	useEffect(() => setLevel(undefined), [draft]);
	const make = async () => {
		if (!draft || !level) return;
		setBusy(true);
		try {
			const r = await call(libraryChannels.duplicateForLevel, { draftId: draft.id, level });
			onOpenChange(false);
			toast.success(`${level} version made`, { description: "Check the settings, then make the outline for the new level." });
			void navigate({ to: "/new", search: { draft: r.draftId } });
		} catch (err) {
			toast.error("Could not make the new version", { description: errorText(err) });
		} finally {
			setBusy(false);
		}
	};
	return (
		<Dialog open={!!draft} onOpenChange={onOpenChange}>
			<DialogContent
				title="Make a version for another level"
				description="A new draft with the same material. The AI writes a new outline and script for the level you pick. This draft does not change."
				className="w-[min(92vw,480px)]"
			>
				<div className="mt-4 space-y-1.5">
					<Label>Audience level</Label>
					<Select<Level>
						ariaLabel="Audience level for the new version"
						value={level}
						onChange={setLevel}
						placeholder="Choose a level"
						options={LEVELS.map((l) => ({ value: l, label: l, disabled: l === draft?.level, hint: l === draft?.level ? "Current level" : undefined }))}
					/>
				</div>
				<DialogFooter>
					<Button variant="ghost" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button onClick={() => void make()} loading={busy} disabled={!level} data-testid="level-make">
						<GraduationCap />
						Make version
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

/** Puts a draft into a series as its next episode. */
function SeriesPickDialog({ draft, onOpenChange, onDone }: { draft: DraftSummary | null; onOpenChange: (o: boolean) => void; onDone: () => void }) {
	const navigate = useNavigate();
	const [list, setList] = useState<SeriesView[] | null>(null);
	const [pick, setPick] = useState<string | undefined>();
	const [look, setLook] = useState(true);
	const [busy, setBusy] = useState(false);
	useEffect(() => {
		if (!draft) return;
		setPick(undefined);
		setLook(true);
		void call(seriesChannels.list)
			.then(setList)
			.catch(() => setList([]));
	}, [draft]);
	const choices = (list ?? []).filter((x) => x.id !== draft?.series?.id);
	const chosen = choices.find((x) => x.id === pick);
	const add = async () => {
		if (!draft || !pick) return;
		setBusy(true);
		try {
			const s = await call(seriesChannels.addDraft, { seriesId: pick, draftId: draft.id, applyLook: look });
			onOpenChange(false);
			onDone();
			toast.success(`Episode ${s.episodes.find((e) => e.draftId === draft.id)?.episode ?? ""} of ${s.title}`);
		} catch (err) {
			toast.error("Could not add to the series", { description: errorText(err) });
		} finally {
			setBusy(false);
		}
	};
	return (
		<Dialog open={!!draft} onOpenChange={onOpenChange}>
			<DialogContent title="Add to a series" description="The draft becomes the next episode. Episodes share one style, voice and brand kit." className="w-[min(92vw,480px)]">
				{list && !list.length ? (
					<p className="mt-4 text-[13px] text-muted-foreground">
						There is no series yet.{" "}
						<button type="button" className="font-medium text-primary hover:underline" onClick={() => void navigate({ to: "/series" })}>
							Make one on the Series page
						</button>
						.
					</p>
				) : (
					<div className="mt-4 space-y-3.5">
						<div className="space-y-1.5">
							<Label>Series</Label>
							<Select ariaLabel="Series" value={pick} onChange={setPick} placeholder={list ? "Choose a series" : "Loading…"} options={choices.map((x) => ({ value: x.id, label: `${x.title} (${x.episodes.length} episode${x.episodes.length === 1 ? "" : "s"})` }))} />
						</div>
						{chosen && (chosen.look.style || chosen.look.voice) ? (
							<label className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5">
								<span className="text-[13px]">
									Use the series style and voice
									<span className="block text-[12px] text-muted-foreground">A new voice means the voice is made again.</span>
								</span>
								<Switch checked={look} onChange={setLook} ariaLabel="Use the series style and voice" />
							</label>
						) : null}
					</div>
				)}
				<DialogFooter>
					<Button variant="ghost" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button onClick={() => void add()} loading={busy} disabled={!pick} data-testid="series-pick-add">
						<Library />
						Add to series
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

/** Planning stages continue in the wizard; drafts with a script open in the Studio. */
const inWizard = (d: DraftSummary) => d.badge === "source" || d.badge === "outline" || d.badge === "script";

export function DraftsPage() {
	const navigate = useNavigate();
	const version = useRenders((s) => s.libraryVersion);
	const jobs = useRenders((s) => s.queue);
	const [drafts, setDrafts] = useState<DraftSummary[] | null>(null);
	const [query, setQuery] = useState("");
	const [renderFor, setRenderFor] = useState<string | null>(null);
	const [levelFor, setLevelFor] = useState<DraftSummary | null>(null);
	const [seriesFor, setSeriesFor] = useState<DraftSummary | null>(null);
	const load = useCallback(() => void call(libraryChannels.drafts).then(setDrafts).catch((err) => toast.error("Could not load the drafts", { description: errorText(err) })), []);
	// Reload when the library changes and when a render job changes state (badges).
	const jobStates = jobs.map((j) => `${j.id}:${j.status}`).join();
	useEffect(load, [load, version, jobStates]);

	const shown = useMemo(() => {
		const q = query.trim().toLowerCase();
		return (drafts ?? []).filter((d) => !q || d.title.toLowerCase().includes(q) || d.level.toLowerCase().includes(q));
	}, [drafts, query]);

	const resume = (d: DraftSummary) => (inWizard(d) ? navigate({ to: "/new", search: { draft: d.id } }) : navigate({ to: "/studio", search: { draft: d.id } }));

	const duplicate = async (d: DraftSummary) => {
		try {
			const r = await call(libraryChannels.duplicateDraft, { draftId: d.id });
			toast.success("Draft duplicated", { description: `${d.title} (copy)`, action: { label: "Open", onClick: () => void navigate({ to: "/studio", search: { draft: r.draftId } }) } });
		} catch (err) {
			toast.error("Could not duplicate", { description: errorText(err) });
		}
	};

	const remove = async (d: DraftSummary) => {
		const ok = await confirm({
			title: "Delete this draft?",
			description: (
				<>
					<span className="font-medium text-foreground">{d.title}</span>: its outline, script and voice clips are deleted from this PC.
					{d.videos ? ` The ${d.videos === 1 ? "video" : `${d.videos} videos`} you rendered from it stay in Videos.` : ""}
				</>
			),
			tone: "danger",
			confirmLabel: "Delete draft",
		});
		if (!ok) return;
		try {
			await call(libraryChannels.removeDraft, { draftId: d.id });
			toast.success("Draft deleted");
			load();
		} catch (err) {
			toast.error("Could not delete", { description: errorText(err) });
		}
	};

	return (
		<div>
			<PageHeader
				title="Drafts"
				description="Unfinished videos. Pick up any draft right where you left it."
				actions={
					<div className="flex items-center gap-2">
						<div className="relative">
							<Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
							<Input placeholder="Search drafts" aria-label="Search drafts" className="w-56 pl-8" value={query} onChange={(e) => setQuery(e.target.value)} disabled={!drafts?.length} />
						</div>
						<Button asChild>
							<Link to="/new">
								<Plus />
								New video
							</Link>
						</Button>
					</div>
				}
			/>
			{drafts && !drafts.length ? (
				<EmptyState icon={FileStack} title="No drafts" description="A draft is saved as soon as you add material. Each one shows its stage: outline, script, voice, or ready to render." />
			) : null}
			{drafts?.length ? (
				<Card className="overflow-hidden p-0">
					{!shown.length ? <p className="py-12 text-center text-[13px] text-muted-foreground">No draft matches the search.</p> : null}
					<ul className="divide-y">
						{shown.map((d) => {
							const b = BADGE[d.badge];
							const canRender = !inWizard(d) && d.badge !== "rendering";
							return (
								<li key={d.id} className="flex items-center gap-4 px-4 py-3" data-testid="draft-row">
									<button type="button" className="min-w-0 flex-1 text-left" onClick={() => void resume(d)}>
										<div className="flex items-center gap-2">
											<span className="truncate text-[14px] font-semibold hover:underline">{d.title}</span>
											<Badge tone={b.tone} data-testid="draft-badge">
												{b.label}
											</Badge>
											{d.series ? (
												<Badge tone="neutral" data-testid="draft-series">
													Ep. {d.series.episode} · {d.series.title}
												</Badge>
											) : null}
										</div>
										<div className="mt-0.5 text-[12px] text-muted-foreground">
											{d.level}
											{d.chapters ? ` · ${d.chapters} chapter${d.chapters === 1 ? "" : "s"} · ${d.scenes} scene${d.scenes === 1 ? "" : "s"} · ${duration(d.durationMs)}` : ""}
											{d.sentences ? ` · voice ${d.voiced} of ${d.sentences}` : ""}
											{d.videos ? ` · ${d.videos} video${d.videos === 1 ? "" : "s"}` : ""}
										</div>
									</button>
									<span className="w-24 shrink-0 text-right text-[12px] text-muted-foreground">{timeAgo(d.updatedAt)}</span>
									<Button size="sm" variant="outline" onClick={() => void resume(d)}>
										{inWizard(d) ? "Continue" : "Open"}
									</Button>
									<DropdownMenu>
										<DropdownMenuTrigger asChild>
											<Button variant="ghost" size="icon-sm" aria-label={`Actions for ${d.title}`}>
												<MoreHorizontal />
											</Button>
										</DropdownMenuTrigger>
										<DropdownMenuContent>
											{canRender ? (
												<DropdownMenuItem icon={Clapperboard} onSelect={() => setRenderFor(d.id)}>
													Render
												</DropdownMenuItem>
											) : null}
											<DropdownMenuItem icon={Copy} onSelect={() => void duplicate(d)}>
												Duplicate
											</DropdownMenuItem>
											<DropdownMenuItem icon={GraduationCap} onSelect={() => setLevelFor(d)}>
												Version for another level…
											</DropdownMenuItem>
											<DropdownMenuItem icon={Library} onSelect={() => setSeriesFor(d)}>
												{d.series ? "Move to another series…" : "Add to series…"}
											</DropdownMenuItem>
											<DropdownMenuSeparator />
											<DropdownMenuItem icon={Trash2} danger onSelect={() => void remove(d)}>
												Delete
											</DropdownMenuItem>
										</DropdownMenuContent>
									</DropdownMenu>
								</li>
							);
						})}
					</ul>
				</Card>
			) : null}
			<RenderDialog draftId={renderFor} open={!!renderFor} onOpenChange={(o) => !o && setRenderFor(null)} />
			<LevelDialog draft={levelFor} onOpenChange={(o) => !o && setLevelFor(null)} />
			<SeriesPickDialog draft={seriesFor} onOpenChange={(o) => !o && setSeriesFor(null)} onDone={load} />
		</div>
	);
}
