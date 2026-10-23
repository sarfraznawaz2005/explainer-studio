import { Link } from "@tanstack/react-router";
import { Download, Globe, Image, Mic, MoreHorizontal, Music, Pencil, Scale, Search, Square, Star, Trash2, Type, Upload, Waves, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { MOODS, type AssetKind, type AssetView, type Mood } from "@shared/assets";
import { assetChannels } from "@shared/ipc/assets";
import { voiceChannels, type Voice } from "@shared/ipc/voice";
import { Button } from "@renderer/components/ui/button";
import { confirm } from "@renderer/components/ui/confirm";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, EmptyState, Segmented } from "@renderer/components/ui/misc";
import { Badge, Card, Input, PageHeader, Tooltip } from "@renderer/components/ui/primitives";
import { Select } from "@renderer/components/ui/select";
import { bytes } from "@renderer/lib/format";
import { call, errorText } from "@renderer/lib/ipc";
import { cn } from "@renderer/lib/utils";
import { useAssets, usePreviewAudio } from "@renderer/stores/assets";
import { duration, EditDialog, ENERGY_LABEL, FreesoundDialog, ImportDialog, KIND_LABEL, LicenseBadge, LicenseDialog, MOOD_LABEL, PlayButton } from "./asset-dialogs";

type Tab = AssetKind | "voices";

const TABS: { value: Tab; label: string; icon: LucideIcon; title: string; text: string }[] = [
	{ value: "music", label: "Music", icon: Music, title: "No music yet", text: "Royalty-free tracks for your videos. Install the free starter pack, import your own, or search Freesound." },
	{ value: "sfx", label: "Sound effects", icon: Waves, title: "No sound effects yet", text: "Clicks, pops, whooshes and dings that play with scene animations. Reused across every video." },
	{ value: "voices", label: "Voices", icon: Mic, title: "No voices installed", text: "Natural narration voices that run on your PC, free and offline." },
	{ value: "font", label: "Fonts", icon: Type, title: "No custom fonts", text: "Add fonts to match your channel. Built-in fonts are always available." },
	{ value: "image", label: "Brand images", icon: Image, title: "No images", text: "Logos, watermarks and backgrounds for your brand kit." },
];

/* ---------- Starter pack banner ---------- */

function StarterCard() {
	const { starter, refreshStarter, version } = useAssets();
	// Re-check after every library change: deleting a starter file makes the pack incomplete.
	useEffect(() => {
		void refreshStarter();
	}, [refreshStarter, version]);
	if (!starter || starter.state === "installed") return null;
	const installing = starter.state === "installing";
	const pct = starter.bytesTotal ? Math.round((starter.bytesDone / starter.bytesTotal) * 100) : 0;
	const start = () => call(assetChannels.starterInstall).catch((err) => toast.error("Could not start the download", { description: errorText(err) }));
	const stop = async () => {
		const ok = await confirm({ title: "Stop the starter pack download?", description: "Files already added stay in your library. You can finish the download later.", confirmLabel: "Stop download", cancelLabel: "Keep going" });
		if (ok) await call(assetChannels.starterCancel);
	};
	const headline =
		starter.state === "failed"
			? "The starter pack download failed"
			: starter.state === "partial" || starter.state === "cancelled"
				? `Starter pack: ${starter.done} of ${starter.total} files`
				: installing
					? "Downloading the starter pack…"
					: "Get the free starter pack";
	return (
		<Card className={cn("mb-5 overflow-hidden", starter.state === "failed" && "border-danger/30")} data-testid="starter-card">
			<div className="flex items-center gap-4 p-4">
				<div className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary-soft-foreground">
					<Download className="size-5" />
				</div>
				<div className="min-w-0 flex-1">
					<p className="text-[14px] font-semibold">{headline}</p>
					<p className="mt-0.5 truncate text-[12px] text-muted-foreground">
						{starter.state === "failed"
							? starter.error
							: installing
								? `${starter.detail ?? "Starting"} · ${bytes(starter.bytesDone)} of ${bytes(starter.bytesTotal)}`
								: `12 music tracks from FreePD and 24 sound effects from Kenney. All public domain or CC0, so no credit is needed. About ${bytes(starter.bytesTotal)}.`}
					</p>
				</div>
				{installing ? (
					<Button variant="outline" size="sm" onClick={() => void stop()}>
						<Square className="fill-current" />
						Stop
					</Button>
				) : (
					<Button size="sm" onClick={() => void start()}>
						<Download />
						{starter.state === "none" ? "Download" : starter.state === "failed" ? "Try again" : "Finish download"}
					</Button>
				)}
			</div>
			{installing ? (
				<div className="h-1 bg-muted" role="progressbar" aria-label="Starter pack download" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
					<div className="h-full bg-primary transition-[width] duration-300" style={{ width: `${pct}%` }} />
				</div>
			) : null}
		</Card>
	);
}

/* ---------- One library row ---------- */

function AssetRow({ a, onEdit, onLicense, onDelete, onFavorite }: { a: AssetView; onEdit: () => void; onLicense: () => void; onDelete: () => void; onFavorite: () => void }) {
	const audio = a.kind === "music" || a.kind === "sfx";
	return (
		<li className="group flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-subtle/60">
			{audio ? (
				<PlayButton url={a.url} label={a.title} />
			) : a.kind === "image" ? (
				<img src={a.url} alt="" className="size-8 rounded-md border object-cover" loading="lazy" />
			) : (
				<FontSample url={a.url} />
			)}
			<div className="min-w-0 flex-1">
				<div className="truncate text-[13px] font-medium">{a.title}</div>
				<div className="truncate text-[12px] text-muted-foreground">
					{[a.author, a.pack ?? (a.source === "import" ? "Imported" : null)].filter(Boolean).join(" · ") || "—"}
				</div>
			</div>
			<div className="hidden flex-wrap items-center justify-end gap-1.5 min-[1100px]:flex">
				{a.mood ? <Badge tone="primary">{MOOD_LABEL[a.mood]}</Badge> : null}
				{a.energy ? <Badge>{ENERGY_LABEL[a.energy]}</Badge> : null}
				{a.bpm ? <Badge>{a.bpm} BPM</Badge> : null}
			</div>
			<span className="w-14 text-right text-[12px] tabular-nums text-muted-foreground">{audio ? duration(a.durationMs) : bytes(a.bytes)}</span>
			<button onClick={onLicense} className="rounded-full" aria-label={`License for ${a.title}`}>
				<LicenseBadge code={a.license} />
			</button>
			<Tooltip content={a.favorite ? "Remove from favourites" : "Add to favourites"}>
				<Button variant="ghost" size="icon-sm" aria-label={`Favourite ${a.title}`} aria-pressed={a.favorite} onClick={onFavorite}>
					<Star className={cn(a.favorite ? "fill-warning text-warning" : "text-muted-foreground")} />
				</Button>
			</Tooltip>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button variant="ghost" size="icon-sm" aria-label={`More actions for ${a.title}`}>
						<MoreHorizontal />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent>
					<DropdownMenuItem icon={Pencil} onSelect={onEdit}>
						Edit details
					</DropdownMenuItem>
					<DropdownMenuItem icon={Scale} onSelect={onLicense}>
						License and credit
					</DropdownMenuItem>
					<DropdownMenuSeparator />
					<DropdownMenuItem icon={Trash2} danger onSelect={onDelete}>
						Delete
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		</li>
	);
}

/** "Aa" in the font itself. */
function FontSample({ url }: { url: string }) {
	const [family, setFamily] = useState<string | null>(null);
	useEffect(() => {
		const name = `asset-${url.split("/").pop()!.slice(0, 12)}`;
		const face = new FontFace(name, `url(${url})`);
		face
			.load()
			.then((f) => {
				document.fonts.add(f);
				setFamily(name);
			})
			.catch(() => setFamily(null));
	}, [url]);
	return (
		<span className="grid size-8 place-items-center rounded-md border bg-card text-[15px]" style={family ? { fontFamily: family } : undefined} aria-hidden>
			Aa
		</span>
	);
}

/* ---------- Voices tab ---------- */

function VoicesTab() {
	const [voices, setVoices] = useState<Voice[] | null>(null);
	useEffect(() => {
		void call(voiceChannels.voices)
			.then(setVoices)
			.catch(() => setVoices([]));
	}, []);
	if (voices === null) return null;
	if (!voices.length)
		return (
			<EmptyState
				icon={Mic}
				title="No voices installed"
				description="Install the free voice engine to get natural narration voices that run on your PC."
				actions={
					<Button asChild>
						<Link to="/settings" search={{ section: "voice" }}>
							Set up voice
						</Link>
					</Button>
				}
			/>
		);
	return (
		<Card>
			<ul className="divide-y">
				{voices.map((v) => (
					<li key={v.id} className="flex items-center gap-3 px-4 py-2.5">
						<div className="grid size-8 place-items-center rounded-full bg-muted text-muted-foreground">
							<Mic className="size-4" />
						</div>
						<div className="min-w-0 flex-1">
							<div className="text-[13px] font-medium">{v.name}</div>
							<div className="text-[12px] text-muted-foreground">
								{v.group} · {v.gender}
							</div>
						</div>
						{v.recommended ? <Badge tone="primary">Recommended</Badge> : null}
						<Badge tone="success">{v.engine === "piper" ? "MIT" : "Apache 2.0"}</Badge>
					</li>
				))}
			</ul>
			<div className="border-t px-4 py-2.5 text-[12px] text-muted-foreground">
				Kokoro voices, plus Piper voices for Urdu. Pick the default voice and listen to samples in{" "}
				<Link to="/settings" search={{ section: "voice" }} className="font-medium text-primary hover:underline">
					Settings → Voice
				</Link>
				.
			</div>
		</Card>
	);
}

/* ---------- Page ---------- */

export function AssetsPage() {
	const [tab, setTab] = useState<Tab>("music");
	const [all, setAll] = useState<AssetView[] | null>(null);
	const [query, setQuery] = useState("");
	const [mood, setMood] = useState<Mood | "all">("all");
	const [favOnly, setFavOnly] = useState(false);
	const [importing, setImporting] = useState(false);
	const [searching, setSearching] = useState(false);
	const [editing, setEditing] = useState<AssetView | null>(null);
	const [licensing, setLicensing] = useState<AssetView | null>(null);
	const version = useAssets((s) => s.version);
	const stopAudio = usePreviewAudio((s) => s.stop);

	const load = useCallback(async () => {
		try {
			setAll(await call(assetChannels.list));
		} catch (err) {
			toast.error("Could not load assets", { description: errorText(err) });
			setAll([]);
		}
	}, []);
	useEffect(() => {
		void load();
	}, [load, version]);
	useEffect(() => stopAudio, [stopAudio]);

	const counts = useMemo(() => {
		const c: Record<string, number> = {};
		for (const a of all ?? []) c[a.kind] = (c[a.kind] ?? 0) + 1;
		return c;
	}, [all]);

	const shown = useMemo(() => {
		const q = query.trim().toLowerCase();
		return (all ?? []).filter(
			(a) =>
				a.kind === tab &&
				(!favOnly || a.favorite) &&
				(mood === "all" || a.mood === mood) &&
				(!q || a.title.toLowerCase().includes(q) || a.tags.some((t) => t.includes(q)) || (a.author ?? "").toLowerCase().includes(q)),
		);
	}, [all, tab, favOnly, mood, query]);

	const active = TABS.find((t) => t.value === tab)!;
	const kind = tab === "voices" ? null : tab;
	const mixKind = tab === "music" || tab === "sfx" ? tab : null;

	const favorite = async (a: AssetView) => {
		setAll((list) => list?.map((x) => (x.id === a.id ? { ...x, favorite: !a.favorite } : x)) ?? null);
		await call(assetChannels.update, { id: a.id, patch: { favorite: !a.favorite } }).catch((err) => {
			toast.error("Could not update", { description: errorText(err) });
			void load();
		});
	};

	const remove = async (a: AssetView) => {
		const { drafts } = await call(assetChannels.usage, { id: a.id });
		const used = drafts.length
			? ` It is used in ${drafts.length === 1 ? `the draft "${drafts[0]}"` : `${drafts.length} drafts`}. Those drafts will pick another track or sound automatically.`
			: "";
		const ok = await confirm({ title: `Delete "${a.title}"?`, description: `The file is removed from your library.${used} This cannot be undone.`, tone: "danger", confirmLabel: "Delete" });
		if (!ok) return;
		try {
			stopAudio();
			await call(assetChannels.remove, { id: a.id });
			toast.success("Deleted", { description: a.title });
		} catch (err) {
			toast.error("Could not delete", { description: errorText(err) });
		}
	};

	return (
		<div>
			<PageHeader
				title="Assets"
				description="Music, sound effects, voices and more. Every item keeps its license."
				actions={
					kind ? (
						<>
							{mixKind ? (
								<Button variant="outline" onClick={() => setSearching(true)}>
									<Globe />
									Search Freesound
								</Button>
							) : null}
							<Button onClick={() => setImporting(true)}>
								<Upload />
								Import
							</Button>
						</>
					) : null
				}
			/>
			<StarterCard />
			<div className="mb-4 flex flex-wrap items-center gap-3">
				<Segmented
					ariaLabel="Asset type"
					value={tab}
					onChange={(t) => {
						setTab(t);
						setMood("all");
					}}
					options={TABS.map((t) => ({ value: t.value, label: t.value !== "voices" && counts[t.value] ? `${t.label} ${counts[t.value]}` : t.label, icon: t.icon }))}
				/>
				{kind ? (
					<div className="ml-auto flex items-center gap-2">
						{tab === "music" ? (
							<Select ariaLabel="Filter by mood" className="w-36" value={mood} onChange={setMood} options={[{ value: "all", label: "All moods" }, ...MOODS.map((m) => ({ value: m, label: MOOD_LABEL[m] }))]} />
						) : null}
						<Tooltip content="Show favourites only">
							<Button variant={favOnly ? "secondary" : "ghost"} size="icon" aria-label="Show favourites only" aria-pressed={favOnly} onClick={() => setFavOnly((v) => !v)}>
								<Star className={cn(favOnly && "fill-warning text-warning")} />
							</Button>
						</Tooltip>
						<div className="relative">
							<Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
							<Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${KIND_LABEL[kind]}`} className="w-56 pl-8" aria-label={`Search ${KIND_LABEL[kind]}`} />
						</div>
					</div>
				) : null}
			</div>

			{tab === "voices" ? (
				<VoicesTab />
			) : all === null ? null : shown.length ? (
				<Card>
					<ul className="divide-y" aria-label={active.label}>
						{shown.map((a) => (
							<AssetRow key={a.id} a={a} onEdit={() => setEditing(a)} onLicense={() => setLicensing(a)} onDelete={() => void remove(a)} onFavorite={() => void favorite(a)} />
						))}
					</ul>
				</Card>
			) : counts[tab] ? (
				<EmptyState icon={Search} title="Nothing matches" description="Try other words, another mood, or turn off the favourites filter." />
			) : (
				<EmptyState
					icon={active.icon}
					title={active.title}
					description={active.text}
					actions={
						kind ? (
							<>
								<Button onClick={() => setImporting(true)}>
									<Upload />
									Import {KIND_LABEL[kind]}
								</Button>
								{mixKind ? (
									<Button variant="outline" onClick={() => setSearching(true)}>
										<Globe />
										Search Freesound
									</Button>
								) : null}
							</>
						) : null
					}
				/>
			)}

			{kind ? <ImportDialog kind={kind} open={importing} onOpenChange={setImporting} /> : null}
			<FreesoundDialog open={searching} onOpenChange={setSearching} initialKind={mixKind ?? "sfx"} />
			<EditDialog asset={editing} onOpenChange={(o) => !o && setEditing(null)} />
			<LicenseDialog asset={licensing} onOpenChange={(o) => !o && setLicensing(null)} />
		</div>
	);
}
