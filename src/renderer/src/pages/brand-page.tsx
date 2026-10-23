import { Player, type PlayerRef } from "@remotion/player";
import { Check, CircleAlert, Film, ImagePlus, Loader2, Palette, Plus, Star, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { BRAND_FONTS, BrandKitData, brandStamp, CORNERS, defaultBrandKit, type BrandFont, type BrandKitView, type Corner } from "@shared/brand";
import { brandChannels } from "@shared/ipc/brand";
import { computeTimeline } from "@shared/plan/timing";
import { VideoPlan, type VideoPlanInput } from "@shared/plan/schema";
import { PlanVideo, type PlanVideoProps } from "@video/plan/PlanVideo";
import { SAMPLE_PLAN } from "@video/samples/web-page-journey";
import { Button } from "@renderer/components/ui/button";
import { confirm } from "@renderer/components/ui/confirm";
import { Dialog, DialogContent, DialogFooter } from "@renderer/components/ui/dialog";
import { EmptyState, Segmented } from "@renderer/components/ui/misc";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label, PageHeader } from "@renderer/components/ui/primitives";
import { Select } from "@renderer/components/ui/select";
import { Slider } from "@renderer/components/ui/slider";
import { Switch } from "@renderer/components/ui/switch";
import { call, errorText } from "@renderer/lib/ipc";
import { cn } from "@renderer/lib/utils";

const CORNER_LABELS: Record<Corner, string> = { "top-left": "Top left", "top-right": "Top right", "bottom-left": "Bottom left", "bottom-right": "Bottom right" };

/** First two scenes of the sample, so the preview is short: intro, a little content with the watermark, outro. */
function previewPlan(kit: BrandKitView, data: BrandKitData): VideoPlanInput {
	const ch = SAMPLE_PLAN.chapters[0]!;
	return {
		...SAMPLE_PLAN,
		meta: { ...SAMPLE_PLAN.meta, style: "brand", brand: brandStamp(data, kit.logoUrl, { title: "Sample series", episode: 1 }) },
		chapters: [{ ...ch, scenes: ch.scenes.slice(0, 2) }],
	};
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
	return (
		<div className="grid grid-cols-[150px_1fr] items-center gap-4">
			<div>
				<Label>{label}</Label>
				{hint ? <p className="text-[11.5px] text-muted-foreground">{hint}</p> : null}
			</div>
			<div className="min-w-0">{children}</div>
		</div>
	);
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
	const [text, setText] = useState(value);
	useEffect(() => setText(value), [value]);
	return (
		<div className="flex items-center gap-2">
			<input type="color" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="h-9 w-11 cursor-pointer rounded-lg border bg-card p-1" />
			<Input
				aria-label={`${label} (hex)`}
				value={text}
				maxLength={7}
				className="w-28 font-mono text-[13px]"
				onChange={(e) => {
					setText(e.target.value);
					if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) onChange(e.target.value.toLowerCase());
				}}
			/>
		</div>
	);
}

type SaveState = "saved" | "saving" | "invalid" | "error";

function SaveBadge({ state, problem }: { state: SaveState; problem: string | null }) {
	if (state === "saving")
		return (
			<span className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground" data-testid="brand-save">
				<Loader2 className="size-3.5 animate-spin" /> Saving…
			</span>
		);
	if (state === "saved")
		return (
			<span className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground" data-testid="brand-save">
				<Check className="size-3.5 text-success" /> Saved
			</span>
		);
	return (
		<span className="inline-flex items-center gap-1.5 text-[12px] text-danger" data-testid="brand-save">
			<CircleAlert className="size-3.5" /> {problem ?? "Not saved"}
		</span>
	);
}

function KitEditor({ kit, kits, onChanged, onRemoved }: { kit: BrandKitView; kits: number; onChanged: (k: BrandKitView) => void; onRemoved: () => void }) {
	const [name, setName] = useState(kit.name);
	const [data, setData] = useState<BrandKitData>(kit.data);
	const [state, setState] = useState<SaveState>("saved");
	const [problem, setProblem] = useState<string | null>(null);
	const dirty = useRef(false);
	const player = useRef<PlayerRef>(null);

	// Autosave shortly after the last change.
	useEffect(() => {
		if (!dirty.current) return;
		const r = BrandKitData.safeParse(data);
		if (!r.success || !name.trim()) {
			setState("invalid");
			setProblem(!name.trim() ? "Type a name for the kit" : (r.error?.issues[0]?.message ?? "Check the fields"));
			return;
		}
		setState("saving");
		const t = setTimeout(() => {
			call(brandChannels.update, { id: kit.id, name: name.trim(), data: r.data })
				.then((k) => {
					dirty.current = false;
					setState("saved");
					setProblem(null);
					onChanged(k);
				})
				.catch((err) => {
					setState("error");
					setProblem(errorText(err));
				});
		}, 600);
		return () => clearTimeout(t);
	}, [data, name, kit.id, onChanged]);

	const edit = (patch: Partial<BrandKitData>) => {
		dirty.current = true;
		setData((d) => ({ ...d, ...patch }));
	};

	const pickLogo = async () => {
		try {
			const k = await call(brandChannels.pickLogo, { id: kit.id });
			if (k) {
				onChanged(k);
				toast.success("Logo added");
			}
		} catch (err) {
			toast.error("Could not use this image", { description: errorText(err) });
		}
	};
	const clearLogo = async () => {
		try {
			onChanged(await call(brandChannels.clearLogo, { id: kit.id }));
		} catch (err) {
			toast.error("Could not remove the logo", { description: errorText(err) });
		}
	};
	const makeDefault = async () => {
		try {
			onChanged(await call(brandChannels.setDefault, { id: kit.id }));
			toast.success(`"${kit.name}" is now the default kit`);
		} catch (err) {
			toast.error("Could not change the default", { description: errorText(err) });
		}
	};
	const remove = async () => {
		const ok = await confirm({
			title: "Delete this brand kit?",
			description: (
				<>
					<span className="font-medium text-foreground">{kit.name}</span> and its logo are deleted. Videos you already rendered keep their branding. {kits > 1 ? "New renders use the default kit." : "New renders have no intro, outro or watermark."}
				</>
			),
			tone: "danger",
			confirmLabel: "Delete kit",
		});
		if (!ok) return;
		try {
			await call(brandChannels.remove, { id: kit.id });
			toast.success("Brand kit deleted");
			onRemoved();
		} catch (err) {
			toast.error("Could not delete", { description: errorText(err) });
		}
	};

	const shownData = BrandKitData.safeParse(data).success ? data : kit.data;
	const plan = useMemo(() => previewPlan(kit, shownData), [kit, shownData]);
	const timeline = useMemo(() => computeTimeline(VideoPlan.parse(plan)), [plan]);
	const inputProps = useMemo<PlanVideoProps>(() => ({ plan }), [plan]);
	const seek = (f: number) => {
		player.current?.seekTo(Math.max(0, Math.min(timeline.durationInFrames - 1, f)));
		player.current?.play();
	};
	const parts = [
		...(timeline.intro ? [{ value: "intro" as const, label: "Intro", frame: 0 }] : []),
		{ value: "body" as const, label: "Watermark", frame: timeline.intro + timeline.fps },
		...(timeline.outro ? [{ value: "outro" as const, label: "Outro", frame: timeline.durationInFrames - timeline.outro }] : []),
	];
	const [part, setPart] = useState<string>(parts[0]!.value);

	return (
		<div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] items-start gap-5">
			<div className="space-y-4">
				<Card>
					<CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
						<div>
							<CardTitle>Channel</CardTitle>
							<CardDescription>Shown in the intro, the outro and the watermark.</CardDescription>
						</div>
						<SaveBadge state={state} problem={problem} />
					</CardHeader>
					<CardContent className="space-y-3.5">
						<Row label="Kit name" hint="Only you see this.">
							<Input
								aria-label="Kit name"
								value={name}
								maxLength={60}
								onChange={(e) => {
									dirty.current = true;
									setName(e.target.value);
								}}
							/>
						</Row>
						<Row label="Channel name">
							<Input aria-label="Channel name" value={data.channel} maxLength={60} onChange={(e) => edit({ channel: e.target.value })} data-testid="brand-channel" />
						</Row>
						<Row label="Tagline" hint="Optional. One short line.">
							<Input aria-label="Tagline" value={data.tagline} maxLength={100} placeholder="Big ideas, made simple" onChange={(e) => edit({ tagline: e.target.value })} />
						</Row>
						<Row label="Logo" hint="PNG, JPEG or WebP, up to 5 MB. A transparent PNG looks best.">
							<div className="flex items-center gap-3">
								<div className="flex h-14 w-24 items-center justify-center overflow-hidden rounded-lg border bg-[repeating-conic-gradient(var(--color-muted)_0_25%,transparent_0_50%)] bg-[length:12px_12px]">
									{kit.logoUrl ? <img src={kit.logoUrl} alt="Logo" className="max-h-12 max-w-[88px] object-contain" data-testid="brand-logo" /> : <ImagePlus className="size-5 text-muted-foreground" />}
								</div>
								<Button variant="outline" size="sm" onClick={() => void pickLogo()} data-testid="brand-pick-logo">
									{kit.logoUrl ? "Change" : "Choose image"}
								</Button>
								{kit.logoUrl ? (
									<Button variant="ghost" size="sm" onClick={() => void clearLogo()}>
										<X />
										Remove
									</Button>
								) : null}
							</div>
						</Row>
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Colours and font</CardTitle>
						<CardDescription>Used by the intro and outro, and by the "Brand" visual style.</CardDescription>
					</CardHeader>
					<CardContent className="space-y-3.5">
						<Row label="Main colour">
							<ColorField label="Main colour" value={data.colors.primary} onChange={(v) => edit({ colors: { ...data.colors, primary: v } })} />
						</Row>
						<Row label="Second colour">
							<ColorField label="Second colour" value={data.colors.secondary} onChange={(v) => edit({ colors: { ...data.colors, secondary: v } })} />
						</Row>
						<Row label="Highlight colour">
							<ColorField label="Highlight colour" value={data.colors.accent} onChange={(v) => edit({ colors: { ...data.colors, accent: v } })} />
						</Row>
						<Row label="Dark background">
							<Switch checked={data.colors.dark} onChange={(v) => edit({ colors: { ...data.colors, dark: v } })} ariaLabel="Dark background" />
						</Row>
						<Row label="Font" hint="Fonts that come with the app or with Windows.">
							<Select<BrandFont> ariaLabel="Font" value={data.font} onChange={(v) => edit({ font: v })} options={BRAND_FONTS.map((f) => ({ value: f, label: <span style={{ fontFamily: `'${f}'` }}>{f}</span> }))} />
						</Row>
					</CardContent>
				</Card>

				<Card>
					<CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
						<div>
							<CardTitle>Watermark</CardTitle>
							<CardDescription>Your logo in a corner while the scenes play.</CardDescription>
						</div>
						<Switch checked={data.watermark.enabled} onChange={(v) => edit({ watermark: { ...data.watermark, enabled: v } })} ariaLabel="Show a watermark" />
					</CardHeader>
					{data.watermark.enabled ? (
						<CardContent className="space-y-3.5">
							<Row label="Corner">
								<Select<Corner> ariaLabel="Watermark corner" value={data.watermark.corner} onChange={(v) => edit({ watermark: { ...data.watermark, corner: v } })} options={CORNERS.map((c) => ({ value: c, label: CORNER_LABELS[c] }))} />
							</Row>
							<Row label="Size">
								<Segmented
									ariaLabel="Watermark size"
									value={data.watermark.size}
									onChange={(v) => edit({ watermark: { ...data.watermark, size: v } })}
									options={[
										{ value: "small", label: "Small" },
										{ value: "medium", label: "Medium" },
										{ value: "large", label: "Large" },
									]}
								/>
							</Row>
							<Row label="Strength">
								<div className="flex items-center gap-3">
									<Slider ariaLabel="Watermark strength" min={0.15} max={1} step={0.05} value={data.watermark.opacity} onChange={(v) => edit({ watermark: { ...data.watermark, opacity: v } })} className="flex-1" />
									<span className="w-10 text-right text-[12px] tabular-nums text-muted-foreground">{Math.round(data.watermark.opacity * 100)}%</span>
								</div>
							</Row>
						</CardContent>
					) : null}
				</Card>

				<Card>
					<CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
						<div>
							<CardTitle>Intro</CardTitle>
							<CardDescription>Logo, channel name and tagline before the first scene.</CardDescription>
						</div>
						<Switch checked={data.intro.enabled} onChange={(v) => edit({ intro: { ...data.intro, enabled: v } })} ariaLabel="Add an intro" />
					</CardHeader>
					{data.intro.enabled ? (
						<CardContent>
							<Row label="Length">
								<div className="flex items-center gap-3">
									<Slider ariaLabel="Intro length" min={2} max={8} step={0.5} value={data.intro.seconds} onChange={(v) => edit({ intro: { ...data.intro, seconds: v } })} className="flex-1" />
									<span className="w-10 text-right text-[12px] tabular-nums text-muted-foreground">{data.intro.seconds} s</span>
								</div>
							</Row>
						</CardContent>
					) : null}
				</Card>

				<Card>
					<CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
						<div>
							<CardTitle>Outro and end screen</CardTitle>
							<CardDescription>A thank-you and a call to action after the last scene.</CardDescription>
						</div>
						<Switch checked={data.outro.enabled} onChange={(v) => edit({ outro: { ...data.outro, enabled: v } })} ariaLabel="Add an outro" />
					</CardHeader>
					{data.outro.enabled ? (
						<CardContent className="space-y-3.5">
							<Row label="Length" hint="YouTube end screens need 5–20 s.">
								<div className="flex items-center gap-3">
									<Slider ariaLabel="Outro length" min={5} max={20} step={1} value={data.outro.seconds} onChange={(v) => edit({ outro: { ...data.outro, seconds: v } })} className="flex-1" />
									<span className="w-10 text-right text-[12px] tabular-nums text-muted-foreground">{data.outro.seconds} s</span>
								</div>
							</Row>
							<Row label="Message">
								<Input aria-label="Outro message" value={data.outro.message} maxLength={80} onChange={(e) => edit({ outro: { ...data.outro, message: e.target.value } })} />
							</Row>
							<Row label="Call to action">
								<Input aria-label="Call to action" value={data.outro.callToAction} maxLength={80} onChange={(e) => edit({ outro: { ...data.outro, callToAction: e.target.value } })} />
							</Row>
							<Row label="End screen space" hint="Leaves room for YouTube's 'next video' and 'subscribe' elements.">
								<Switch checked={data.outro.endScreen} onChange={(v) => edit({ outro: { ...data.outro, endScreen: v } })} ariaLabel="Leave end screen space" />
							</Row>
						</CardContent>
					) : null}
				</Card>

				<div className="flex items-center justify-between gap-3 pb-2">
					{kit.isDefault ? (
						<span className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">
							<Star className="size-3.5 fill-current text-warning" /> Default kit: every render uses it unless a series picks another kit.
						</span>
					) : (
						<Button variant="outline" size="sm" onClick={() => void makeDefault()}>
							<Star />
							Make default
						</Button>
					)}
					<Button variant="ghost" size="sm" className="text-danger" onClick={() => void remove()}>
						<Trash2 />
						Delete kit
					</Button>
				</div>
			</div>

			<div className="sticky top-0 space-y-3">
				<div className="overflow-hidden rounded-xl border bg-black shadow-md" data-testid="brand-preview">
					<Player
						ref={player}
						// Frame 0 is the start of the fade-in; open where the intro is on screen.
						initialFrame={Math.min(timeline.durationInFrames - 1, Math.round(timeline.fps * 1.5))}
						component={PlanVideo}
						inputProps={inputProps}
						durationInFrames={timeline.durationInFrames}
						fps={timeline.fps}
						compositionWidth={1920}
						compositionHeight={1080}
						style={{ width: "100%", aspectRatio: "16 / 9" }}
						controls
						clickToPlay
						acknowledgeRemotionLicense
					/>
				</div>
				<div className="flex items-center justify-between gap-3">
					<Segmented
						ariaLabel="Jump to"
						value={parts.some((p) => p.value === part) ? part : parts[0]!.value}
						onChange={(v) => {
							setPart(v);
							seek(parts.find((p) => p.value === v)!.frame);
						}}
						options={parts.map((p) => ({ value: p.value, label: p.label }))}
					/>
					<span className="text-[12px] text-muted-foreground">Preview with a sample. Renders use your real video.</span>
				</div>
			</div>
		</div>
	);
}

function NewKitDialog({ open, onOpenChange, onCreated, first }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (k: BrandKitView) => void; first: boolean }) {
	const [channel, setChannel] = useState("");
	const [busy, setBusy] = useState(false);
	useEffect(() => {
		if (open) setChannel("");
	}, [open]);
	const create = async () => {
		const name = channel.trim();
		if (!name) return;
		setBusy(true);
		try {
			const k = await call(brandChannels.create, { name, data: defaultBrandKit(name) });
			onOpenChange(false);
			onCreated(k);
		} catch (err) {
			toast.error("Could not create the kit", { description: errorText(err) });
		} finally {
			setBusy(false);
		}
	};
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent title={first ? "Create your brand kit" : "New brand kit"} description="Start with the channel name. You can change colours, logo, intro and outro next." className="w-[min(92vw,460px)]">
				<form
					className="mt-4 space-y-1.5"
					onSubmit={(e) => {
						e.preventDefault();
						void create();
					}}
				>
					<Label htmlFor="kit-channel">Channel name</Label>
					<Input id="kit-channel" autoFocus value={channel} maxLength={60} placeholder="For example: Science with Sam" onChange={(e) => setChannel(e.target.value)} data-testid="kit-channel" />
				</form>
				<DialogFooter>
					<Button variant="ghost" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button onClick={() => void create()} loading={busy} disabled={!channel.trim()} data-testid="kit-create">
						<Plus />
						Create kit
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

export function BrandPage() {
	const [kits, setKits] = useState<BrandKitView[] | null>(null);
	const [selected, setSelected] = useState<string | null>(null);
	const [creating, setCreating] = useState(false);
	const load = useCallback(
		(pick?: string) =>
			void call(brandChannels.list)
				.then((list) => {
					setKits(list);
					setSelected((cur) => pick ?? (cur && list.some((k) => k.id === cur) ? cur : (list[0]?.id ?? null)));
				})
				.catch((err) => toast.error("Could not load the brand kits", { description: errorText(err) })),
		[],
	);
	useEffect(() => load(), [load]);
	const kit = kits?.find((k) => k.id === selected) ?? null;
	// Edits come back from main; keep the list in step without reloading (the editor keeps its own form state).
	const onChanged = useCallback((k: BrandKitView) => setKits((list) => list?.map((x) => (x.id === k.id ? k : k.isDefault ? { ...x, isDefault: false } : x)) ?? null), []);

	return (
		<div>
			<PageHeader
				title="Brand kit"
				description="Your channel's look, applied to every video automatically."
				actions={
					kits?.length ? (
						<div className="flex items-center gap-2">
							{kits.length > 1 ? (
								<Select
									ariaLabel="Brand kit"
									className="w-56"
									value={selected ?? undefined}
									onChange={setSelected}
									options={kits.map((k) => ({ value: k.id, label: `${k.name}${k.isDefault ? " (default)" : ""}` }))}
								/>
							) : (
								<Badge tone="neutral">{kits[0]!.name}</Badge>
							)}
							<Button variant="outline" onClick={() => setCreating(true)}>
								<Plus />
								New kit
							</Button>
						</div>
					) : null
				}
			/>
			{kits && !kits.length ? (
				<EmptyState
					icon={Palette}
					title="Set up your channel look"
					description="Add your channel name, logo, colours and font, plus an intro, an outro with end screen, and a watermark. Videos stay recognisable from the first second."
					actions={
						<Button onClick={() => setCreating(true)} data-testid="brand-start">
							<Film />
							Create brand kit
						</Button>
					}
				/>
			) : null}
			{!kits ? (
				<div className="flex h-60 items-center justify-center gap-2 text-[13px] text-muted-foreground">
					<Loader2 className="size-4 animate-spin" /> Loading…
				</div>
			) : null}
			{kit ? <KitEditor key={kit.id} kit={kit} kits={kits?.length ?? 1} onChanged={onChanged} onRemoved={() => load()} /> : null}
			<NewKitDialog open={creating} onOpenChange={setCreating} onCreated={(k) => load(k.id)} first={!kits?.length} />
			<p className={cn("mt-6 text-[12px] text-muted-foreground", !kit && "hidden")}>Changes save by themselves. They apply to the next render; videos you already rendered do not change.</p>
		</div>
	);
}
