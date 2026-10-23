import { Link, useNavigate } from "@tanstack/react-router";
import {
	ArrowDown,
	ArrowRight,
	ArrowUp,
	Check,
	CheckCircle2,
	CircleAlert,
	CircleDashed,
	Clapperboard,
	Clock,
	Coins,
	Gauge,
	ListChecks,
	Loader2,
	Pencil,
	Plus,
	RefreshCw,
	ShieldCheck,
	Sparkles,
	Square,
	Trash2,
	Wand2,
	X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { LEVELS, type Level } from "@shared/ipc/ingest";
import { plannerChannels as pc, type PlanDraft, type PlannerUpdate } from "@shared/ipc/planner";
import { voiceChannels, type Voice } from "@shared/ipc/voice";
import { computeTimeline, formatTime } from "@shared/plan/timing";
import { LANGUAGES, Outline, TARGET_MINUTES, TONES, type Estimate, type OutlineChapter, type PlanSettings, type PlanStep, type QualityReport, type Tone } from "@shared/planner";
import { Button } from "@renderer/components/ui/button";
import { confirm } from "@renderer/components/ui/confirm";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label, Textarea, Tooltip } from "@renderer/components/ui/primitives";
import { Select } from "@renderer/components/ui/select";
import { usd } from "@renderer/lib/format";
import { call, errorText } from "@renderer/lib/ipc";
import { cn } from "@renderer/lib/utils";
import { usePlanner } from "@renderer/stores/planner";

/* ---------- helpers ---------- */

/** Speaking speed per level, mirrored from main for live hints (the plan stores the real value). */
const WPM: Record<Level, number> = { Kindergarten: 115, Primary: 125, "Middle school": 135, "High school": 145, College: 155, University: 160, PhD: 170 };

const wordCount = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;
const isLevel = (v: string): v is Level => (LEVELS as readonly string[]).includes(v);

function seconds(n: number): string {
	if (n < 60) return `${Math.max(1, Math.round(n))} s`;
	const m = Math.round(n / 60);
	return `${m} min`;
}

function costText(e: Estimate): string {
	if (e.billing === "free") return "Free";
	if (!e.costUsd) return "Unknown";
	const lo = usd(e.costUsd.low);
	const hi = usd(e.costUsd.high);
	return lo === hi ? lo : `${lo} – ${hi}`;
}

const BILLING: Record<Estimate["billing"], { label: string; tone: "success" | "primary" | "warning" | "neutral" }> = {
	free: { label: "Free", tone: "success" },
	subscription: { label: "Subscription", tone: "primary" },
	api: { label: "Paid per use", tone: "warning" },
	unknown: { label: "Price unknown", tone: "neutral" },
};

/** Asks before a run that may cost money. Free and subscription runs start at once. */
async function confirmCost(e: Estimate, what: string): Promise<boolean | null> {
	if (!e.needsConfirm) return false;
	const ok = await confirm({
		title: e.costUsd ? `Start a paid run (${costText(e)})?` : "Start a run with an unknown price?",
		description: (
			<span className="block space-y-2">
				<span className="block">
					{what} uses <b>{e.provider}</b> · {e.model}, which charges per use.
				</span>
				<span className="block">
					{e.costUsd
						? `Estimated cost: ${costText(e)} for about ${e.calls} AI calls (${Math.round(e.inputTokens / 1000)}k tokens in, ${Math.round(e.outputTokens / 1000)}k out). The real cost is shown in Settings → AI providers → Usage.`
						: "The price of this model is not known, so the cost cannot be estimated. Check your provider's prices first."}
				</span>
			</span>
		),
		confirmLabel: "Start",
		cancelLabel: "Cancel",
	});
	return ok ? true : null;
}

/* ---------- stepper ---------- */

function Stepper({ stage }: { stage: 1 | 2 | 3 | 4 }) {
	const steps = ["Material", "Outline", "Script and scenes", "Preview"];
	return (
		<ol className="mb-6 flex items-center gap-2" aria-label="Steps">
			{steps.map((s, i) => {
				const n = i + 1;
				const done = n < stage;
				const now = n === stage;
				return (
					<li key={s} className="flex items-center gap-2" aria-current={now ? "step" : undefined}>
						<span
							className={cn(
								"grid size-6 place-items-center rounded-full text-[11px] font-semibold",
								done ? "bg-success text-white" : now ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
							)}
						>
							{done ? <Check className="size-3.5" /> : n}
						</span>
						<span className={cn("text-[13px]", now ? "font-semibold" : "text-muted-foreground")}>{s}</span>
						{n < steps.length ? <span className="mx-1 h-px w-8 bg-border" /> : null}
					</li>
				);
			})}
		</ol>
	);
}

/* ---------- settings ---------- */

function SettingsCard({ settings, onChange, disabled }: { settings: PlanSettings; onChange: (s: PlanSettings) => void; disabled: boolean }) {
	const [voices, setVoices] = useState<Voice[]>([]);
	useEffect(() => {
		void call(voiceChannels.voices)
			.then(setVoices)
			.catch(() => setVoices([]));
	}, []);
	const set = <K extends keyof PlanSettings>(k: K, v: PlanSettings[K]) => onChange({ ...settings, [k]: v });
	const voiceOptions = voices.length
		? voices.map((v) => ({ value: v.id, label: `${v.name} · ${v.accent}`, hint: v.recommended ? "Recommended" : undefined }))
		: settings.voice
			? [{ value: settings.voice, label: settings.voice }]
			: [];
	return (
		<Card>
			<CardHeader>
				<CardTitle>Video settings</CardTitle>
				<CardDescription>Used for the next step. You can change them before each run.</CardDescription>
			</CardHeader>
			<CardContent className="space-y-3.5">
				<Field label="Audience">
					<Select<Level> ariaLabel="Audience level" value={settings.level} onChange={(v) => set("level", v)} options={LEVELS.map((l) => ({ value: l, label: l }))} disabled={disabled} />
				</Field>
				<div className="grid grid-cols-2 gap-3">
					<Field label="Language">
						<Select ariaLabel="Language" value={settings.language} onChange={(v) => set("language", v)} options={LANGUAGES.map((l) => ({ value: l.code, label: l.label }))} disabled={disabled} />
					</Field>
					<Field label="Tone">
						<Select<Tone> ariaLabel="Tone" value={settings.tone} onChange={(v) => set("tone", v)} options={TONES.map((t) => ({ value: t, label: t }))} disabled={disabled} />
					</Field>
				</div>
				{settings.language !== "en" ? <p className="text-[12px] text-warning">The voice reads English only for now. The script and captions use this language.</p> : null}
				<Field label="Length">
					<Select
						ariaLabel="Target length"
						value={settings.targetMinutes ? String(settings.targetMinutes) : "auto"}
						onChange={(v) => set("targetMinutes", v === "auto" ? null : Number(v))}
						options={[{ value: "auto", label: "As long as needed", hint: "Default" }, ...TARGET_MINUTES.map((m) => ({ value: String(m), label: `About ${m} minutes` }))]}
						disabled={disabled}
					/>
				</Field>
				<Field label="Voice">
					<Select
						ariaLabel="Voice"
						value={settings.voice}
						onChange={(v) => set("voice", v)}
						options={voiceOptions}
						placeholder={voices.length ? "Default voice" : "Install the voice engine to pick"}
						disabled={disabled || !voiceOptions.length}
					/>
				</Field>
				<Field label="Visual style">
					<Select<PlanSettings["style"]>
						ariaLabel="Visual style"
						value={settings.style}
						onChange={(v) => set("style", v)}
						options={[
							{ value: "auto", label: "Let AI decide", hint: "From topic and level" },
							{ value: "clean", label: "Clean" },
							{ value: "chalkboard", label: "Chalkboard" },
						]}
						disabled={disabled}
					/>
				</Field>
			</CardContent>
		</Card>
	);
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<div className="space-y-1.5">
			<Label className="text-[12px] text-muted-foreground">{label}</Label>
			{children}
		</div>
	);
}

/* ---------- estimate ---------- */

function useEstimate(draftId: string, step: PlanStep | null, settings: PlanSettings, outline: Outline | null) {
	const [est, setEst] = useState<{ value: Estimate | null; error: string | null; loading: boolean }>({ value: null, error: null, loading: false });
	const key = JSON.stringify([step, settings, step === "script" ? outline?.chapters.map((c) => [c.minutes, c.sources]) : null]);
	useEffect(() => {
		if (!step) return;
		let live = true;
		setEst((e) => ({ ...e, loading: true }));
		const t = setTimeout(() => {
			void call(pc.estimate, { draftId, step, settings, outline: step === "script" && outline ? outline : undefined })
				.then((value) => live && setEst({ value, error: null, loading: false }))
				.catch((err) => live && setEst({ value: null, error: errorText(err), loading: false }));
		}, 350);
		return () => {
			live = false;
			clearTimeout(t);
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [draftId, key]);
	return est;
}

function EstimateCard({ step, est }: { step: PlanStep; est: ReturnType<typeof useEstimate> }) {
	const e = est.value;
	return (
		<Card>
			<CardHeader>
				<CardTitle>Before you run</CardTitle>
				<CardDescription>{step === "outline" ? "Writing the outline" : "Writing the script, then checking facts, level and pacing"}</CardDescription>
			</CardHeader>
			<CardContent>
				{est.error ? (
					<div className="space-y-2 text-[13px]">
						<p className="flex gap-2 text-danger">
							<CircleAlert className="mt-0.5 size-4 shrink-0" />
							{est.error}
						</p>
						<Link to="/settings" search={{ section: "ai" }} className="font-medium text-primary hover:underline">
							Open AI providers
						</Link>
					</div>
				) : !e ? (
					<p className="flex items-center gap-2 text-[13px] text-muted-foreground">
						<Loader2 className="size-4 animate-spin" /> Estimating…
					</p>
				) : (
					<div className={cn("space-y-3 transition-opacity", est.loading && "opacity-60")} aria-live="polite">
						<div className="flex items-center justify-between gap-2">
							<span className="min-w-0 truncate text-[13px] font-medium" title={`${e.provider} · ${e.model}`}>
								{e.provider} · {e.model}
							</span>
							<Badge tone={BILLING[e.billing].tone}>{BILLING[e.billing].label}</Badge>
						</div>
						<dl className="grid grid-cols-2 gap-2">
							<div className="rounded-lg border bg-subtle px-3 py-2">
								<dt className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
									<Coins className="size-3.5" /> Cost
								</dt>
								<dd className="text-[14px] font-semibold tabular-nums" data-testid="estimate-cost">
									{e.billing === "subscription" ? "Included" : costText(e)}
								</dd>
							</div>
							<div className="rounded-lg border bg-subtle px-3 py-2">
								<dt className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
									<Clock className="size-3.5" /> Time
								</dt>
								<dd className="text-[14px] font-semibold tabular-nums">
									{seconds(e.seconds.low)} – {seconds(e.seconds.high)}
								</dd>
							</div>
						</dl>
						<p className="text-[12px] text-muted-foreground">
							About {e.calls} AI calls · {Math.round(e.inputTokens / 1000)}k tokens in · {Math.round(e.outputTokens / 1000)}k out
							{e.billing === "subscription" ? " · covered by your Claude plan" : ""}
							{e.needsConfirm ? " · you confirm before it starts" : ""}
						</p>
					</div>
				)}
			</CardContent>
		</Card>
	);
}

/* ---------- running ---------- */

const CHAPTER_STATE: Record<NonNullable<PlannerUpdate["chapters"]>[number], { label: string; icon: React.ReactNode }> = {
	waiting: { label: "Waiting", icon: <CircleDashed className="size-4 text-muted-foreground" /> },
	writing: { label: "Writing", icon: <Loader2 className="size-4 animate-spin text-primary" /> },
	checking: { label: "Checking facts and level", icon: <ShieldCheck className="size-4 animate-pulse text-primary" /> },
	fixing: { label: "Fixing flagged sentences", icon: <Wand2 className="size-4 animate-pulse text-warning" /> },
	done: { label: "Done", icon: <CheckCircle2 className="size-4 text-success" /> },
};

function RunningCard({ update, outline, estimate }: { update: PlannerUpdate; outline: Outline | null; estimate: Estimate | null }) {
	const [now, setNow] = useState(Date.now());
	const [t0] = useState(Date.now());
	useEffect(() => {
		const t = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(t);
	}, []);
	const pct = Math.round(update.progress * 100);
	const single = update.step === "outline" && update.progress < 0.6;
	const stop = async () => {
		const ok = await confirm({ title: "Stop planning?", description: "The work of this run is thrown away. Your outline and script stay as they were.", confirmLabel: "Stop", cancelLabel: "Keep going", tone: "danger" });
		if (ok) await call(pc.cancel, { jobId: update.jobId }).catch((err) => toast.error("Could not stop", { description: errorText(err) }));
	};
	return (
		<Card aria-live="polite">
			<CardHeader>
				<div className="flex items-center gap-2">
					<Loader2 className="size-4 animate-spin text-primary" />
					<CardTitle>{update.step === "outline" ? "Writing the outline" : update.step === "script" ? "Writing the script and scenes" : update.step === "scene" ? "Rewriting one scene" : "Rewriting one chapter"}</CardTitle>
				</div>
				<CardDescription>
					{update.detail} · {seconds((now - t0) / 1000)} so far{estimate ? ` · usually ${seconds(estimate.seconds.low)} – ${seconds(estimate.seconds.high)}` : ""}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-5">
				<div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="Planning progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={single ? undefined : pct}>
					{single ? <div className="h-full w-1/3 animate-[indeterminate_1.4s_ease-in-out_infinite] rounded-full bg-primary" /> : <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${pct}%` }} />}
				</div>
				{update.chapters && outline ? (
					<ol className="divide-y rounded-xl border">
						{update.chapters.map((c, i) => (
							<li key={i} className="flex items-center gap-3 px-3.5 py-2.5 text-[13px]">
								{CHAPTER_STATE[c].icon}
								<span className="w-6 tabular-nums text-muted-foreground">{i + 1}</span>
								<span className="min-w-0 flex-1 truncate font-medium">{outline.chapters[i]?.title}</span>
								<span className={cn("text-[12px]", c === "done" ? "text-success" : "text-muted-foreground")}>{CHAPTER_STATE[c].label}</span>
							</li>
						))}
					</ol>
				) : null}
				<Button variant="outline" onClick={() => void stop()}>
					<Square className="fill-current" />
					Stop
				</Button>
			</CardContent>
		</Card>
	);
}

/* ---------- outline editor ---------- */

let chapterSeq = 0;

function OutlineEditor({ outline, onChange, level, disabled }: { outline: Outline; onChange: (o: Outline) => void; level: Level; disabled: boolean }) {
	const set = (patch: Partial<Outline>) => onChange({ ...outline, ...patch, approved: false });
	const setChapter = (i: number, patch: Partial<OutlineChapter>) => set({ chapters: outline.chapters.map((c, k) => (k === i ? { ...c, ...patch } : c)) });
	const move = (i: number, d: -1 | 1) => {
		const cs = [...outline.chapters];
		const [c] = cs.splice(i, 1);
		cs.splice(i + d, 0, c!);
		set({ chapters: cs });
	};
	const remove = async (i: number) => {
		const c = outline.chapters[i]!;
		if (await confirm({ title: `Delete chapter ${i + 1}?`, description: `"${c.title}" and its key points are removed from the outline.`, confirmLabel: "Delete", tone: "danger" }))
			set({ chapters: outline.chapters.filter((_, k) => k !== i) });
	};
	const add = () =>
		set({ chapters: [...outline.chapters, { id: `new${++chapterSeq}-${Date.now() % 100000}`, title: "New chapter", goal: "What the viewer can do after this chapter.", keyPoints: ["First point"], sources: [], minutes: 2 }] });
	const hookText = outline.hook.join("\n");
	const hookSeconds = (wordCount(hookText) / WPM[level]) * 60;
	const total = outline.chapters.reduce((n, c) => n + c.minutes, 0);

	return (
		<div className="space-y-4">
			<Card>
				<CardHeader>
					<CardTitle>Title and hook</CardTitle>
					<CardDescription>The hook is the first 15 seconds. It decides if viewers stay.</CardDescription>
				</CardHeader>
				<CardContent className="space-y-3">
					<div className="grid grid-cols-2 gap-3">
						<Field label="Title">
							<Input aria-label="Video title" value={outline.title} maxLength={120} disabled={disabled} onChange={(e) => set({ title: e.target.value })} aria-invalid={!outline.title.trim()} />
						</Field>
						<Field label="Subtitle">
							<Input aria-label="Video subtitle" value={outline.subtitle} maxLength={200} disabled={disabled} onChange={(e) => set({ subtitle: e.target.value })} />
						</Field>
					</div>
					<Field label="Hook (one sentence per line)">
						<Textarea
							aria-label="Hook"
							rows={3}
							value={hookText}
							disabled={disabled}
							onChange={(e) => set({ hook: e.target.value.split("\n").slice(0, 4) })}
							aria-invalid={!outline.hook.some((h) => h.trim())}
						/>
					</Field>
					<p className={cn("text-[12px]", hookSeconds > 15 ? "text-warning" : "text-muted-foreground")}>
						About {Math.round(hookSeconds)} s when spoken{hookSeconds > 15 ? ". Shorten it to keep it under 15 s." : "."}
					</p>
				</CardContent>
			</Card>

			<div className="flex items-center justify-between px-1">
				<h2 className="text-[15px] font-semibold tracking-tight">Chapters</h2>
				<span className="text-[12px] tabular-nums text-muted-foreground">
					{outline.chapters.length} chapters · about {Math.round(total)} min
				</span>
			</div>
			<ol className="space-y-3">
				{outline.chapters.map((c, i) => (
					<li key={c.id}>
						<Card className="p-4">
							<div className="flex items-center gap-2">
								<span className="grid size-7 shrink-0 place-items-center rounded-lg bg-primary-soft text-[12px] font-semibold text-primary-soft-foreground">{i + 1}</span>
								<Input
									aria-label={`Chapter ${i + 1} title`}
									value={c.title}
									maxLength={120}
									disabled={disabled}
									onChange={(e) => setChapter(i, { title: e.target.value })}
									className="h-8 font-medium"
									aria-invalid={!c.title.trim()}
								/>
								<div className="flex shrink-0 items-center gap-1">
									<Input
										aria-label={`Chapter ${i + 1} minutes`}
										type="number"
										min={0.5}
										max={60}
										step={0.5}
										value={c.minutes}
										disabled={disabled}
										onChange={(e) => setChapter(i, { minutes: Math.min(60, Math.max(0.5, Number(e.target.value) || 0.5)) })}
										className="h-8 w-[4.5rem] text-right tabular-nums"
									/>
									<span className="mr-1 text-[12px] text-muted-foreground">min</span>
									<Tooltip content="Move up">
										<Button variant="ghost" size="icon-sm" aria-label={`Move chapter ${i + 1} up`} disabled={disabled || i === 0} onClick={() => move(i, -1)}>
											<ArrowUp />
										</Button>
									</Tooltip>
									<Tooltip content="Move down">
										<Button variant="ghost" size="icon-sm" aria-label={`Move chapter ${i + 1} down`} disabled={disabled || i === outline.chapters.length - 1} onClick={() => move(i, 1)}>
											<ArrowDown />
										</Button>
									</Tooltip>
									<Tooltip content="Delete chapter">
										<Button variant="ghost" size="icon-sm" aria-label={`Delete chapter ${i + 1}`} disabled={disabled || outline.chapters.length === 1} onClick={() => void remove(i)}>
											<Trash2 />
										</Button>
									</Tooltip>
								</div>
							</div>
							<div className="mt-3 space-y-3 pl-9">
								<Field label="Goal">
									<Textarea aria-label={`Chapter ${i + 1} goal`} rows={2} value={c.goal} maxLength={300} disabled={disabled} onChange={(e) => setChapter(i, { goal: e.target.value })} aria-invalid={!c.goal.trim()} />
								</Field>
								<div className="space-y-1.5">
									<Label className="text-[12px] text-muted-foreground">Key points</Label>
									<ul className="space-y-1.5">
										{c.keyPoints.map((p, k) => (
											<li key={k} className="flex items-center gap-1.5">
												<span className="size-1.5 shrink-0 rounded-full bg-muted-foreground/50" />
												<Input
													aria-label={`Chapter ${i + 1} point ${k + 1}`}
													value={p}
													maxLength={200}
													disabled={disabled}
													onChange={(e) => setChapter(i, { keyPoints: c.keyPoints.map((x, j) => (j === k ? e.target.value : x)) })}
													className="h-8 text-[13px]"
												/>
												<Button
													variant="ghost"
													size="icon-sm"
													aria-label={`Remove point ${k + 1} of chapter ${i + 1}`}
													disabled={disabled || c.keyPoints.length === 1}
													onClick={() => setChapter(i, { keyPoints: c.keyPoints.filter((_, j) => j !== k) })}
												>
													<X />
												</Button>
											</li>
										))}
									</ul>
									{c.keyPoints.length < 10 ? (
										<Button variant="ghost" size="sm" disabled={disabled} onClick={() => setChapter(i, { keyPoints: [...c.keyPoints, ""] })}>
											<Plus />
											Add point
										</Button>
									) : null}
								</div>
								{c.sources.length ? <p className="text-[11px] text-muted-foreground">Uses {c.sources.length} section(s) of your material.</p> : null}
							</div>
						</Card>
					</li>
				))}
			</ol>
			{outline.chapters.length < 40 ? (
				<Button variant="outline" disabled={disabled} onClick={add}>
					<Plus />
					Add chapter
				</Button>
			) : null}
		</div>
	);
}

/* ---------- result ---------- */

function QualityPanel({ report }: { report: QualityReport }) {
	const factOpen = report.fact.issues.filter((i) => i.status === "open");
	const factFixed = report.fact.issues.filter((i) => i.status === "fixed");
	const levelOpen = report.level.issues.filter((i) => i.status === "open");
	const levelFixed = report.level.issues.filter((i) => i.status === "fixed");
	const rows = [
		{
			icon: ShieldCheck,
			title: "Fact check",
			ok: !factOpen.length,
			summary: `${report.fact.checked} sentences checked against your material. ${report.fact.issues.length ? `${report.fact.issues.length} flagged, ${factFixed.length} fixed.` : "Nothing flagged."}`,
			items: report.fact.issues.map((i) => ({
				key: i.ref,
				tone: i.status === "fixed" ? "fixed" : "open",
				text: `${i.problem === "contradicted" ? "Contradicts the material" : "Not in the material"}: “${i.sentence}”`,
				note: i.status === "fixed" ? `Now: “${i.fixed}”` : i.note,
			})),
		},
		{
			icon: ListChecks,
			title: "Level check",
			ok: !levelOpen.length,
			summary: `Sentences average ${report.level.avgWords} words (limit ${report.level.maxWords}). ${report.level.issues.length ? `${levelFixed.length} fixed, ${levelOpen.length} to look at.` : "All within the level."}`,
			items: report.level.issues.map((i) => ({ key: `${i.ref}:${i.kind}`, tone: i.status, text: `“${i.sentence}”`, note: i.detail })),
		},
		{
			icon: Gauge,
			title: "Pacing check",
			ok: !report.pacing.issues.length,
			summary: report.pacing.issues.length ? `${report.pacing.issues.length} scene(s) to look at.` : "No scene is too dense or too empty.",
			items: report.pacing.issues.map((i) => ({ key: `${i.sceneId}:${i.kind}`, tone: "open", text: `Scene ${i.sceneId}`, note: i.detail })),
		},
	];
	return (
		<div className="divide-y rounded-xl border">
			{rows.map((r) => (
				<details key={r.title} className="group px-4 py-3" open={!r.ok}>
					<summary className="flex cursor-pointer list-none items-center gap-3">
						<r.icon className={cn("size-4 shrink-0", r.ok ? "text-success" : "text-warning")} />
						<span className="text-[13px] font-medium">{r.title}</span>
						<span className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground">{r.summary}</span>
						{r.items.length ? <Badge tone={r.ok ? "success" : "warning"}>{r.items.length}</Badge> : <Badge tone="success">OK</Badge>}
					</summary>
					{r.items.length ? (
						<ul className="mt-3 space-y-2 pl-7">
							{r.items.slice(0, 30).map((it) => (
								<li key={it.key} className="text-[12px]" data-selectable>
									<div className="flex items-start gap-2">
										<Badge tone={it.tone === "fixed" ? "success" : "warning"} className="mt-px shrink-0">
											{it.tone === "fixed" ? "Fixed" : "Check"}
										</Badge>
										<span>{it.text}</span>
									</div>
									<p className="mt-0.5 pl-[3.25rem] text-muted-foreground">{it.note}</p>
								</li>
							))}
						</ul>
					) : null}
				</details>
			))}
		</div>
	);
}

function PlanResult({ draft, onRewrite, onEditOutline }: { draft: PlanDraft; onRewrite: () => void; onEditOutline: () => void }) {
	const navigate = useNavigate();
	const plan = draft.plan!;
	const timeline = useMemo(() => computeTimeline(plan), [plan]);
	const sentences = plan.chapters.reduce((n, c) => n + c.scenes.reduce((k, s) => k + s.narration.length, 0), 0);
	const types = new Set(plan.chapters.flatMap((c) => c.scenes.map((s) => s.type)));
	return (
		<Card>
			<CardHeader>
				<div className="flex items-center gap-2">
					<Badge tone="success">Plan ready</Badge>
					<span className="text-[12px] text-muted-foreground">
						{plan.meta.level} · {plan.meta.style === "chalkboard" ? "Chalkboard" : "Clean"} style
					</span>
				</div>
				<CardTitle className="mt-1 text-lg" data-selectable>
					{plan.meta.title}
				</CardTitle>
			</CardHeader>
			<CardContent className="space-y-4">
				<dl className="grid grid-cols-4 gap-3">
					{[
						{ k: "Length", v: formatTime(timeline.durationInFrames, timeline.fps) },
						{ k: "Chapters", v: String(plan.chapters.length) },
						{ k: "Scenes", v: String(timeline.scenes.length) },
						{ k: "Sentences", v: String(sentences) },
					].map((x) => (
						<div key={x.k} className="rounded-xl border bg-subtle px-3.5 py-3">
							<dt className="text-[12px] text-muted-foreground">{x.k}</dt>
							<dd className="mt-0.5 text-[15px] font-semibold tabular-nums">{x.v}</dd>
						</div>
					))}
				</dl>
				<p className="text-[12px] text-muted-foreground">
					Scene types: {[...types].join(", ")}. Length is estimated until the voice is made.
					{draft.report?.targetMinutes ? ` Target was about ${draft.report.targetMinutes} min.` : ""}
				</p>
				{draft.report ? <QualityPanel report={draft.report} /> : null}
				<div className="flex flex-wrap gap-2">
					<Button onClick={() => void navigate({ to: "/studio", search: { draft: draft.id } })}>
						<Clapperboard />
						Open in Studio
					</Button>
					<Button variant="outline" onClick={onEditOutline}>
						<Pencil />
						Edit outline
					</Button>
					<Button variant="ghost" onClick={onRewrite}>
						<RefreshCw />
						Write script again
					</Button>
				</div>
			</CardContent>
		</Card>
	);
}

/* ---------- page ---------- */

function defaultSettings(d: PlanDraft, voice: string | undefined): PlanSettings {
	return d.settings ?? { level: isLevel(d.level) ? d.level : "High school", language: "en", tone: "Friendly", targetMinutes: null, voice, style: "auto" };
}

export function PlanWizard({ draftId }: { draftId: string }) {
	const [draft, setDraft] = useState<PlanDraft | null>(null);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [settings, setSettings] = useState<PlanSettings | null>(null);
	const [outline, setOutline] = useState<Outline | null>(null);
	const [saving, setSaving] = useState<"idle" | "saving" | "saved" | "error">("idle");
	const [editOutline, setEditOutline] = useState(false);
	const live = usePlanner((s) => s.byDraft[draftId]);
	const finished = usePlanner((s) => s.finished[draftId] ?? 0);
	const dirty = useRef(false);

	// Load, and reload when a run for this draft ends.
	useEffect(() => {
		let on = true;
		void (async () => {
			try {
				const d = await call(pc.get, { draftId });
				if (!on) return;
				const voice = d.settings?.voice ?? (await call(voiceChannels.getSettings).then((v) => v.voice).catch(() => undefined));
				setDraft(d);
				setSettings((s) => (s && finished ? s : defaultSettings(d, voice)));
				setOutline(d.outline);
				dirty.current = false;
				if (d.running) usePlanner.setState((s) => ({ byDraft: { ...s.byDraft, [draftId]: d.running! } }));
			} catch (err) {
				if (on) setLoadError(errorText(err));
			}
		})();
		return () => {
			on = false;
		};
	}, [draftId, finished]);

	// Autosave outline edits.
	useEffect(() => {
		if (!outline || !dirty.current) return;
		const r = Outline.safeParse(outline);
		if (!r.success) return;
		setSaving("saving");
		const t = setTimeout(() => {
			void call(pc.saveOutline, { draftId, outline: r.data })
				.then(() => setSaving("saved"))
				.catch((err) => {
					setSaving("error");
					toast.error("Could not save the outline", { description: errorText(err) });
				});
		}, 700);
		return () => clearTimeout(t);
	}, [outline, draftId]);

	const running = live?.state === "running" ? live : null;
	const hasPlan = !!draft?.plan;
	const showEditor = !!outline && (!hasPlan || editOutline);
	const nextStep: PlanStep | null = running ? null : !outline ? "outline" : showEditor ? "script" : null;
	const est = useEstimate(draftId, nextStep ?? (running ? running.step : null), settings ?? defaultSettings(draft ?? ({ level: "High school" } as PlanDraft), undefined), outline);

	if (loadError)
		return (
			<Card>
				<CardHeader>
					<CardTitle>Could not open this draft</CardTitle>
					<CardDescription>{loadError}</CardDescription>
				</CardHeader>
				<CardContent>
					<Button variant="outline" asChild>
						<Link to="/new">Back to New video</Link>
					</Button>
				</CardContent>
			</Card>
		);
	if (!draft || !settings)
		return (
			<p className="flex items-center gap-2 text-[13px] text-muted-foreground">
				<Loader2 className="size-4 animate-spin" /> Opening the draft…
			</p>
		);

	const outlineValid = outline ? Outline.safeParse(outline).success && outline.chapters.every((c) => c.keyPoints.every((p) => p.trim())) : false;

	const runOutline = async () => {
		if (outline && !(await confirm({ title: "Write a new outline?", description: "The AI writes a fresh outline. Your current outline and any edits are replaced.", confirmLabel: "Write new outline", tone: "danger" }))) return;
		try {
			const e = await call(pc.estimate, { draftId, step: "outline", settings });
			const confirmed = await confirmCost(e, "Writing the outline");
			if (confirmed === null) return;
			await call(pc.outline, { draftId, settings, confirmedCost: confirmed });
		} catch (err) {
			toast.error("Could not start", { description: errorText(err) });
		}
	};

	const runScript = async () => {
		if (!outline) return;
		if (hasPlan && !(await confirm({ title: "Write the script again?", description: "The current script and scenes are replaced by a new version from this outline.", confirmLabel: "Write again", tone: "danger" }))) return;
		try {
			const approved = Outline.parse({ ...outline, approved: true, chapters: outline.chapters.map((c) => ({ ...c, keyPoints: c.keyPoints.filter((p) => p.trim()) })) });
			const e = await call(pc.estimate, { draftId, step: "script", settings, outline: approved });
			const confirmed = await confirmCost(e, "Writing the script");
			if (confirmed === null) return;
			await call(pc.saveOutline, { draftId, outline: approved });
			dirty.current = false;
			setOutline(approved);
			setEditOutline(false);
			await call(pc.script, { draftId, settings, confirmedCost: confirmed });
		} catch (err) {
			toast.error("Could not start", { description: errorText(err) });
		}
	};

	const stage = hasPlan && !editOutline ? 4 : running?.step === "script" || (outline?.approved && !editOutline) ? 3 : 2;

	return (
		<div>
			<Stepper stage={stage} />
			<div className="grid grid-cols-[1fr_340px] items-start gap-5">
				<div className="min-w-0 space-y-4">
					{running ? (
						<RunningCard update={running} outline={outline} estimate={est.value} />
					) : !outline ? (
						<Card>
							<CardHeader>
								<CardTitle>Plan the video</CardTitle>
								<CardDescription>
									The AI reads “{draft.title}” and writes an outline: chapters, a learning goal for each, key points and a 15-second hook. You check and change it before any script is written.
								</CardDescription>
							</CardHeader>
							<CardContent className="space-y-4">
								<ul className="space-y-2 text-[13px] text-muted-foreground">
									<li className="flex gap-2">
										<Sparkles className="mt-0.5 size-4 shrink-0 text-primary" /> Pace, words and scene types follow the audience: {settings.level}.
									</li>
									<li className="flex gap-2">
										<ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" /> Later, every sentence is checked against your material.
									</li>
								</ul>
								<Button onClick={() => void runOutline()} disabled={!!est.error}>
									Write the outline <ArrowRight />
								</Button>
							</CardContent>
						</Card>
					) : showEditor ? (
						<>
							<div className="flex items-center gap-3 rounded-xl border bg-card px-4 py-3">
								<div className="min-w-0 flex-1">
									<p className="text-[13px] font-medium">{hasPlan ? "Edit the outline, then write the script again" : "Check the outline"}</p>
									<p className="text-[12px] text-muted-foreground">
										Change titles, goals, points and minutes. Changes save by themselves
										{saving === "saving" ? " · Saving…" : saving === "saved" ? " · Saved" : saving === "error" ? " · Not saved" : ""}.
									</p>
								</div>
								<Button variant="ghost" size="sm" onClick={() => void runOutline()}>
									<RefreshCw />
									New outline
								</Button>
								{hasPlan ? (
									<Button variant="ghost" size="sm" onClick={() => setEditOutline(false)}>
										Cancel
									</Button>
								) : null}
								<Button size="sm" onClick={() => void runScript()} disabled={!outlineValid || !!est.error}>
									<Check />
									Approve and write script
								</Button>
							</div>
							<OutlineEditor
								outline={outline}
								level={settings.level}
								disabled={false}
								onChange={(o) => {
									dirty.current = true;
									setOutline(o);
								}}
							/>
						</>
					) : hasPlan ? (
						<PlanResult draft={draft} onRewrite={() => void runScript()} onEditOutline={() => setEditOutline(true)} />
					) : null}
				</div>
				<div className="space-y-5">
					<SettingsCard settings={settings} onChange={setSettings} disabled={!!running} />
					{nextStep || running ? <EstimateCard step={nextStep ?? running!.step} est={est} /> : null}
				</div>
			</div>
		</div>
	);
}
