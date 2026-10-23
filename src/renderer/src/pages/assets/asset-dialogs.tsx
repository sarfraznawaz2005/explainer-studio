import { Link } from "@tanstack/react-router";
import { Check, Download, ExternalLink, FolderOpen, KeyRound, Loader2, Pause, Play, Search, ShieldCheck, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { LICENSES, MOODS, type AssetKind, type AssetView, type Energy, type FreesoundResults, type LicenseCode, type Mood } from "@shared/assets";
import { assetChannels } from "@shared/ipc/assets";
import { Button } from "@renderer/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@renderer/components/ui/dialog";
import { Segmented } from "@renderer/components/ui/misc";
import { Badge, Input, Label } from "@renderer/components/ui/primitives";
import { Select } from "@renderer/components/ui/select";
import { call, errorText } from "@renderer/lib/ipc";
import { cn } from "@renderer/lib/utils";
import { usePreviewAudio } from "@renderer/stores/assets";

export const KIND_LABEL: Record<AssetKind, string> = { music: "music", sfx: "sound effects", image: "images", font: "fonts" };
export const MOOD_LABEL: Record<Mood, string> = { calm: "Calm", upbeat: "Upbeat", curious: "Curious", dramatic: "Dramatic", playful: "Playful", ambient: "Ambient" };
const ENERGY_LABEL: Record<Energy, string> = { low: "Low energy", medium: "Medium energy", high: "High energy" };

export function duration(ms: number | null): string {
	if (!ms) return "—";
	if (ms < 10_000) return `${(ms / 1000).toFixed(1)} s`;
	const s = Math.round(ms / 1000);
	return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function LicenseBadge({ code }: { code: LicenseCode }) {
	const l = LICENSES[code];
	return (
		<Badge tone={l.credit ? "warning" : "success"} title={l.label}>
			{l.short}
		</Badge>
	);
}

export function PlayButton({ url, label, className }: { url: string; label: string; className?: string }) {
	const playing = usePreviewAudio((s) => s.url === url);
	const play = usePreviewAudio((s) => s.play);
	return (
		<Button variant={playing ? "default" : "outline"} size="icon-sm" className={cn("rounded-full", className)} aria-label={`${playing ? "Stop" : "Play"} ${label}`} aria-pressed={playing} onClick={() => play(url)}>
			{playing ? <Pause className="fill-current" /> : <Play className="fill-current" />}
		</Button>
	);
}

/* ---------- Import ---------- */

const IMPORT_LICENSES: LicenseCode[] = ["CC0-1.0", "PD", "CC-BY-4.0", "CC-BY-3.0", "OWNED"];

export function ImportDialog({ kind, open, onOpenChange }: { kind: AssetKind; open: boolean; onOpenChange: (o: boolean) => void }) {
	const [license, setLicense] = useState<LicenseCode>("CC0-1.0");
	const [author, setAuthor] = useState("");
	const [sourceUrl, setSourceUrl] = useState("");
	const [busy, setBusy] = useState(false);
	useEffect(() => {
		if (open) {
			setLicense("CC0-1.0");
			setAuthor("");
			setSourceUrl("");
		}
	}, [open]);
	const needsAuthor = LICENSES[license].credit;
	const urlOk = !sourceUrl.trim() || /^https?:\/\/\S+$/i.test(sourceUrl.trim());
	const ready = (!needsAuthor || author.trim().length > 0) && urlOk;

	const run = async () => {
		setBusy(true);
		try {
			const r = await call(assetChannels.import, { kind, license: { license, author: author.trim() || undefined, sourceUrl: sourceUrl.trim() || undefined } });
			if (!r.added.length && !r.existing && !r.failed.length) return; // dialog cancelled
			const parts = [r.added.length ? `${r.added.length} added` : null, r.existing ? `${r.existing} already in the library` : null].filter(Boolean).join(", ");
			if (r.failed.length) toast.error(`${r.failed.length} ${r.failed.length === 1 ? "file was" : "files were"} not imported`, { description: r.failed.map((f) => `${f.name}: ${f.error}`).join("\n") });
			if (parts) toast.success(`Import finished: ${parts}`);
			onOpenChange(false);
		} catch (err) {
			toast.error("Import failed", { description: errorText(err) });
		} finally {
			setBusy(false);
		}
	};

	return (
		<Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
			<DialogContent title={`Import ${KIND_LABEL[kind]}`} description="Say what license the files have. The app keeps it with each file and adds credits to the YouTube description when needed." className="w-[min(92vw,520px)]">
				<div className="mt-5 space-y-4">
					<fieldset className="space-y-1.5">
						<legend className="mb-1.5 text-[13px] font-medium">License</legend>
						{IMPORT_LICENSES.map((code) => (
							<label key={code} className={cn("flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-[13px] transition-colors", license === code ? "border-primary bg-primary-soft/40" : "hover:bg-subtle")}>
								<input type="radio" name="license" className="accent-[var(--color-primary)]" checked={license === code} onChange={() => setLicense(code)} />
								<span className="flex-1">{LICENSES[code].label}</span>
							</label>
						))}
					</fieldset>
					<p className="flex items-start gap-2 rounded-lg bg-subtle px-3 py-2 text-[12px] text-muted-foreground">
						<ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-success" />
						NonCommercial (NC), NoDerivatives (ND) and ShareAlike (SA) files cannot be added. They are not safe for monetised YouTube videos.
					</p>
					<div className="grid grid-cols-2 gap-3">
						<div className="space-y-1.5">
							<Label htmlFor="imp-author">Author {needsAuthor ? <span className="text-danger">*</span> : <span className="font-normal text-muted-foreground">(optional)</span>}</Label>
							<Input id="imp-author" value={author} maxLength={120} onChange={(e) => setAuthor(e.target.value)} placeholder="Who made it" aria-invalid={needsAuthor && !author.trim()} />
						</div>
						<div className="space-y-1.5">
							<Label htmlFor="imp-src">Source link <span className="font-normal text-muted-foreground">(optional)</span></Label>
							<Input id="imp-src" value={sourceUrl} maxLength={500} onChange={(e) => setSourceUrl(e.target.value)} placeholder="https://…" aria-invalid={!urlOk} />
						</div>
					</div>
					{needsAuthor ? <p className="text-[12px] text-muted-foreground">CC BY needs the author's name for the credit line.</p> : null}
				</div>
				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
						Cancel
					</Button>
					<Button onClick={() => void run()} disabled={!ready} loading={busy}>
						{busy ? null : <Upload />}
						Choose files…
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

/* ---------- Edit details ---------- */

export function EditDialog({ asset, onOpenChange }: { asset: AssetView | null; onOpenChange: (o: boolean) => void }) {
	const [title, setTitle] = useState("");
	const [mood, setMood] = useState<Mood | "none">("none");
	const [energy, setEnergy] = useState<Energy | "none">("none");
	const [bpm, setBpm] = useState("");
	const [tags, setTags] = useState("");
	const [busy, setBusy] = useState(false);
	useEffect(() => {
		if (!asset) return;
		setTitle(asset.title);
		setMood(asset.mood ?? "none");
		setEnergy(asset.energy ?? "none");
		setBpm(asset.bpm ? String(asset.bpm) : "");
		setTags(asset.tags.join(", "));
	}, [asset]);
	const bpmNum = bpm.trim() ? Number(bpm) : null;
	const bpmOk = bpmNum === null || (Number.isInteger(bpmNum) && bpmNum >= 20 && bpmNum <= 300);
	const audio = asset?.kind === "music" || asset?.kind === "sfx";

	const save = async () => {
		if (!asset) return;
		setBusy(true);
		try {
			const tagList = tags
				.split(",")
				.map((t) => t.trim())
				.filter(Boolean)
				.slice(0, 20)
				.map((t) => t.slice(0, 30));
			await call(assetChannels.update, { id: asset.id, patch: { title: title.trim(), mood: mood === "none" ? null : mood, energy: energy === "none" ? null : energy, bpm: bpmNum, tags: tagList } });
			toast.success("Details saved");
			onOpenChange(false);
		} catch (err) {
			toast.error("Could not save", { description: errorText(err) });
		} finally {
			setBusy(false);
		}
	};

	return (
		<Dialog open={!!asset} onOpenChange={(o) => !busy && onOpenChange(o)}>
			<DialogContent title="Edit details" description="Mood and energy help the app pick music for each chapter.">
				<form
					className="mt-5 space-y-4"
					onSubmit={(e) => {
						e.preventDefault();
						void save();
					}}
				>
					<div className="space-y-1.5">
						<Label htmlFor="ed-title">Title</Label>
						<Input id="ed-title" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} required />
					</div>
					{audio ? (
						<div className="grid grid-cols-3 gap-3">
							<div className="space-y-1.5">
								<Label>Mood</Label>
								<Select ariaLabel="Mood" value={mood} onChange={setMood} options={[{ value: "none", label: "None" }, ...MOODS.map((m) => ({ value: m, label: MOOD_LABEL[m] }))]} />
							</div>
							<div className="space-y-1.5">
								<Label>Energy</Label>
								<Select
									ariaLabel="Energy"
									value={energy}
									onChange={setEnergy}
									options={[
										{ value: "none", label: "None" },
										{ value: "low", label: "Low" },
										{ value: "medium", label: "Medium" },
										{ value: "high", label: "High" },
									]}
								/>
							</div>
							<div className="space-y-1.5">
								<Label htmlFor="ed-bpm">BPM</Label>
								<Input id="ed-bpm" inputMode="numeric" value={bpm} onChange={(e) => setBpm(e.target.value.replace(/[^0-9]/g, "").slice(0, 3))} placeholder="e.g. 120" aria-invalid={!bpmOk} />
							</div>
						</div>
					) : null}
					<div className="space-y-1.5">
						<Label htmlFor="ed-tags">Tags</Label>
						<Input id="ed-tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="piano, bright, intro" />
						<p className="text-[12px] text-muted-foreground">Separate tags with commas.</p>
					</div>
					<DialogFooter>
						<Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
							Cancel
						</Button>
						<Button type="submit" disabled={!title.trim() || !bpmOk} loading={busy}>
							Save
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

/* ---------- License ---------- */

export function LicenseDialog({ asset, onOpenChange }: { asset: AssetView | null; onOpenChange: (o: boolean) => void }) {
	const l = asset ? LICENSES[asset.license] : null;
	return (
		<Dialog open={!!asset} onOpenChange={onOpenChange}>
			{asset && l ? (
				<DialogContent title="License and credit" description={asset.title}>
					<dl className="mt-5 grid grid-cols-[110px_1fr] gap-x-4 gap-y-2.5 text-[13px]">
						<dt className="text-muted-foreground">License</dt>
						<dd className="flex flex-wrap items-center gap-2">
							<LicenseBadge code={asset.license} />
							<span>{l.label}</span>
						</dd>
						<dt className="text-muted-foreground">Author</dt>
						<dd data-selectable>{asset.author ?? "—"}</dd>
						<dt className="text-muted-foreground">From</dt>
						<dd data-selectable>{asset.pack ?? (asset.source === "import" ? "Imported by you" : asset.source)}</dd>
						{asset.sourceUrl ? (
							<>
								<dt className="text-muted-foreground">Source</dt>
								<dd className="min-w-0">
									<a href={asset.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1 truncate font-medium text-primary hover:underline">
										<span className="truncate">{asset.sourceUrl}</span>
										<ExternalLink className="size-3 shrink-0" />
									</a>
								</dd>
							</>
						) : null}
						<dt className="text-muted-foreground">Credit</dt>
						<dd>
							{asset.attribution ? (
								<span className="block rounded-lg bg-subtle p-2.5 text-[12px] leading-relaxed" data-selectable>
									{asset.attribution}
								</span>
							) : (
								<span className="text-muted-foreground">Not required. Videos using it stay free to monetise.</span>
							)}
						</dd>
					</dl>
					<DialogFooter className="justify-between">
						{l.url ? (
							<Button variant="ghost" size="sm" asChild>
								<a href={l.url} target="_blank" rel="noreferrer">
									<ExternalLink />
									Read the license
								</a>
							</Button>
						) : (
							<span />
						)}
						<div className="flex gap-2">
							<Button variant="outline" size="sm" onClick={() => void call(assetChannels.revealLicenses).catch((err) => toast.error("Could not open the folder", { description: errorText(err) }))}>
								<FolderOpen />
								License files
							</Button>
							{asset.attribution ? (
								<Button
									size="sm"
									onClick={() => {
										void navigator.clipboard.writeText(asset.attribution!);
										toast.success("Credit copied");
									}}
								>
									Copy credit
								</Button>
							) : null}
						</div>
					</DialogFooter>
				</DialogContent>
			) : null}
		</Dialog>
	);
}

/* ---------- Freesound ---------- */

export function FreesoundDialog({ open, onOpenChange, initialKind }: { open: boolean; onOpenChange: (o: boolean) => void; initialKind: "music" | "sfx" }) {
	const [hasKey, setHasKey] = useState<boolean | null>(null);
	const [kind, setKind] = useState<"music" | "sfx">(initialKind);
	const [query, setQuery] = useState("");
	const [page, setPage] = useState(1);
	const [res, setRes] = useState<FreesoundResults | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [importing, setImporting] = useState<number | null>(null);
	const [done, setDone] = useState<Set<number>>(new Set());
	const stop = usePreviewAudio((s) => s.stop);

	useEffect(() => {
		if (!open) {
			stop();
			return;
		}
		setKind(initialKind);
		setRes(null);
		setError(null);
		setDone(new Set());
		void call(assetChannels.freesoundKey).then((k) => setHasKey(k.set));
	}, [open, initialKind, stop]);

	const search = async (p = 1) => {
		if (!query.trim()) return;
		setLoading(true);
		setError(null);
		try {
			setRes(await call(assetChannels.freesoundSearch, { query: query.trim(), kind, page: p }));
			setPage(p);
		} catch (err) {
			setError(errorText(err));
		} finally {
			setLoading(false);
		}
	};

	const add = async (id: number, name: string) => {
		setImporting(id);
		try {
			const r = await call(assetChannels.freesoundImport, { id, kind });
			setDone((s) => new Set(s).add(id));
			toast.success(r.existed ? "Already in your library" : `Added "${r.asset.title}"`, { description: r.asset.attribution ? "The credit will be added to the YouTube description." : "CC0: no credit needed." });
		} catch (err) {
			toast.error(`Could not add "${name}"`, { description: errorText(err) });
		} finally {
			setImporting(null);
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent title="Search Freesound" description="Only CC0 and CC BY sounds are shown. NonCommercial sounds are always hidden." className="flex max-h-[min(86vh,760px)] w-[min(94vw,720px)] flex-col">
				{hasKey === false ? (
					<div className="mt-6 flex flex-col items-center rounded-xl border border-dashed bg-subtle/60 px-6 py-10 text-center">
						<KeyRound className="mb-3 size-6 text-primary" />
						<p className="text-sm font-medium">Add your free Freesound API key first</p>
						<p className="mt-1 max-w-sm text-[13px] text-muted-foreground">Create a key at freesound.org, then paste it in Settings → Assets. It is stored encrypted on this PC.</p>
						<div className="mt-4 flex gap-2">
							<Button variant="outline" size="sm" asChild>
								<a href="https://freesound.org/apiv2/apply/" target="_blank" rel="noreferrer">
									<ExternalLink />
									Get a key
								</a>
							</Button>
							<Button size="sm" asChild onClick={() => onOpenChange(false)}>
								<Link to="/settings" search={{ section: "assets" }}>
									Open Settings
								</Link>
							</Button>
						</div>
					</div>
				) : (
					<>
						<form
							className="mt-5 flex gap-2"
							onSubmit={(e) => {
								e.preventDefault();
								void search(1);
							}}
						>
							<Segmented
								ariaLabel="Sound type"
								value={kind}
								onChange={(k) => {
									setKind(k);
									setRes(null);
								}}
								options={[
									{ value: "sfx", label: "Effects" },
									{ value: "music", label: "Music" },
								]}
							/>
							<div className="relative flex-1">
								<Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
								<Input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder={kind === "sfx" ? "pop, whoosh, ding…" : "calm piano, upbeat…"} className="pl-8" aria-label="Search words" maxLength={100} />
							</div>
							<Button type="submit" loading={loading} disabled={!query.trim()}>
								Search
							</Button>
						</form>
						<div className="mt-4 min-h-0 flex-1 overflow-y-auto rounded-xl border" aria-live="polite" aria-busy={loading}>
							{error ? (
								<p role="alert" className="p-6 text-center text-[13px] text-danger">
									{error}
								</p>
							) : !res ? (
								<p className="p-10 text-center text-[13px] text-muted-foreground">Type a few words and press Search.</p>
							) : res.hits.length === 0 ? (
								<p className="p-10 text-center text-[13px] text-muted-foreground">No CC0 or CC BY sounds found. Try other words.</p>
							) : (
								<ul className="divide-y">
									{res.hits.map((h) => {
										const added = h.imported || done.has(h.id);
										return (
											<li key={h.id} className="flex items-center gap-3 px-3 py-2.5">
												<PlayButton url={h.previewUrl} label={h.name} />
												<div className="min-w-0 flex-1">
													<div className="truncate text-[13px] font-medium">{h.name}</div>
													<div className="truncate text-[12px] text-muted-foreground">
														by {h.username} · {duration(h.durationMs)}
														{h.tags.length ? ` · ${h.tags.slice(0, 4).join(", ")}` : ""}
													</div>
												</div>
												<LicenseBadge code={h.license} />
												<a href={h.pageUrl} target="_blank" rel="noreferrer" className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground" aria-label={`Open ${h.name} on Freesound`}>
													<ExternalLink className="size-3.5" />
												</a>
												<Button size="sm" variant={added ? "ghost" : "outline"} disabled={added || importing !== null} loading={importing === h.id} onClick={() => void add(h.id, h.name)} className="w-24">
													{added ? <Check /> : importing === h.id ? null : <Download />}
													{added ? "Added" : "Add"}
												</Button>
											</li>
										);
									})}
								</ul>
							)}
						</div>
						{res ? (
							<div className="mt-3 flex items-center gap-2 text-[12px] text-muted-foreground">
								<span>
									{res.count.toLocaleString()} results{res.skipped ? ` · ${res.skipped} hidden on this page (license not allowed)` : ""}
								</span>
								<div className="ml-auto flex items-center gap-1.5">
									<Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => void search(page - 1)}>
										Previous
									</Button>
									<span className="tabular-nums">
										{page} / {res.pages}
									</span>
									<Button variant="outline" size="sm" disabled={page >= res.pages || loading} onClick={() => void search(page + 1)}>
										Next
									</Button>
								</div>
							</div>
						) : null}
						{loading && !res ? <Loader2 className="mx-auto mt-3 size-4 animate-spin text-muted-foreground" /> : null}
					</>
				)}
			</DialogContent>
		</Dialog>
	);
}

export { ENERGY_LABEL };
