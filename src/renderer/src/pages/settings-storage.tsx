import { Brush, FolderOpen, Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { storageChannels, type Cleanup, type StorageReport } from "@shared/ipc/storage";
import { Button } from "@renderer/components/ui/button";
import { confirm } from "@renderer/components/ui/confirm";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@renderer/components/ui/primitives";
import { Switch } from "@renderer/components/ui/switch";
import { bytes } from "@renderer/lib/format";
import { call, errorText } from "@renderer/lib/ipc";

const AREA: Record<StorageReport["areas"][number]["area"], { label: string; hint: string; color: string }> = {
	videos: { label: "Videos", hint: "Finished videos, thumbnails, captions", color: "bg-[oklch(0.62_0.19_277)]" },
	drafts: { label: "Drafts", hint: "Source material, figures, voice clips", color: "bg-[oklch(0.7_0.15_200)]" },
	assets: { label: "Assets", hint: "Music, sound effects, logos", color: "bg-[oklch(0.72_0.16_150)]" },
	python: { label: "Voice engine", hint: "Python and the voice model", color: "bg-[oklch(0.75_0.15_75)]" },
	engine: { label: "Render engine", hint: "Render browser and tools", color: "bg-[oklch(0.68_0.17_30)]" },
	cache: { label: "Temporary files", hint: "Safe to clean", color: "bg-[oklch(0.7_0.02_270)]" },
	data: { label: "Database", hint: "Your drafts, settings and history", color: "bg-[oklch(0.6_0.12_320)]" },
	backups: { label: "Database backups", hint: "Made before updates", color: "bg-[oklch(0.6_0.06_320)]" },
	logs: { label: "Logs", hint: "For problem reports", color: "bg-[oklch(0.8_0.02_270)]" },
};

const CLEAN: Record<Cleanup, { label: string; text: string }> = {
	cache: { label: "Temporary files", text: "Leftovers from reading material, voice previews and test renders. The app makes them again when needed." },
	leftovers: { label: "Leftover folders", text: "Draft and video folders that no draft or video in the app uses any more (for example after a crash)." },
	web: { label: "App web cache", text: "Images and pages the app window cached. It fills up again a little as you use the app." },
};

export function StorageSettings() {
	const [report, setReport] = useState<StorageReport | null>(null);
	const [loading, setLoading] = useState(false);
	const [picked, setPicked] = useState<Set<Cleanup>>(new Set(["cache", "leftovers"]));
	const [busy, setBusy] = useState(false);
	const load = useCallback(() => {
		setLoading(true);
		call(storageChannels.report)
			.then(setReport)
			.catch((err) => toast.error("Could not measure the storage", { description: errorText(err) }))
			.finally(() => setLoading(false));
	}, []);
	useEffect(load, [load]);

	const total = report?.areas.reduce((n, a) => n + a.bytes, 0) ?? 0;
	const chosen = report?.cleanups.filter((c) => picked.has(c.id) && !c.blocked && c.bytes > 0) ?? [];
	const chosenBytes = chosen.reduce((n, c) => n + c.bytes, 0);

	const clean = async () => {
		if (!chosen.length) return;
		const ok = await confirm({
			title: `Free about ${bytes(chosenBytes)}?`,
			description: (
				<>
					These are deleted from this PC: {chosen.map((c) => CLEAN[c.id].label.toLowerCase()).join(", ")}. Your drafts, videos, assets and settings are not touched. This cannot be undone.
				</>
			),
			tone: "danger",
			confirmLabel: "Clean up",
		});
		if (!ok) return;
		setBusy(true);
		try {
			const r = await call(storageChannels.clean, { items: chosen.map((c) => c.id) });
			toast.success(`Freed ${bytes(r.freedBytes)}`, { description: `${r.removedFiles} file${r.removedFiles === 1 ? "" : "s"} deleted.${r.skipped.length ? ` Skipped: ${r.skipped.join("; ")}.` : ""}` });
			load();
		} catch (err) {
			toast.error("Clean-up stopped", { description: errorText(err) });
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="space-y-5">
			<Card>
				<CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
					<div>
						<CardTitle>Space used</CardTitle>
						<CardDescription>{report ? `${bytes(total)} in total.` : "Measuring…"}</CardDescription>
					</div>
					<div className="flex gap-1.5">
						<Button variant="outline" size="sm" onClick={() => void call(storageChannels.reveal)}>
							<FolderOpen />
							Open folder
						</Button>
						<Button variant="ghost" size="icon-sm" aria-label="Measure again" onClick={load} disabled={loading}>
							{loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
						</Button>
					</div>
				</CardHeader>
				<CardContent>
					{report ? (
						<>
							<div className="mb-4 flex h-2.5 overflow-hidden rounded-full bg-muted" aria-hidden>
								{report.areas
									.filter((a) => a.bytes > 0)
									.map((a) => (
										<div key={a.area} className={AREA[a.area].color} style={{ width: `${(a.bytes / Math.max(1, total)) * 100}%` }} />
									))}
							</div>
							<ul className="grid grid-cols-2 gap-x-6 gap-y-2.5" data-testid="storage-areas">
								{report.areas.map((a) => (
									<li key={a.area} className="flex items-center gap-2.5 text-[13px]">
										<span className={`size-2.5 shrink-0 rounded-full ${AREA[a.area].color}`} />
										<span className="min-w-0 flex-1">
											<span className="font-medium">{AREA[a.area].label}</span>
											<span className="block truncate text-[11.5px] text-muted-foreground">{AREA[a.area].hint}</span>
										</span>
										<span className="tabular-nums text-muted-foreground">{bytes(a.bytes)}</span>
									</li>
								))}
							</ul>
							<p className="mt-4 truncate text-[11.5px] text-muted-foreground" data-selectable>
								{report.root}
							</p>
						</>
					) : (
						<div className="flex h-32 items-center justify-center gap-2 text-[13px] text-muted-foreground">
							<Loader2 className="size-4 animate-spin" /> Measuring…
						</div>
					)}
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Clean up</CardTitle>
					<CardDescription>Only files the app can make again, or that nothing uses. You confirm before anything is deleted.</CardDescription>
				</CardHeader>
				<CardContent className="space-y-2.5">
					{report?.cleanups.map((c) => (
						<label key={c.id} className="flex items-start justify-between gap-4 rounded-lg border px-3 py-2.5" data-testid={`clean-${c.id}`}>
							<span className="min-w-0 text-[13px]">
								<span className="font-medium">{CLEAN[c.id].label}</span>
								<span className="ml-2 tabular-nums text-muted-foreground">{bytes(c.bytes)}</span>
								<span className="block text-[12px] text-muted-foreground">{c.blocked ?? CLEAN[c.id].text}</span>
							</span>
							<Switch
								checked={picked.has(c.id) && !c.blocked}
								disabled={!!c.blocked || c.bytes === 0}
								onChange={(v) => setPicked((p) => (v ? new Set([...p, c.id]) : new Set([...p].filter((x) => x !== c.id))))}
								ariaLabel={`Clean ${CLEAN[c.id].label}`}
							/>
						</label>
					))}
					<div className="flex items-center justify-between gap-3 pt-1">
						<span className="text-[12px] text-muted-foreground">{chosen.length ? `About ${bytes(chosenBytes)} can be freed.` : "Nothing to clean right now."}</span>
						<Button onClick={() => void clean()} disabled={!chosen.length} loading={busy} data-testid="storage-clean">
							<Brush />
							Clean up
						</Button>
					</div>
				</CardContent>
			</Card>
		</div>
	);
}
