import {
	Activity,
	AlertCircle,
	ArrowLeft,
	Bot,
	CheckCircle2,
	ExternalLink,
	Eye,
	EyeOff,
	KeyRound,
	Loader2,
	MoreHorizontal,
	Pencil,
	Plus,
	RefreshCw,
	Star,
	Trash2,
	X,
	Zap,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
	aiChannels as ch,
	MODEL_SLOTS,
	PROVIDER_KINDS,
	PROVIDER_META,
	SLOT_META,
	type ModelSlot,
	type ProviderKind,
	type ProviderView,
	type TestResult,
	type UsageRow,
	type UsageSummary,
} from "@shared/ipc/ai";
import { Button } from "@renderer/components/ui/button";
import { Combobox } from "@renderer/components/ui/combobox";
import { confirm } from "@renderer/components/ui/confirm";
import { Dialog, DialogContent, DialogFooter } from "@renderer/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, EmptyState, Segmented } from "@renderer/components/ui/misc";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label, Tooltip } from "@renderer/components/ui/primitives";
import { Select } from "@renderer/components/ui/select";
import { Switch } from "@renderer/components/ui/switch";
import { compactNumber, timeAgo, usd } from "@renderer/lib/format";
import { call, errorText } from "@renderer/lib/ipc";
import { cn } from "@renderer/lib/utils";
import { forgetModels, providerModels, useAi } from "@renderer/stores/ai";

/* ---------- small pieces ---------- */

const KIND_TINT: Record<ProviderKind, string> = {
	opencode: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400",
	anthropic: "bg-orange-500/12 text-orange-600 dark:text-orange-400",
	"claude-subscription": "bg-orange-500/12 text-orange-600 dark:text-orange-400",
	openrouter: "bg-indigo-500/12 text-indigo-600 dark:text-indigo-400",
	openai: "bg-zinc-500/12 text-zinc-700 dark:text-zinc-300",
	google: "bg-sky-500/12 text-sky-600 dark:text-sky-400",
	groq: "bg-rose-500/12 text-rose-600 dark:text-rose-400",
	deepseek: "bg-blue-500/12 text-blue-600 dark:text-blue-400",
	xai: "bg-neutral-500/12 text-neutral-700 dark:text-neutral-300",
	ollama: "bg-lime-500/12 text-lime-700 dark:text-lime-400",
	zai: "bg-violet-500/12 text-violet-600 dark:text-violet-400",
	custom: "bg-slate-500/12 text-slate-600 dark:text-slate-300",
};

function initials(kind: ProviderKind): string {
	const words = PROVIDER_META[kind].label.replace(/\(.*\)/, "").trim().split(/[\s.]+/);
	return (words.length > 1 ? words[0]![0]! + words[1]![0]! : words[0]!.slice(0, 2)).toUpperCase();
}

function KindIcon({ kind, size = "md" }: { kind: ProviderKind; size?: "sm" | "md" }) {
	return (
		<span
			aria-hidden
			className={cn(
				"flex shrink-0 items-center justify-center rounded-lg font-semibold tracking-tight",
				size === "md" ? "size-9 text-[12px]" : "size-7 text-[10.5px]",
				KIND_TINT[kind],
			)}
		>
			{initials(kind)}
		</span>
	);
}

const PRICE_BADGE: Record<string, { label: string; tone: "success" | "neutral" | "primary" | "warning" }> = {
	free: { label: "Free", tone: "success" },
	local: { label: "Local", tone: "success" },
	paid: { label: "API key", tone: "neutral" },
	subscription: { label: "Subscription", tone: "primary" },
};

function StatusBadge({ p, testing }: { p: ProviderView; testing: boolean }) {
	if (testing)
		return (
			<Badge>
				<Loader2 className="size-3 animate-spin" />
				Testing
			</Badge>
		);
	if (p.testOk === null) return <Badge>Not tested</Badge>;
	if (p.testOk)
		return (
			<Badge tone="success">
				<CheckCircle2 className="size-3" />
				Working
			</Badge>
		);
	return (
		<Tooltip content={<span className="block max-w-xs whitespace-normal">{p.testError ?? "Failed"}</span>}>
			<Badge tone="danger" className="cursor-default">
				<AlertCircle className="size-3" />
				Failed
			</Badge>
		</Tooltip>
	);
}

function TestOutcome({ result }: { result: TestResult }) {
	return (
		<div
			role="status"
			className={cn(
				"flex items-start gap-2 rounded-lg border px-3 py-2 text-[13px]",
				result.ok ? "border-success/25 bg-success-soft text-success" : "border-danger/25 bg-danger-soft text-danger",
			)}
		>
			{result.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" /> : <AlertCircle className="mt-0.5 size-4 shrink-0" />}
			<div className="min-w-0">
				{result.ok ? (
					<span>
						Working{result.model ? <> with <span className="font-mono text-[12px]">{result.model}</span></> : null}
						{result.ms !== undefined ? ` · ${(result.ms / 1000).toFixed(1)} s` : ""}
					</span>
				) : (
					<span className="break-words" data-selectable>
						{result.error ?? "The test failed."}
						{result.transient ? " This looks temporary. Try again in a moment." : ""}
					</span>
				)}
			</div>
		</div>
	);
}

/* ---------- provider list ---------- */

async function testSaved(p: ProviderView): Promise<void> {
	const before = useAi.getState().slots;
	useAi.setState((s) => ({ testing: { ...s.testing, [p.id]: true } }));
	try {
		const r = await call(ch.test, { id: p.id });
		forgetModels(p.id);
		await useAi.getState().load();
		if (r.ok) {
			const after = useAi.getState().slots;
			const filled = MODEL_SLOTS.filter((s) => !before[s] && after[s]);
			toast.success(`${p.name} is working`, {
				description: filled.length ? `Model slots set: ${filled.map((s) => SLOT_META[s].label).join(", ")}.` : r.ms !== undefined ? `Answered in ${(r.ms / 1000).toFixed(1)} s.` : undefined,
			});
		} else {
			toast.error(`${p.name} did not answer`, { description: `${r.error ?? "Test failed."}${r.transient ? " This looks temporary." : ""}` });
		}
	} catch (err) {
		toast.error("Test failed", { description: errorText(err) });
	} finally {
		useAi.setState((s) => {
			const { [p.id]: _, ...rest } = s.testing;
			return { testing: rest };
		});
	}
}

function ProviderRow({ p, onEdit }: { p: ProviderView; onEdit: () => void }) {
	const testing = useAi((s) => !!s.testing[p.id]);
	const load = useAi((s) => s.load);
	const meta = PROVIDER_META[p.kind];

	const remove = async () => {
		const ok = await confirm({
			title: `Delete ${p.name}?`,
			description: (
				<>
					{meta.needsKey && p.hasKey ? "Its saved API key is deleted from this PC. " : ""}
					Model slots that use it go back to the default provider. Past usage records stay.
				</>
			),
			tone: "danger",
			confirmLabel: "Delete provider",
		});
		if (!ok) return;
		try {
			await call(ch.remove, { id: p.id });
			forgetModels(p.id);
			await load();
			toast.success(`${p.name} deleted`);
		} catch (err) {
			toast.error("Could not delete", { description: errorText(err) });
		}
	};

	const setEnabled = async (enabled: boolean) => {
		try {
			await call(ch.setEnabled, { id: p.id, enabled });
			await load();
		} catch (err) {
			toast.error("Could not change provider", { description: errorText(err) });
		}
	};

	const makeDefault = async () => {
		try {
			await call(ch.setDefault, { id: p.id });
			await load();
			toast.success(`${p.name} is now the default provider`);
		} catch (err) {
			toast.error("Could not change default", { description: errorText(err) });
		}
	};

	const details = [
		meta.label,
		p.defaultModel,
		meta.needsKey ? (p.hasKey ? "key saved, encrypted" : "no key") : null,
		p.testedAt ? `tested ${timeAgo(p.testedAt)}` : null,
	].filter(Boolean);

	return (
		<li className={cn("flex items-center gap-3 px-5 py-3.5 transition-opacity", !p.enabled && "opacity-60")}>
			<KindIcon kind={p.kind} />
			<div className="min-w-0 flex-1">
				<div className="flex flex-wrap items-center gap-2">
					<span className="truncate text-[13.5px] font-medium">{p.name}</span>
					{p.isDefault ? (
						<Badge tone="primary">
							<Star className="size-3" />
							Default
						</Badge>
					) : null}
					<StatusBadge p={p} testing={testing} />
					{!p.enabled ? <Badge>Off</Badge> : null}
				</div>
				<div className="mt-0.5 truncate text-[12px] text-muted-foreground">{details.join(" · ")}</div>
			</div>
			<Switch checked={p.enabled} onChange={(v) => void setEnabled(v)} ariaLabel={`Use ${p.name}`} />
			<Button variant="outline" size="sm" loading={testing} onClick={() => void testSaved(p)}>
				{testing ? null : <Zap />}
				Test
			</Button>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button variant="ghost" size="icon-sm" aria-label={`More actions for ${p.name}`}>
						<MoreHorizontal />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent>
					<DropdownMenuItem icon={Pencil} onSelect={onEdit}>
						Edit
					</DropdownMenuItem>
					{!p.isDefault ? (
						<DropdownMenuItem icon={Star} onSelect={() => void makeDefault()}>
							Make default
						</DropdownMenuItem>
					) : null}
					<DropdownMenuSeparator />
					<DropdownMenuItem icon={Trash2} danger onSelect={() => void remove()}>
						Delete…
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		</li>
	);
}

/* ---------- add / edit dialog ---------- */

type Form = { kind: ProviderKind; name: string; apiKey: string; keyTouched: boolean; baseUrl: string; defaultModel: string };

const formFor = (kind: ProviderKind): Form => ({
	kind,
	name: PROVIDER_META[kind].label.replace(/\s*\(.*\)$/, ""),
	apiKey: "",
	keyTouched: false,
	baseUrl: kind === "ollama" ? "http://localhost:11434/v1" : "",
	defaultModel: "",
});

function KindPicker({ onPick }: { onPick: (k: ProviderKind) => void }) {
	return (
		<div className="mt-5 grid grid-cols-2 gap-2">
			{PROVIDER_KINDS.map((k) => {
				const m = PROVIDER_META[k];
				const price = PRICE_BADGE[m.price]!;
				return (
					<button
						key={k}
						type="button"
						onClick={() => onPick(k)}
						className="group flex items-center gap-3 rounded-xl border bg-card p-3 text-left transition-all hover:border-primary/40 hover:bg-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
					>
						<KindIcon kind={k} />
						<div className="min-w-0 flex-1">
							<div className="flex items-center justify-between gap-2">
								<span className="text-[13px] font-medium leading-5">{m.label.replace(/\s*\(free\)$/, "")}</span>
								<Badge tone={price.tone} className="shrink-0">
									{price.label}
								</Badge>
							</div>
							<div className="text-[11.5px] leading-4 text-muted-foreground">{m.blurb}</div>
						</div>
					</button>
				);
			})}
		</div>
	);
}

function Field({ label, hint, htmlFor, children }: { label: string; hint?: React.ReactNode; htmlFor?: string; children: React.ReactNode }) {
	return (
		<div className="space-y-1.5">
			<Label htmlFor={htmlFor}>{label}</Label>
			{children}
			{hint ? <p className="text-[12px] leading-relaxed text-muted-foreground">{hint}</p> : null}
		</div>
	);
}

function ProviderDialog({ editing, open, onClose }: { editing: ProviderView | null; open: boolean; onClose: () => void }) {
	const load = useAi((s) => s.load);
	const [form, setForm] = useState<Form | null>(null);
	const [reveal, setReveal] = useState(false);
	const [models, setModels] = useState<string[]>([]);
	const [modelsState, setModelsState] = useState<{ loading: boolean; error: string | null }>({ loading: false, error: null });
	const [reloadTick, setReloadTick] = useState(0);
	const [test, setTest] = useState<{ running: boolean; result: TestResult | null }>({ running: false, result: null });
	const [saving, setSaving] = useState(false);
	const [claude, setClaude] = useState<{ loggedIn: boolean; cliFound: boolean } | null>(null);

	// Reset whenever the dialog opens.
	useEffect(() => {
		if (!open) return;
		setForm(
			editing
				? { kind: editing.kind, name: editing.name, apiKey: "", keyTouched: false, baseUrl: editing.baseUrl ?? "", defaultModel: editing.defaultModel ?? "" }
				: null,
		);
		setReveal(false);
		setModels([]);
		setTest({ running: false, result: null });
	}, [open, editing]);

	const kind = form?.kind;
	useEffect(() => {
		if (kind === "claude-subscription") void call(ch.claudeStatus).then(setClaude).catch(() => setClaude(null));
	}, [kind]);

	const meta = form ? PROVIDER_META[form.kind] : null;
	const keyOk = !meta?.needsKey || !!form?.apiKey.trim() || !!editing?.hasKey;
	const urlOk = !meta?.needsBaseUrl || /^https?:\/\/\S+$/i.test(form?.baseUrl.trim() ?? "");
	const ready = !!form && keyOk && urlOk;
	const draft = useMemo(
		() =>
			form
				? {
						id: editing?.id,
						kind: form.kind,
						apiKey: form.keyTouched ? form.apiKey : undefined,
						baseUrl: meta?.needsBaseUrl ? form.baseUrl.trim() : null,
					}
				: null,
		[form?.kind, form?.keyTouched, form?.apiKey, form?.baseUrl, editing?.id, meta?.needsBaseUrl],
	);

	// Load the model list as soon as the settings are complete, without saving. Waits while the user types.
	const latest = useRef(0);
	useEffect(() => {
		setModels([]);
		setTest((t) => ({ ...t, result: null }));
		if (!ready || !draft) {
			setModelsState({ loading: false, error: null });
			return;
		}
		const mine = ++latest.current;
		setModelsState({ loading: true, error: null });
		const t = setTimeout(() => {
			call(ch.draftModels, draft)
				.then((m) => mine === latest.current && setModels(m))
				.catch((err) => mine === latest.current && setModelsState({ loading: false, error: errorText(err) }))
				.finally(() => mine === latest.current && setModelsState((s) => ({ ...s, loading: false })));
		}, 600);
		return () => clearTimeout(t);
	}, [ready, draft, reloadTick]);

	const runTest = async () => {
		if (!draft) return;
		setTest({ running: true, result: null });
		try {
			const result = await call(ch.draftTest, { ...draft, modelId: form?.defaultModel || undefined });
			setTest({ running: false, result });
		} catch (err) {
			setTest({ running: false, result: { ok: false, error: errorText(err) } });
		}
	};

	const save = async () => {
		if (!form || !meta) return;
		setSaving(true);
		try {
			const saved = await call(ch.save, {
				id: editing?.id,
				kind: form.kind,
				name: form.name.trim() || meta.label,
				apiKey: form.keyTouched ? form.apiKey : undefined,
				baseUrl: meta.needsBaseUrl ? form.baseUrl.trim() || null : null,
				defaultModel: form.defaultModel.trim() || null,
			});
			forgetModels(saved.id);
			await load();
			onClose();
			toast.success(editing ? "Provider saved" : `${saved.name} added`, { description: editing ? undefined : "Testing the connection now…" });
			// A new provider is tested at once; a working one fills empty model slots.
			if (!editing || form.keyTouched) void testSaved(saved);
		} catch (err) {
			toast.error("Could not save", { description: errorText(err) });
		} finally {
			setSaving(false);
		}
	};

	const modelHint = !form
		? null
		: !ready
			? meta?.needsKey && !keyOk
				? "Enter the API key to load the model list."
				: "Enter a valid address to load the model list."
			: modelsState.error
				? `Could not load models: ${modelsState.error}. You can type a model id.`
				: modelsState.loading
					? "Loading models…"
					: models.length
						? `${models.length} models. Leave empty to use the provider's default.`
						: "No list from this provider. Type a model id.";

	return (
		<Dialog open={open} onOpenChange={(o) => !o && onClose()}>
			<DialogContent
				className={form ? "w-[min(94vw,600px)]" : "w-[min(94vw,680px)]"}
				title={editing ? `Edit ${editing.name}` : form ? `Add ${PROVIDER_META[form.kind].label.replace(/\s*\(free\)$/, "")}` : "Add an AI provider"}
				description={!form ? "Pick where the AI runs. You can add more than one and choose a model for each task later." : undefined}
			>
				{!form ? (
					<KindPicker onPick={(k) => setForm(formFor(k))} />
				) : (
					<form
						className="mt-5 space-y-4"
						onSubmit={(e) => {
							e.preventDefault();
							void save();
						}}
					>
						{meta?.note ? (
							<div className="flex gap-2.5 rounded-lg border bg-subtle px-3 py-2.5 text-[12.5px] leading-relaxed text-muted-foreground">
								<Bot className="mt-0.5 size-4 shrink-0" />
								<span>{meta.note}</span>
							</div>
						) : null}
						{form.kind === "claude-subscription" && claude ? (
							<div className="flex flex-wrap gap-2 text-[12px]">
								<Badge tone={claude.cliFound ? "success" : "danger"}>{claude.cliFound ? "Claude Code found" : "Claude Code not found"}</Badge>
								<Badge tone={claude.loggedIn ? "success" : "danger"}>{claude.loggedIn ? "Logged in" : "Not logged in: run claude once in a terminal"}</Badge>
							</div>
						) : null}

						<div className={cn("grid gap-4", meta?.needsBaseUrl && "grid-cols-2")}>
							<Field label="Name" htmlFor="pv-name">
								<Input id="pv-name" value={form.name} maxLength={80} onChange={(e) => setForm({ ...form, name: e.target.value })} />
							</Field>
							{meta?.needsBaseUrl ? (
								<Field label="Address" htmlFor="pv-url">
									<Input
										id="pv-url"
										value={form.baseUrl}
										placeholder="https://api.example.com/v1"
										spellCheck={false}
										aria-invalid={!!form.baseUrl && !urlOk}
										onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
									/>
								</Field>
							) : null}
						</div>

						{meta?.needsKey ? (
							<Field
								label="API key"
								htmlFor="pv-key"
								hint={
									<span className="flex flex-wrap items-center gap-x-3 gap-y-1">
										<span className="inline-flex items-center gap-1">
											<KeyRound className="size-3" />
											{editing?.hasKey ? "Leave empty to keep the saved key." : "Encrypted with Windows before it is saved. It never leaves this PC except to call the provider."}
										</span>
										{meta.keyUrl ? (
											<a href={meta.keyUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
												Get a key
												<ExternalLink className="size-3" />
											</a>
										) : null}
									</span>
								}
							>
								<div className="relative">
									<Input
										id="pv-key"
										type={reveal ? "text" : "password"}
										autoComplete="off"
										spellCheck={false}
										className="pr-10 font-mono text-[12.5px]"
										placeholder={editing?.hasKey ? "•••••••••••• (saved)" : "Paste your key"}
										value={form.apiKey}
										onChange={(e) => setForm({ ...form, apiKey: e.target.value, keyTouched: true })}
									/>
									{form.apiKey ? (
										<button
											type="button"
											aria-label={reveal ? "Hide key" : "Show key"}
											onClick={() => setReveal((v) => !v)}
											className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
										>
											{reveal ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
										</button>
									) : null}
								</div>
							</Field>
						) : null}

						<Field label="Default model" hint={modelHint}>
							<div className="flex gap-2">
								<Combobox
									ariaLabel="Default model"
									value={form.defaultModel}
									onChange={(v) => setForm({ ...form, defaultModel: v })}
									options={models}
									loading={modelsState.loading}
									disabled={!ready}
									placeholder="Provider default"
									searchPlaceholder="Search or type a model id…"
								/>
								{form.defaultModel ? (
									<Tooltip content="Use the provider default">
										<Button type="button" variant="ghost" size="icon" aria-label="Clear model" onClick={() => setForm({ ...form, defaultModel: "" })}>
											<X />
										</Button>
									</Tooltip>
								) : null}
								<Tooltip content="Reload models">
									<Button type="button" variant="outline" size="icon" aria-label="Reload models" disabled={!ready || modelsState.loading} onClick={() => setReloadTick((n) => n + 1)}>
										<RefreshCw className={cn(modelsState.loading && "animate-spin")} />
									</Button>
								</Tooltip>
							</div>
						</Field>

						{test.result ? <TestOutcome result={test.result} /> : null}

						<DialogFooter className="items-center">
							{!editing ? (
								<Button type="button" variant="ghost" className="mr-auto" onClick={() => setForm(null)}>
									<ArrowLeft />
									Back
								</Button>
							) : null}
							<Button type="button" variant="outline" disabled={!ready} loading={test.running} onClick={() => void runTest()}>
								{test.running ? null : <Zap />}
								Test
							</Button>
							<Button type="submit" loading={saving} disabled={!keyOk || !urlOk}>
								{editing ? "Save" : "Add provider"}
							</Button>
						</DialogFooter>
					</form>
				)}
			</DialogContent>
		</Dialog>
	);
}

/* ---------- model slots ---------- */

const AUTO = "__auto__";

function SlotRow({ slot }: { slot: ModelSlot }) {
	const providers = useAi((s) => s.providers);
	const value = useAi((s) => s.slots[slot]);
	const load = useAi((s) => s.load);
	const [models, setModels] = useState<string[]>([]);
	const [loading, setLoading] = useState(false);
	const enabled = providers.filter((p) => p.enabled || p.id === value?.providerId);
	const provider = providers.find((p) => p.id === value?.providerId);
	const fallback = providers.find((p) => p.enabled && p.isDefault) ?? providers.find((p) => p.enabled);

	useEffect(() => {
		if (!value?.providerId) return setModels([]);
		let live = true;
		setLoading(true);
		providerModels(value.providerId)
			.then((m) => live && setModels(m))
			.catch(() => live && setModels([]))
			.finally(() => live && setLoading(false));
		return () => {
			live = false;
		};
	}, [value?.providerId]);

	const save = async (next: { providerId: string; modelId: string } | null) => {
		try {
			await call(ch.setSlot, { slot, value: next });
			await load();
		} catch (err) {
			toast.error("Could not save the model", { description: errorText(err) });
		}
	};

	const pickProvider = async (id: string) => {
		if (id === AUTO) return save(null);
		const p = providers.find((x) => x.id === id);
		if (!p) return;
		let modelId = p.defaultModel ?? "";
		if (!modelId) {
			const list = await providerModels(id).catch(() => []);
			modelId = list[0] ?? "";
		}
		if (!modelId) {
			toast.error("Pick a model", { description: `${p.name} has no default model yet.` });
			return;
		}
		await save({ providerId: id, modelId });
	};

	return (
		<div className="grid grid-cols-[minmax(0,1fr)_200px_minmax(0,240px)] items-center gap-3 px-5 py-3.5">
			<div className="min-w-0">
				<div className="text-[13.5px] font-medium">{SLOT_META[slot].label}</div>
				<div className="text-[12px] text-muted-foreground">{SLOT_META[slot].description}</div>
			</div>
			<Select
				ariaLabel={`${SLOT_META[slot].label} provider`}
				value={value?.providerId ?? AUTO}
				onChange={(v) => void pickProvider(v)}
				options={[
					{ value: AUTO, label: "Automatic", hint: fallback ? fallback.name : undefined },
					...enabled.map((p) => ({ value: p.id, label: p.name })),
				]}
			/>
			{value && provider ? (
				<Combobox
					ariaLabel={`${SLOT_META[slot].label} model`}
					value={value.modelId}
					options={models}
					loading={loading}
					onChange={(m) => void save({ providerId: value.providerId, modelId: m })}
					searchPlaceholder="Search or type a model id…"
				/>
			) : (
				<div className="truncate px-1 text-[12px] text-muted-foreground">{fallback ? `Uses ${fallback.name}'s ${slot === "cheap" ? "small" : "default"} model` : "Add a provider first"}</div>
			)}
		</div>
	);
}

/* ---------- usage ---------- */

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
	return (
		<div className="rounded-xl border bg-subtle/50 px-4 py-3">
			<div className="text-[11.5px] font-medium text-muted-foreground">{label}</div>
			<div className="mt-1 text-[19px] font-semibold tabular-nums tracking-tight">{value}</div>
			{sub ? <div className="mt-0.5 text-[11.5px] text-muted-foreground">{sub}</div> : null}
		</div>
	);
}

function costText(u: UsageRow): string {
	if (u.billing === "free") return "Free";
	if (u.costUsd === null) return "—";
	if (u.billing === "subscription") return `≈${usd(u.costUsd)}`;
	return usd(u.costUsd);
}

function UsageCard() {
	const [days, setDays] = useState<"7" | "30" | "365">("30");
	const [errorsOnly, setErrorsOnly] = useState(false);
	const [summary, setSummary] = useState<UsageSummary | null>(null);
	const [rows, setRows] = useState<UsageRow[] | null>(null);
	const [tick, setTick] = useState(0);

	useEffect(() => {
		let live = true;
		Promise.all([call(ch.usageSummary, { days: Number(days) }), call(ch.usageRecent, { limit: 50, failedOnly: errorsOnly })])
			.then(([s, r]) => {
				if (!live) return;
				setSummary(s);
				setRows(r);
			})
			.catch((err) => toast.error("Could not load usage", { description: errorText(err) }));
		return () => {
			live = false;
		};
	}, [days, errorsOnly, tick]);

	return (
		<Card>
			<CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
				<div>
					<CardTitle>Usage</CardTitle>
					<CardDescription className="mt-1">Every AI call is logged with its tokens and cost. Costs use public list prices; “—” means the price is not known.</CardDescription>
				</div>
				<div className="flex shrink-0 items-center gap-2">
					<Segmented
						ariaLabel="Period"
						value={days}
						onChange={setDays}
						options={[
							{ value: "7", label: "7 days" },
							{ value: "30", label: "30 days" },
							{ value: "365", label: "Year" },
						]}
					/>
					<Tooltip content="Refresh">
						<Button variant="ghost" size="icon-sm" aria-label="Refresh usage" onClick={() => setTick((n) => n + 1)}>
							<RefreshCw />
						</Button>
					</Tooltip>
				</div>
			</CardHeader>
			<CardContent className="space-y-4">
				<div className="grid grid-cols-4 gap-3">
					<Stat label="Calls" value={summary ? compactNumber(summary.calls) : "—"} sub={summary?.failed ? `${summary.failed} failed` : "none failed"} />
					<Stat label="Tokens in" value={summary ? compactNumber(summary.inputTokens) : "—"} />
					<Stat label="Tokens out" value={summary ? compactNumber(summary.outputTokens) : "—"} />
					<Stat label="API cost" value={summary ? usd(summary.costUsd) : "—"} sub={summary?.unpriced ? `${summary.unpriced} calls without a known price` : undefined} />
				</div>

				<div className="flex items-center justify-between">
					<h4 className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">Recent calls</h4>
					<label className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
						<Switch checked={errorsOnly} onChange={setErrorsOnly} ariaLabel="Show errors only" />
						Errors only
					</label>
				</div>

				{rows && !rows.length ? (
					<div className="rounded-xl border border-dashed px-6 py-10 text-center text-[13px] text-muted-foreground">
						<Activity className="mx-auto mb-2 size-5" />
						{errorsOnly ? "No failed calls." : "No AI calls yet. They appear here when you plan a video."}
					</div>
				) : (
					<div className="overflow-hidden rounded-xl border">
						<table className="w-full text-[12.5px]">
							<thead className="bg-subtle/70 text-left text-[11.5px] text-muted-foreground">
								<tr>
									<th className="px-3 py-2 font-medium">When</th>
									<th className="px-3 py-2 font-medium">Task</th>
									<th className="px-3 py-2 font-medium">Model</th>
									<th className="px-3 py-2 text-right font-medium">Tokens</th>
									<th className="px-3 py-2 text-right font-medium">Cost</th>
									<th className="px-3 py-2 font-medium">Result</th>
								</tr>
							</thead>
							<tbody className="divide-y">
								{(rows ?? []).map((u) => (
									<tr key={u.id} className="align-top">
										<td className="whitespace-nowrap px-3 py-2 text-muted-foreground" title={new Date(u.createdAt).toLocaleString()}>
											{timeAgo(u.createdAt)}
										</td>
										<td className="px-3 py-2">
											{u.purpose}
											{u.attempt > 1 ? <span className="ml-1 text-muted-foreground">(repair {u.attempt - 1})</span> : null}
										</td>
										<td className="max-w-48 px-3 py-2">
											<div className="truncate font-mono text-[11.5px]" title={u.model}>
												{u.model}
											</div>
											<div className="truncate text-[11px] text-muted-foreground">{u.providerName}</div>
										</td>
										<td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
											{compactNumber(u.inputTokens)} / {compactNumber(u.outputTokens)}
										</td>
										<td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{costText(u)}</td>
										<td className="px-3 py-2">
											{u.ok ? (
												<Badge tone="success">OK</Badge>
											) : (
												<div className="space-y-1">
													<Badge tone="danger">Failed</Badge>
													{u.error ? (
														<p className="max-w-60 break-words text-[11.5px] text-danger" data-selectable>
															{u.error}
														</p>
													) : null}
												</div>
											)}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</CardContent>
		</Card>
	);
}

/* ---------- page section ---------- */

export function AiSettings() {
	const { providers, loaded, load } = useAi();
	const [dialog, setDialog] = useState<{ open: boolean; editing: ProviderView | null }>({ open: false, editing: null });

	useEffect(() => {
		void load().catch((err) => toast.error("Could not load providers", { description: errorText(err) }));
	}, [load]);

	const add = () => setDialog({ open: true, editing: null });

	return (
		<div className="space-y-5">
			<Card>
				<CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
					<div>
						<CardTitle>AI providers</CardTitle>
						<CardDescription className="mt-1">Where the AI runs. Keys are encrypted on this PC and never shown again.</CardDescription>
					</div>
					{providers.length ? (
						<Button onClick={add}>
							<Plus />
							Add provider
						</Button>
					) : null}
				</CardHeader>
				{!loaded ? (
					<CardContent>
						<div className="flex items-center gap-2 py-6 text-[13px] text-muted-foreground">
							<Loader2 className="size-4 animate-spin" /> Loading…
						</div>
					</CardContent>
				) : !providers.length ? (
					<CardContent>
						<EmptyState
							icon={Bot}
							title="No AI provider yet"
							description="Start free with OpenCode Zen (no key needed), use your Claude subscription, or add your own API key."
							actions={
								<Button onClick={add}>
									<Plus />
									Add provider
								</Button>
							}
							className="py-10"
						/>
					</CardContent>
				) : (
					<ul className="divide-y border-t">
						{providers.map((p) => (
							<ProviderRow key={p.id} p={p} onEdit={() => setDialog({ open: true, editing: p })} />
						))}
					</ul>
				)}
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Models for each task</CardTitle>
					<CardDescription>Automatic uses the default provider. A working provider fills empty choices for you.</CardDescription>
				</CardHeader>
				<div className="divide-y border-t">
					{MODEL_SLOTS.map((s) => (
						<SlotRow key={s} slot={s} />
					))}
				</div>
			</Card>

			<UsageCard />

			<ProviderDialog open={dialog.open} editing={dialog.editing} onClose={() => setDialog((d) => ({ ...d, open: false }))} />
		</div>
	);
}
