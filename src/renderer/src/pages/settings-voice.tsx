import {
	AudioLines,
	Check,
	CircleAlert,
	CircleCheck,
	Download,
	ExternalLink,
	FolderOpen,
	Loader2,
	Play,
	RefreshCw,
	Square,
	Wrench,
	type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
	DEFAULT_VOICE,
	PACKAGES_BYTES_ESTIMATE,
	PREVIEW_MAX_CHARS,
	SPEED_MAX,
	SPEED_MIN,
	voiceChannels as ch,
	type InstallStep,
	type Voice,
	type VoiceState,
	type VoiceStatus,
} from "@shared/ipc/voice";
import { Button } from "@renderer/components/ui/button";
import { confirm } from "@renderer/components/ui/confirm";
import { Segmented } from "@renderer/components/ui/misc";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label } from "@renderer/components/ui/primitives";
import { Slider } from "@renderer/components/ui/slider";
import { bytes, timeAgo } from "@renderer/lib/format";
import { call, errorText } from "@renderer/lib/ipc";
import { cn } from "@renderer/lib/utils";
import { useVoice } from "@renderer/stores/voice";

const STATE_BADGE: Record<VoiceState, { label: string; tone: "success" | "warning" | "danger" | "neutral" | "primary" }> = {
	ready: { label: "Ready", tone: "success" },
	"not-installed": { label: "Not installed", tone: "neutral" },
	installing: { label: "Installing", tone: "primary" },
	outdated: { label: "Update needed", tone: "warning" },
	broken: { label: "Needs repair", tone: "danger" },
	"no-python": { label: "Python needed", tone: "warning" },
};

const STEPS: { id: Exclude<InstallStep, "done" | "error" | "cancelled">; label: string }[] = [
	{ id: "python", label: "Find Python" },
	{ id: "venv", label: "Create environment" },
	{ id: "packages", label: "Install packages" },
	{ id: "models", label: "Download voice model" },
	{ id: "verify", label: "Test the voice" },
];

function Notice({ tone, icon: Icon, title, children }: { tone: "warning" | "danger" | "info"; icon: LucideIcon; title: string; children?: React.ReactNode }) {
	return (
		<div
			role={tone === "info" ? "status" : "alert"}
			className={cn(
				"flex gap-3 rounded-xl border p-4 text-[13px]",
				tone === "warning" && "border-warning/30 bg-warning-soft",
				tone === "danger" && "border-danger/30 bg-danger-soft",
				tone === "info" && "bg-subtle",
			)}
		>
			<Icon className={cn("mt-0.5 size-4 shrink-0", tone === "warning" && "text-warning", tone === "danger" && "text-danger", tone === "info" && "text-muted-foreground")} />
			<div className="min-w-0 space-y-1">
				<p className="font-medium text-foreground">{title}</p>
				{children ? <div className="text-muted-foreground">{children}</div> : null}
			</div>
		</div>
	);
}

function InstallPanel({ status }: { status: VoiceStatus }) {
	const p = status.install!;
	const current = STEPS.findIndex((s) => s.id === p.step);
	const pct = Math.round(p.progress * 100);
	const cancel = async () => {
		const ok = await confirm({
			title: "Stop the install?",
			description: "Downloaded model files are kept. You can start the install again later.",
			confirmLabel: "Stop install",
			cancelLabel: "Keep going",
		});
		if (ok) await call(ch.cancel).catch((err) => toast.error("Could not stop the install", { description: errorText(err) }));
	};
	return (
		<div className="space-y-4" aria-live="polite">
			<div className="rounded-xl border bg-subtle p-4">
				<div className="mb-2 flex items-center gap-2 text-[13px]">
					<Loader2 className="size-4 animate-spin text-primary" />
					<span className="font-medium">{STEPS[current]?.label ?? "Installing"}</span>
					<span className="min-w-0 truncate text-muted-foreground">{p.detail}</span>
					<span className="ml-auto font-medium tabular-nums">{pct}%</span>
				</div>
				<div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="Install progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
					<div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${pct}%` }} />
				</div>
			</div>
			<ol className="grid grid-cols-5 gap-2">
				{STEPS.map((s, i) => {
					const done = i < current;
					const now = i === current;
					return (
						<li key={s.id} className={cn("flex items-center gap-2 rounded-lg border px-2.5 py-2 text-[12px]", now ? "border-primary/40 bg-primary-soft/40" : "bg-card")}>
							<span
								className={cn(
									"grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-semibold",
									done ? "bg-success text-white" : now ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
								)}
							>
								{done ? <Check className="size-3" /> : i + 1}
							</span>
							<span className={cn("leading-tight", done || now ? "text-foreground" : "text-muted-foreground")}>{s.label}</span>
						</li>
					);
				})}
			</ol>
			<Button variant="outline" onClick={() => void cancel()}>
				<Square className="fill-current" />
				Stop install
			</Button>
		</div>
	);
}

function EngineCard() {
	const { status, checking, refresh } = useVoice();

	const install = async (repair: boolean) => {
		if (!status) return;
		const size = status.downloadBytes
			? `It downloads about ${bytes(status.downloadBytes)}.`
			: `The voice model is already here, so only the packages (about ${bytes(PACKAGES_BYTES_ESTIMATE)}) may download again.`;
		const ok = await confirm(
			repair
				? {
						title: "Repair the voice engine?",
						description: `The voice engine's Python environment is deleted and built again. Model files are checked and kept if they are good. ${size}`,
						confirmLabel: "Repair",
						tone: "danger",
					}
				: {
						title: "Install the voice engine?",
						description: `Kokoro runs on this PC with Python ${status.python?.version ?? ""}. ${size} Packages and model files are checked against pinned checksums.`,
						confirmLabel: "Install",
					},
		);
		if (!ok) return;
		try {
			await call(ch.install, { repair });
			await refresh();
		} catch (err) {
			toast.error("Could not start the install", { description: errorText(err) });
		}
	};

	if (!status) {
		return (
			<Card>
				<CardHeader>
					<CardTitle>Voice engine</CardTitle>
					<CardDescription className="flex items-center gap-2">
						<Loader2 className="size-3.5 animate-spin" />
						Checking the voice engine…
					</CardDescription>
				</CardHeader>
			</Card>
		);
	}

	const badge = STATE_BADGE[status.state];
	const lastError = status.install?.step === "error" ? status.install.error : null;

	return (
		<Card>
			<CardHeader>
				<div className="flex items-center gap-2">
					<CardTitle>Voice engine</CardTitle>
					<Badge tone={badge.tone}>{badge.label}</Badge>
					<Badge tone="primary">Kokoro</Badge>
				</div>
				<CardDescription>Speaks your scripts and reads scanned pages on this PC. It is free, works offline and needs no account.</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				{status.state === "installing" && status.install ? <InstallPanel status={status} /> : null}

				{lastError && status.state !== "installing" && status.state !== "ready" ? (
					<Notice tone="danger" icon={CircleAlert} title="The last install did not finish">
						<p data-selectable>{lastError}</p>
					</Notice>
				) : null}

				{status.state === "no-python" ? (
					<>
						<Notice tone="warning" icon={CircleAlert} title="Python is needed for the voice engine">
							<p data-selectable>{status.pythonProblem}</p>
						</Notice>
						<div className="flex gap-2">
							<Button asChild>
								<a href="https://www.python.org/downloads/windows/" target="_blank" rel="noreferrer">
									<ExternalLink />
									Get Python
								</a>
							</Button>
							<Button variant="outline" loading={checking} onClick={() => void refresh()}>
								{checking ? null : <RefreshCw />}
								Check again
							</Button>
						</div>
					</>
				) : null}

				{status.state === "not-installed" ? (
					<>
						<Notice tone="info" icon={Download} title={`About ${bytes(status.downloadBytes)} to download, once`}>
							Python packages (about {bytes(PACKAGES_BYTES_ESTIMATE)}) and the Kokoro voice model (354 MB). Found Python {status.python?.version}.
						</Notice>
						<Button onClick={() => void install(false)}>
							<Download />
							Install voice engine
						</Button>
					</>
				) : null}

				{status.state === "broken" || status.state === "outdated" ? (
					<>
						<Notice tone="warning" icon={Wrench} title={status.state === "outdated" ? "Packages need an update" : "The voice engine needs a repair"}>
							{status.problem}
						</Notice>
						<Button onClick={() => void install(true)}>
							<Wrench />
							Repair
						</Button>
					</>
				) : null}

				{status.state === "ready" ? (
					<>
						<dl className="grid grid-cols-4 gap-3">
							{[
								{ k: "Status", v: "Ready", icon: CircleCheck },
								{ k: "Python", v: status.python?.version ?? "—" },
								{ k: "Disk space", v: bytes(status.sizeBytes) },
								{ k: "Installed", v: timeAgo(status.installedAt) || "—" },
							].map((x) => (
								<div key={x.k} className="rounded-xl border bg-subtle px-3.5 py-3">
									<dt className="text-[12px] text-muted-foreground">{x.k}</dt>
									<dd className="mt-0.5 flex items-center gap-1.5 text-[15px] font-semibold tabular-nums">
										{x.icon ? <x.icon className="size-4 text-success" /> : null}
										{x.v}
									</dd>
								</div>
							))}
						</dl>
						<div className="flex items-center gap-2">
							<Button variant="outline" onClick={() => void install(true)}>
								<Wrench />
								Repair…
							</Button>
							<Button variant="ghost" onClick={() => void call(ch.reveal).catch((err) => toast.error("Could not open the folder", { description: errorText(err) }))}>
								<FolderOpen />
								Show folder
							</Button>
							<span className="ml-auto truncate font-mono text-[12px] text-muted-foreground" data-selectable title={status.folder}>
								{status.folder}
							</span>
						</div>
					</>
				) : null}
			</CardContent>
		</Card>
	);
}

type Filter = "all" | "female" | "male";

function VoicesCard() {
	const [voices, setVoices] = useState<Voice[] | null>(null);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [voice, setVoice] = useState(DEFAULT_VOICE);
	const [speed, setSpeed] = useState(1);
	const [text, setText] = useState("");
	const [filter, setFilter] = useState<Filter>("all");
	const [busy, setBusy] = useState<string | null>(null);
	const [playing, setPlaying] = useState<string | null>(null);
	const audio = useRef<HTMLAudioElement | null>(null);

	useEffect(() => {
		void call(ch.getSettings).then((s) => {
			setVoice(s.voice);
			setSpeed(s.speed);
		});
		call(ch.voices)
			.then(setVoices)
			.catch((err) => setLoadError(errorText(err)));
		return () => audio.current?.pause();
	}, []);

	const save = async (next: { voice: string; speed: number }) => {
		try {
			await call(ch.setSettings, next);
		} catch (err) {
			toast.error("Could not save the voice setting", { description: errorText(err) });
		}
	};

	const stop = () => {
		audio.current?.pause();
		setPlaying(null);
	};

	const play = async (v: Voice) => {
		if (playing === v.id) return stop();
		stop();
		setBusy(v.id);
		try {
			const r = await call(ch.preview, { voice: v.id, speed, text: text.trim() || undefined });
			const a = new Audio(r.audio);
			audio.current = a;
			a.onended = () => setPlaying((cur) => (cur === v.id ? null : cur));
			await a.play();
			setPlaying(v.id);
		} catch (err) {
			toast.error(`Could not play ${v.name}`, { description: errorText(err) });
		} finally {
			setBusy(null);
		}
	};

	const shown = useMemo(() => (voices ?? []).filter((v) => filter === "all" || v.gender === filter), [voices, filter]);
	// The engine sends the voices sorted by group, so the groups keep that order.
	const groups = [...new Set(shown.map((v) => v.group))].map((group) => ({ group, list: shown.filter((v) => v.group === group) }));

	return (
		<Card>
			<CardHeader>
				<CardTitle>Voices</CardTitle>
				<CardDescription>Press play to hear a voice. The default voice and speed are used for new videos.</CardDescription>
			</CardHeader>
			<CardContent className="space-y-5">
				<div className="grid grid-cols-[1fr_260px] gap-5">
					<div className="space-y-1.5">
						<Label htmlFor="voice-sample">Sample text</Label>
						<Input
							id="voice-sample"
							value={text}
							maxLength={PREVIEW_MAX_CHARS}
							onChange={(e) => setText(e.target.value)}
							placeholder="Leave empty to hear a short sample sentence"
						/>
					</div>
					<div className="space-y-1.5">
						<div className="flex items-center justify-between">
							<Label id="voice-speed-label">Speed</Label>
							<span className="text-[13px] font-medium tabular-nums">{speed.toFixed(2)}×</span>
						</div>
						<div className="flex h-9 items-center">
							<Slider value={speed} onChange={setSpeed} onCommit={(s) => void save({ voice, speed: s })} min={SPEED_MIN} max={SPEED_MAX} step={0.05} ariaLabel="Speaking speed" />
						</div>
					</div>
				</div>

				<div className="flex items-center justify-between">
					<Segmented<Filter>
						ariaLabel="Filter voices"
						value={filter}
						onChange={setFilter}
						options={[
							{ value: "all", label: "All" },
							{ value: "female", label: "Female" },
							{ value: "male", label: "Male" },
						]}
					/>
					{voices ? <span className="text-[12px] text-muted-foreground">{shown.length} voices</span> : null}
				</div>

				{loadError ? (
					<Notice tone="danger" icon={CircleAlert} title="Could not load the voices">
						<p data-selectable>{loadError}</p>
					</Notice>
				) : !voices ? (
					<div className="flex items-center gap-2 py-6 text-[13px] text-muted-foreground">
						<Loader2 className="size-4 animate-spin" />
						Starting the voice engine…
					</div>
				) : (
					<div role="radiogroup" aria-label="Default voice" className="space-y-4">
						{groups.map((g) => (
							<div key={g.group} className="space-y-2">
								<h4 className="text-[12px] font-medium uppercase tracking-wide text-muted-foreground">{g.group}</h4>
								<div className="grid grid-cols-2 gap-2">
									{g.list.map((v) => {
										const selected = v.id === voice;
										return (
											<div
												key={v.id}
												className={cn("flex items-center gap-3 rounded-xl border bg-card px-3 py-2.5 transition-colors", selected ? "border-primary ring-3 ring-primary/15" : "hover:bg-subtle")}
											>
												<Button
													variant={playing === v.id ? "default" : "outline"}
													size="icon-sm"
													className="rounded-full"
													aria-label={playing === v.id ? `Stop ${v.name}` : `Play ${v.name}`}
													disabled={busy !== null && busy !== v.id}
													onClick={() => void play(v)}
												>
													{busy === v.id ? <Loader2 className="animate-spin" /> : playing === v.id ? <Square className="fill-current" /> : <Play className="fill-current" />}
												</Button>
												<button
													role="radio"
													aria-checked={selected}
													onClick={() => {
														setVoice(v.id);
														void save({ voice: v.id, speed });
													}}
													className="flex min-w-0 flex-1 items-center gap-2 text-left"
												>
													<span className="min-w-0">
														<span className="flex items-center gap-1.5 text-[13px] font-medium">
															{v.name}
															{playing === v.id ? <AudioLines className="size-3.5 text-primary" /> : null}
														</span>
														<span className="block text-[12px] text-muted-foreground">
															<span className="capitalize">{v.gender}</span>
															{v.downloadBytes ? ` · ${Math.round(v.downloadBytes / 1_000_000)} MB download on first play` : null}
														</span>
													</span>
													<span className="ml-auto flex items-center gap-1.5">
														{v.recommended ? <Badge tone="primary">Top pick</Badge> : null}
														{selected ? (
															<Badge tone="success">
																<Check className="size-3" />
																Default
															</Badge>
														) : null}
													</span>
												</button>
											</div>
										);
									})}
								</div>
							</div>
						))}
					</div>
				)}
			</CardContent>
		</Card>
	);
}

/** Settings → Voice: install or repair Kokoro, preview voices, pick the default voice and speed. */
export function VoiceSettings() {
	const { status, refresh } = useVoice();
	useEffect(() => {
		void refresh().catch((err) => toast.error("Could not check the voice engine", { description: errorText(err) }));
	}, [refresh]);
	return (
		<div className="space-y-5">
			<EngineCard />
			{status?.state === "ready" ? <VoicesCard /> : null}
		</div>
	);
}
