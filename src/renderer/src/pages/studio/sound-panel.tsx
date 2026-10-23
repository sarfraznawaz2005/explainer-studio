import { Link } from "@tanstack/react-router";
import { Layers, Music2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { SoundSetup, type SfxRole } from "@shared/assets";
import { assetChannels, type DraftSound } from "@shared/ipc/assets";
import type { VideoPlan } from "@shared/plan/schema";
import { pickChapterMusic } from "@shared/plan/soundtrack";
import { Button } from "@renderer/components/ui/button";
import { Dialog, DialogContent } from "@renderer/components/ui/dialog";
import { Badge, Label, Tooltip } from "@renderer/components/ui/primitives";
import { Select } from "@renderer/components/ui/select";
import { Slider } from "@renderer/components/ui/slider";
import { Switch } from "@renderer/components/ui/switch";
import { call, errorText } from "@renderer/lib/ipc";
import { usePreviewAudio } from "@renderer/stores/assets";
import { MOOD_LABEL, PlayButton } from "../assets/asset-dialogs";

const ROLE_LABEL: Record<SfxRole, { label: string; hint: string }> = {
	reveal: { label: "Reveal", hint: "When a point, step or bar appears" },
	transition: { label: "Scene change", hint: "When a new scene starts" },
	correct: { label: "Sound cue", hint: "Cues the script marks as a sound" },
};

/** Music and sound effects for one draft. Every change is saved at once and heard in the preview. */
export function SoundControls({ draftId, plan, sound, onChange }: { draftId: string; plan: VideoPlan; sound: DraftSound; onChange: (s: DraftSound) => void }) {
	const [open, setOpen] = useState(false);
	const [vol, setVol] = useState<{ music: number; sfx: number } | null>(null);
	const stop = usePreviewAudio((s) => s.stop);
	const { setup, library, titles, roleDefaults } = sound;
	const music = useMemo(() => library.filter((a) => a.kind === "music"), [library]);
	const sfx = useMemo(() => library.filter((a) => a.kind === "sfx"), [library]);
	const picks = useMemo(() => pickChapterMusic(plan, setup, library, sound.seed), [plan, setup, library, sound.seed]);
	const urlOf = (id: string | null | undefined) => library.find((a) => a.id === id)?.url;

	const save = async (next: SoundSetup) => {
		onChange({ ...sound, setup: next });
		try {
			onChange(await call(assetChannels.setDraftSound, { draftId, setup: SoundSetup.parse(next) }));
		} catch (err) {
			toast.error("Could not save the sound settings", { description: errorText(err) });
		}
	};
	const setMusic = (p: Partial<SoundSetup["music"]>) => void save({ ...setup, music: { ...setup.music, ...p } });
	const setSfx = (p: Partial<SoundSetup["sfx"]>) => void save({ ...setup, sfx: { ...setup.sfx, ...p } });

	const pickChapter = (chapterId: string, v: string) => {
		const next = { ...setup.music.picks };
		if (v === "auto") delete next[chapterId];
		else next[chapterId] = v;
		setMusic({ picks: next });
	};
	const pickRole = (role: SfxRole, v: string) => {
		const next = { ...setup.sfx.roles };
		if (v === "default") delete next[role];
		else next[role] = v;
		setSfx({ roles: next });
	};

	const musicVol = vol?.music ?? setup.music.volume;
	const sfxVol = vol?.sfx ?? setup.sfx.volume;
	const label = !setup.music.enabled && !setup.sfx.enabled ? "Sound off" : "Sound";

	return (
		<>
			<Tooltip content="Music and sound effects">
				<Button variant="outline" size="sm" onClick={() => setOpen(true)} data-testid="sound-button">
					<Music2 />
					{label}
				</Button>
			</Tooltip>
			<Dialog
				open={open}
				onOpenChange={(o) => {
					setOpen(o);
					if (!o) stop();
				}}
			>
				<DialogContent title="Music and sound effects" description="Changes are saved right away. Play the preview to hear them." className="flex max-h-[min(88vh,820px)] w-[min(94vw,640px)] flex-col">
					<div className="-mx-6 mt-4 min-h-0 flex-1 space-y-6 overflow-y-auto px-6 pb-1">
						{!music.length && !sfx.length ? (
							<div className="rounded-xl border border-dashed bg-subtle/60 p-4 text-[13px]">
								<p className="font-medium">Your library has no music or sound effects yet.</p>
								<p className="mt-1 text-muted-foreground">Download the free starter pack, or import your own files, in Assets.</p>
								<Button size="sm" className="mt-3" asChild onClick={() => setOpen(false)}>
									<Link to="/assets">
										<Layers />
										Open Assets
									</Link>
								</Button>
							</div>
						) : null}

						<section className="space-y-3" aria-labelledby="snd-music">
							<div className="flex items-center justify-between">
								<h3 id="snd-music" className="text-[14px] font-semibold">
									Background music
								</h3>
								<Switch checked={setup.music.enabled} onChange={(v) => setMusic({ enabled: v })} ariaLabel="Background music" />
							</div>
							<div className="grid grid-cols-[120px_1fr_44px] items-center gap-3">
								<Label>Volume</Label>
								<Slider
									ariaLabel="Music volume"
									min={0}
									max={0.6}
									step={0.01}
									value={musicVol}
									disabled={!setup.music.enabled}
									onChange={(v) => setVol({ music: v, sfx: sfxVol })}
									onCommit={(v) => {
										setVol(null);
										setMusic({ volume: v });
									}}
								/>
								<span className="text-right text-[12px] tabular-nums text-muted-foreground">{Math.round(musicVol * 100)}%</span>
							</div>
							<label className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5">
								<span>
									<span className="block text-[13px] font-medium">Lower the music while the voice speaks</span>
									<span className="block text-[12px] text-muted-foreground">Called ducking. Keeps every word clear.</span>
								</span>
								<Switch checked={setup.music.duck} onChange={(v) => setMusic({ duck: v })} ariaLabel="Lower the music while the voice speaks" disabled={!setup.music.enabled} />
							</label>
							<div className="overflow-hidden rounded-xl border">
								<div className="border-b bg-subtle px-3 py-2 text-[12px] font-medium text-muted-foreground">Music for each chapter</div>
								<ul className="divide-y">
									{picks.map((p, i) => {
										const own = setup.music.picks[p.chapterId];
										const value = own === "none" ? "none" : own && titles[own] ? own : "auto";
										const url = urlOf(p.assetId);
										return (
											<li key={p.chapterId} className="flex items-center gap-3 px-3 py-2">
												<span className="w-5 text-[12px] tabular-nums text-muted-foreground">{i + 1}</span>
												<div className="min-w-0 flex-1">
													<div className="truncate text-[13px] font-medium">{p.title}</div>
													<Badge tone="primary" className="mt-0.5">
														{MOOD_LABEL[p.mood]}
													</Badge>
												</div>
												<Select
													ariaLabel={`Music for chapter ${i + 1}`}
													className="w-56"
													disabled={!setup.music.enabled}
													value={value}
													onChange={(v) => pickChapter(p.chapterId, v)}
													options={[
														{ value: "auto", label: p.auto && p.assetId ? `Auto: ${titles[p.assetId] ?? "track"}` : "Auto (by mood)" },
														{ value: "none", label: "No music" },
														...music.map((m) => ({ value: m.id, label: titles[m.id] ?? m.id, hint: m.mood ? MOOD_LABEL[m.mood as keyof typeof MOOD_LABEL] : undefined })),
													]}
												/>
												{url ? <PlayButton url={url} label={titles[p.assetId!] ?? "track"} /> : <span className="size-8" />}
											</li>
										);
									})}
								</ul>
							</div>
						</section>

						<section className="space-y-3" aria-labelledby="snd-sfx">
							<div className="flex items-center justify-between">
								<h3 id="snd-sfx" className="text-[14px] font-semibold">
									Sound effects
								</h3>
								<Switch checked={setup.sfx.enabled} onChange={(v) => setSfx({ enabled: v })} ariaLabel="Sound effects" />
							</div>
							<div className="grid grid-cols-[120px_1fr_44px] items-center gap-3">
								<Label>Volume</Label>
								<Slider
									ariaLabel="Sound effect volume"
									min={0}
									max={1}
									step={0.01}
									value={sfxVol}
									disabled={!setup.sfx.enabled}
									onChange={(v) => setVol({ music: musicVol, sfx: v })}
									onCommit={(v) => {
										setVol(null);
										setSfx({ volume: v });
									}}
								/>
								<span className="text-right text-[12px] tabular-nums text-muted-foreground">{Math.round(sfxVol * 100)}%</span>
							</div>
							<ul className="divide-y overflow-hidden rounded-xl border">
								{(["reveal", "transition", "correct"] as const).map((role) => {
									const own = setup.sfx.roles[role];
									const current = own && titles[own] ? own : roleDefaults[role];
									const url = urlOf(current);
									return (
										<li key={role} className="flex items-center gap-3 px-3 py-2">
											<div className="min-w-0 flex-1">
												<div className="text-[13px] font-medium">{ROLE_LABEL[role].label}</div>
												<div className="text-[12px] text-muted-foreground">{ROLE_LABEL[role].hint}</div>
											</div>
											<Select
												ariaLabel={`${ROLE_LABEL[role].label} sound`}
												className="w-56"
												disabled={!setup.sfx.enabled}
												value={own && titles[own] ? own : "default"}
												onChange={(v) => pickRole(role, v)}
												options={[{ value: "default", label: roleDefaults[role] ? `Default: ${titles[roleDefaults[role]!] ?? "sound"}` : "Default (none)" }, ...sfx.map((s) => ({ value: s.id, label: titles[s.id] ?? s.id }))]}
											/>
											{url ? <PlayButton url={url} label={titles[current!] ?? "sound"} /> : <span className="size-8" />}
										</li>
									);
								})}
							</ul>
						</section>
					</div>
				</DialogContent>
			</Dialog>
		</>
	);
}
