import { Link } from "@tanstack/react-router";
import { AudioLines, Loader2, Mic, Play, Plus, Settings2, Square, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { SPEED_MAX, SPEED_MIN, voiceChannels as ch, type Voice } from "@shared/ipc/voice";
import { LEXICON_MAX, type NarrationStatus, type Pronunciation, type VoiceSetup } from "@shared/narration";
import { Button } from "@renderer/components/ui/button";
import { confirm } from "@renderer/components/ui/confirm";
import { Dialog, DialogContent, DialogFooter } from "@renderer/components/ui/dialog";
import { Badge, Input, Label, Tooltip } from "@renderer/components/ui/primitives";
import { Select } from "@renderer/components/ui/select";
import { Slider } from "@renderer/components/ui/slider";
import { Switch } from "@renderer/components/ui/switch";
import { call, errorText } from "@renderer/lib/ipc";
import { cn } from "@renderer/lib/utils";
import { useNarration } from "@renderer/stores/narration";

/** Plays one audio URL at a time across the Studio (clip previews, pronunciation tests). */
let current: HTMLAudioElement | null = null;
export function playOnce(src: string): HTMLAudioElement {
	current?.pause();
	current = new Audio(src);
	void current.play().catch(() => undefined);
	return current;
}

/** Header control: how much of the draft is voiced, Make voice / Stop, and the voice settings. */
export function VoiceControls({ draftId, status, onChanged }: { draftId: string; status: NarrationStatus; onChanged: () => void }) {
	const live = useNarration((s) => s.byDraft[draftId]);
	const running = live?.state === "running" ? live : status.running;
	const [open, setOpen] = useState(false);

	const start = async () => {
		try {
			await call(ch.draftStart, { draftId });
			onChanged();
		} catch (err) {
			toast.error("Could not make the voice", { description: errorText(err) });
		}
	};
	const stop = async () => {
		if (!running) return;
		const ok = await confirm({ title: "Stop making the voice?", description: "The sentences already voiced are kept. You can continue later.", confirmLabel: "Stop", cancelLabel: "Keep going", tone: "danger" });
		if (ok) await call(ch.draftCancel, { jobId: running.jobId }).catch((err) => toast.error("Could not stop", { description: errorText(err) }));
	};

	let badge: React.ReactNode;
	if (running) {
		const pct = running.total ? Math.round((running.done / running.total) * 100) : 0;
		badge = (
			<div className="flex items-center gap-2" role="status" aria-live="polite">
				<div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="Voice progress" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
					<div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${pct}%` }} />
				</div>
				<span className="text-[12px] tabular-nums text-muted-foreground" data-testid="voice-progress">
					{running.done} / {running.total}
				</span>
			</div>
		);
	} else if (!status.total) badge = null;
	else if (!status.pending)
		badge = (
			<Badge tone="success" data-testid="voice-state">
				<AudioLines className="size-3" />
				Voiced
			</Badge>
		);
	else
		badge = (
			<Badge tone={status.voiced ? "warning" : "neutral"} className="whitespace-nowrap" data-testid="voice-state">
				<Mic className="size-3" />
				{status.voiced ? `${status.pending} to voice` : "No voice yet"}
			</Badge>
		);

	return (
		<div className="flex items-center gap-2">
			{badge}
			{running ? (
				<Button variant="outline" size="sm" onClick={() => void stop()}>
					<Square />
					Stop
				</Button>
			) : status.engineReady ? (
				status.pending ? (
					<Tooltip content={status.voiced ? "Voices only the new and changed sentences" : "Voices every sentence with Kokoro, on this computer"}>
						<Button size="sm" onClick={() => void start()}>
							<Mic />
							{status.voiced ? "Update voice" : "Make voice"}
						</Button>
					</Tooltip>
				) : null
			) : status.total ? (
				<Button variant="outline" size="sm" asChild>
					<Link to="/settings" search={{ section: "voice" }}>
						<Mic />
						Set up voice
					</Link>
				</Button>
			) : null}
			<Tooltip content="Voice, speed and pronunciation">
				<Button variant="ghost" size="icon-sm" aria-label="Voice settings" onClick={() => setOpen(true)} disabled={!!running}>
					<Settings2 />
				</Button>
			</Tooltip>
			{open ? (
				<VoiceSettingsDialog
					draftId={draftId}
					status={status}
					onClose={(saved) => {
						setOpen(false);
						if (saved) onChanged();
					}}
				/>
			) : null}
		</div>
	);
}

type Row = Pronunciation & { key: number };
let rowSeq = 0;

function VoiceSettingsDialog({ draftId, status, onClose }: { draftId: string; status: NarrationStatus; onClose: (saved: boolean) => void }) {
	const [voice, setVoice] = useState(status.setup.voice);
	const [speed, setSpeed] = useState(status.setup.speed);
	const [rows, setRows] = useState<Row[]>(() => status.setup.lexicon.map((p) => ({ ...p, key: ++rowSeq })));
	const [voices, setVoices] = useState<Voice[] | null>(null);
	const [saving, setSaving] = useState(false);
	const [listening, setListening] = useState<number | null>(null);
	const lastRow = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (!status.engineReady) return;
		call(ch.voices)
			.then(setVoices)
			.catch(() => setVoices([]));
	}, [status.engineReady]);

	const clean = (): VoiceSetup => ({
		voice,
		speed,
		lexicon: rows.filter((r) => r.word.trim() && r.say.trim()).map(({ word, say, matchCase }) => ({ word: word.trim(), say: say.trim(), matchCase })),
	});
	const changed = JSON.stringify(clean()) !== JSON.stringify(status.setup);
	const update = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

	const add = () => {
		setRows((rs) => [...rs, { key: ++rowSeq, word: "", say: "", matchCase: false }]);
		setTimeout(() => lastRow.current?.focus(), 0);
	};

	const listen = async (r: Row) => {
		if (!r.say.trim()) return;
		setListening(r.key);
		try {
			const res = await call(ch.preview, { voice, speed, text: r.say.trim() });
			playOnce(res.audio);
		} catch (err) {
			toast.error("Could not play it", { description: errorText(err) });
		} finally {
			setListening(null);
		}
	};

	const save = async () => {
		setSaving(true);
		try {
			await call(ch.draftSetup, { draftId, setup: clean() });
			toast.success("Voice settings saved", { description: status.engineReady ? "Press Update voice to voice the sentences that changed." : undefined });
			onClose(true);
		} catch (err) {
			toast.error("Could not save", { description: errorText(err) });
		} finally {
			setSaving(false);
		}
	};

	const close = async () => {
		if (changed && !(await confirm({ title: "Discard changes?", description: "Your changes to the voice settings are not saved.", confirmLabel: "Discard", tone: "danger" }))) return;
		onClose(false);
	};

	const voiceOptions = (voices ?? [{ id: voice, name: voice, accent: "American", gender: "female", recommended: false } as Voice]).map((v) => ({
		value: v.id,
		label: voices ? `${v.name} · ${v.accent} ${v.gender}` : v.id,
		hint: v.recommended ? "Best" : undefined,
	}));

	return (
		<Dialog open onOpenChange={(o) => !o && void close()}>
			<DialogContent
				title="Voice for this video"
				description="These settings apply to this draft only. Only sentences whose sound changes are voiced again."
				className="w-[min(94vw,620px)]"
			>
				<div className="mt-5 grid grid-cols-[1fr_200px] gap-4">
					<div className="space-y-1.5">
						<Label>Voice</Label>
						<Select ariaLabel="Voice" value={voice} onChange={setVoice} options={voiceOptions} disabled={!voices?.length} />
					</div>
					<div className="space-y-1.5">
						<Label>
							Speed <span className="font-normal tabular-nums text-muted-foreground">{speed.toFixed(2)}×</span>
						</Label>
						<div className="flex h-9 items-center">
							<Slider ariaLabel="Speed" value={speed} onChange={(v) => setSpeed(Math.round(v * 20) / 20)} min={SPEED_MIN} max={SPEED_MAX} step={0.05} />
						</div>
					</div>
				</div>

				<div className="mt-6">
					<div className="mb-2 flex items-end justify-between gap-3">
						<div>
							<h3 className="text-[13px] font-semibold">Pronunciation</h3>
							<p className="text-[12px] text-muted-foreground">Write a word the way it should sound, for example SQL → sequel. Whole words only.</p>
						</div>
						<Button variant="outline" size="sm" onClick={add} disabled={rows.length >= LEXICON_MAX}>
							<Plus />
							Add word
						</Button>
					</div>
					{rows.length ? (
						<div className="max-h-64 overflow-y-auto rounded-xl border">
							<div className="grid grid-cols-[1fr_1.3fr_auto_auto_auto] items-center gap-x-2 border-b bg-subtle px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
								<span>Written</span>
								<span>Say it as</span>
								<span>Exact case</span>
								<span className="sr-only">Listen</span>
								<span className="sr-only">Remove</span>
							</div>
							{rows.map((r, i) => (
								<div key={r.key} className="grid grid-cols-[1fr_1.3fr_auto_auto_auto] items-center gap-x-2 border-b px-3 py-1.5 last:border-b-0">
									<Input
										ref={i === rows.length - 1 ? lastRow : undefined}
										aria-label={`Written word ${i + 1}`}
										value={r.word}
										maxLength={60}
										placeholder="SQL"
										onChange={(e) => update(r.key, { word: e.target.value })}
										className="h-8"
									/>
									<Input aria-label={`Say word ${i + 1} as`} value={r.say} maxLength={120} placeholder="sequel" onChange={(e) => update(r.key, { say: e.target.value })} className="h-8" />
									<div className="flex justify-center">
										<Switch checked={r.matchCase} onChange={(v) => update(r.key, { matchCase: v })} ariaLabel={`Match case for word ${i + 1}`} />
									</div>
									<Tooltip content="Listen">
										<Button variant="ghost" size="icon-sm" aria-label={`Listen to word ${i + 1}`} disabled={!r.say.trim() || !status.engineReady || listening !== null} onClick={() => void listen(r)}>
											{listening === r.key ? <Loader2 className="animate-spin" /> : <Play />}
										</Button>
									</Tooltip>
									<Tooltip content="Remove">
										<Button variant="danger-ghost" size="icon-sm" aria-label={`Remove word ${i + 1}`} onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>
											<Trash2 />
										</Button>
									</Tooltip>
								</div>
							))}
						</div>
					) : (
						<p className="rounded-xl border border-dashed px-4 py-5 text-center text-[13px] text-muted-foreground">No pronunciation rules yet.</p>
					)}
				</div>

				<DialogFooter>
					<Button variant="ghost" onClick={() => void close()}>
						Cancel
					</Button>
					<Button onClick={() => void save()} loading={saving} disabled={!changed}>
						Save
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

/** Small play button for one sentence's clip. */
export function ClipButton({ src, className }: { src: string; className?: string }) {
	const [playing, setPlaying] = useState(false);
	const toggle = () => {
		if (playing) {
			current?.pause();
			setPlaying(false);
			return;
		}
		const a = playOnce(src);
		setPlaying(true);
		const end = () => setPlaying(false);
		a.addEventListener("ended", end);
		a.addEventListener("pause", end);
		a.addEventListener("error", end);
	};
	return (
		<button
			type="button"
			aria-label={playing ? "Stop clip" : "Play clip"}
			onClick={toggle}
			className={cn("rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground", className)}
		>
			{playing ? <Square className="size-3" /> : <Play className="size-3" />}
		</button>
	);
}
