import { Check, ChevronRight, Clock, Mic, Pencil, SlidersHorizontal, X, Zap } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { SCENE_LABELS, sceneName } from "@shared/plan/describe";
import type { Scene } from "@shared/plan/schema";
import { formatTime, type TimedScene } from "@shared/plan/timing";
import { Button } from "@renderer/components/ui/button";
import { Badge, Textarea } from "@renderer/components/ui/primitives";
import { errorText } from "@renderer/lib/ipc";
import { cn } from "@renderer/lib/utils";
import { SceneEditTools } from "./edit-panel";
import { SCENE_ICONS } from "./scene-meta";
import { ClipButton } from "./voice-panel";

const secs = (frames: number, fps: number) => `${(frames / fps).toFixed(1)}s`;

function Section({ title, icon: Icon, children, count }: { title: string; icon: typeof Clock; children: React.ReactNode; count?: number }) {
	return (
		<section className="border-t px-4 py-3.5">
			<h4 className="mb-2.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
				<Icon className="size-3.5" />
				{title}
				{count !== undefined ? <span className="ml-auto font-normal normal-case tabular-nums">{count}</span> : null}
			</h4>
			{children}
		</section>
	);
}

/** Inline editor for one sentence. Ctrl+Enter saves, Escape cancels. */
function SentenceEditor({ text, onSave, onDone }: { text: string; onSave: (text: string) => Promise<void>; onDone: () => void }) {
	const [value, setValue] = useState(text);
	const [saving, setSaving] = useState(false);
	const trimmed = value.trim();
	const save = async () => {
		if (!trimmed || trimmed === text) return onDone();
		setSaving(true);
		try {
			await onSave(trimmed);
			onDone();
		} catch (err) {
			toast.error("Could not save the sentence", { description: errorText(err) });
			setSaving(false);
		}
	};
	return (
		<div className="space-y-1.5">
			<Textarea
				autoFocus
				aria-label="Sentence text"
				value={value}
				maxLength={600}
				onChange={(e) => setValue(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
						e.preventDefault();
						void save();
					} else if (e.key === "Escape") {
						e.preventDefault();
						e.stopPropagation();
						onDone();
					}
				}}
				className="min-h-20 text-[13px] leading-snug"
			/>
			<div className="flex items-center gap-1.5">
				<span className="mr-auto text-[11px] text-muted-foreground">Ctrl+Enter to save</span>
				<Button variant="ghost" size="sm" onClick={onDone} disabled={saving}>
					<X />
					Cancel
				</Button>
				<Button size="sm" onClick={() => void save()} loading={saving} disabled={!trimmed}>
					<Check />
					Save
				</Button>
			</div>
		</div>
	);
}

/** What the inspector needs to edit a scene (drafts only; the sample is read-only). */
export type InspectorEdit = { draftId: string; disabled: boolean; onEdit: (next: Scene, label: string) => void; onRewriteStarted: () => void };

/** Right panel: details for one scene (narration timing, cues, props). Sentences can be edited when `onSaveSentence` is given; the scene when `edit` is. */
export function Inspector({
	timed,
	fps,
	localFrame,
	audioBase,
	onSaveSentence,
	edit,
}: {
	timed: TimedScene | undefined;
	fps: number;
	localFrame: number | null;
	audioBase?: string;
	onSaveSentence?: (sentenceId: string, text: string) => Promise<void>;
	edit?: InspectorEdit;
}) {
	const [editing, setEditing] = useState<string | null>(null);
	if (!timed) return <div className="p-6 text-sm text-muted-foreground">Select a scene to see its details.</div>;
	const { scene } = timed;
	const Icon = SCENE_ICONS[scene.type];
	const estimated = timed.sentences.some((s) => s.estimated);
	return (
		<div className="text-[13px]">
			<div className="flex items-start gap-3 px-4 py-4">
				<span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
					<Icon className="size-4" />
				</span>
				<div className="min-w-0">
					<div className="text-[11px] font-medium text-muted-foreground">{SCENE_LABELS[scene.type]}</div>
					<div className="truncate font-semibold leading-5" title={sceneName(scene)}>
						{sceneName(scene)}
					</div>
					<div className="mt-1.5 flex flex-wrap gap-1.5">
						<Badge>
							<Clock className="size-3" />
							{secs(timed.durationInFrames, fps)}
						</Badge>
						<Badge>{scene.transition.type} in</Badge>
						{estimated ? <Badge tone="warning">Timing estimated</Badge> : <Badge tone="success">Voice timed</Badge>}
					</div>
				</div>
			</div>

			{edit ? (
				<Section title="Edit scene" icon={SlidersHorizontal}>
					<SceneEditTools draftId={edit.draftId} scene={scene} disabled={edit.disabled} onEdit={edit.onEdit} onRewriteStarted={edit.onRewriteStarted} />
				</Section>
			) : null}

			<Section title="Narration" icon={Mic} count={timed.sentences.length}>
				{timed.sentences.length ? (
					<ol className="space-y-1">
						{timed.sentences.map((s, i) => {
							const speaking = localFrame !== null && localFrame >= s.from && localFrame < s.from + s.duration;
							return (
								<li key={s.id} className={cn("rounded-md px-2 py-1.5 transition-colors", speaking ? "bg-primary-soft" : "hover:bg-accent/60")}>
									<div className="mb-0.5 flex items-center gap-2 text-[11px] tabular-nums text-muted-foreground">
										<span className="font-semibold">{i + 1}</span>
										<span>
											{secs(s.from, fps)} – {secs(s.from + s.duration, fps)}
										</span>
										<span className="ml-auto flex items-center gap-1">
											{s.estimated ? <span>est.</span> : null}
											{audioBase && s.audio ? <ClipButton src={`${audioBase}${s.audio}`} /> : null}
											{onSaveSentence && editing !== s.id && !edit?.disabled ? (
												<button
													type="button"
													aria-label={`Edit sentence ${i + 1}`}
													onClick={() => setEditing(s.id)}
													className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
												>
													<Pencil className="size-3" />
												</button>
											) : null}
										</span>
									</div>
									{editing === s.id && onSaveSentence ? (
										<SentenceEditor text={s.text} onSave={(t) => onSaveSentence(s.id, t)} onDone={() => setEditing(null)} />
									) : (
										<p data-selectable className={cn("leading-snug", speaking && "text-primary-soft-foreground")}>
											{s.text}
										</p>
									)}
								</li>
							);
						})}
					</ol>
				) : (
					<p className="text-muted-foreground">No narration. The scene shows for its minimum time.</p>
				)}
			</Section>

			<Section title="Cues" icon={Zap} count={timed.cues.length}>
				{timed.cues.length ? (
					<ul className="space-y-1">
						{timed.cues.map((c, i) => (
							<li key={i} className="flex items-center gap-2 rounded-md px-2 py-1 tabular-nums">
								<span className={cn("size-1.5 rounded-full", localFrame !== null && localFrame >= c.frame ? "bg-primary" : "bg-border")} />
								<span className="w-12 text-muted-foreground">{secs(c.frame, fps)}</span>
								<span className="font-medium">{c.action}</span>
								{c.target !== undefined ? <span className="text-muted-foreground">item {c.target + 1}</span> : null}
								<span className="ml-auto text-[11px] text-muted-foreground">
									sentence {c.at + 1}
									{c.edge === "end" ? " end" : ""}
									{c.offsetMs ? ` ${c.offsetMs > 0 ? "+" : ""}${c.offsetMs}ms` : ""}
								</span>
							</li>
						))}
					</ul>
				) : (
					<p className="text-muted-foreground">This scene has no timed cues.</p>
				)}
			</Section>

			<details className="group border-t">
				<summary className="flex cursor-default list-none items-center gap-1.5 px-4 py-3.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground">
					<ChevronRight className="size-3.5 transition-transform group-open:rotate-90" />
					Scene data
					<span className="ml-auto font-normal normal-case">{formatTime(timed.from, fps)} in video</span>
				</summary>
				<pre data-selectable className="mx-4 mb-4 max-h-80 overflow-auto rounded-lg border bg-subtle p-3 font-mono text-[11.5px] leading-relaxed text-muted-foreground">
					{JSON.stringify(scene.props, null, 2)}
				</pre>
			</details>
		</div>
	);
}
