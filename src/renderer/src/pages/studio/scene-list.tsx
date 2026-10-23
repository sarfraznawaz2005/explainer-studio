import { Wand2 } from "lucide-react";
import { memo } from "react";
import { SCENE_LABELS, sceneName } from "@shared/plan/describe";
import { formatTime, type Timeline } from "@shared/plan/timing";
import { cn } from "@renderer/lib/utils";
import { SCENE_ICONS } from "./scene-meta";

/** Left panel: chapters and their scenes. Click a scene to jump to it. */
export const SceneList = memo(function SceneList({
	timeline,
	chapterTitles,
	activeId,
	selectedId,
	onPick,
	onRewriteChapter,
}: {
	timeline: Timeline;
	chapterTitles: string[];
	activeId: string | undefined;
	selectedId: string | undefined;
	onPick: (sceneId: string) => void;
	/** Drafts only: open the AI rewrite for chapter i. */
	onRewriteChapter?: (chapterIndex: number) => void;
}) {
	return (
		<nav aria-label="Scenes" className="flex flex-col gap-4 p-3">
			{timeline.chapters.map((ch, ci) => (
				<section key={ch.id}>
					<div className="group/ch flex items-baseline gap-2 px-2 pb-1.5">
						<span className="text-[11px] font-semibold tabular-nums text-primary">{String(ci + 1).padStart(2, "0")}</span>
						<h3 className="min-w-0 flex-1 truncate text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">{chapterTitles[ci]}</h3>
						{onRewriteChapter ? (
							<button
								type="button"
								aria-label={`Rewrite chapter ${ci + 1} with AI`}
								title="Rewrite this chapter with AI"
								data-testid="regen-chapter"
								onClick={() => onRewriteChapter(ci)}
								className="self-center rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover/ch:opacity-100"
							>
								<Wand2 className="size-3.5" />
							</button>
						) : null}
						<span className="text-[11px] tabular-nums text-muted-foreground">{formatTime(ch.durationInFrames, timeline.fps)}</span>
					</div>
					<ul className="space-y-0.5">
						{timeline.scenes
							.filter((s) => s.chapterIndex === ci)
							.map((s) => {
								const Icon = SCENE_ICONS[s.scene.type];
								const active = s.scene.id === activeId;
								const selected = s.scene.id === selectedId;
								return (
									<li key={s.scene.id}>
										<button
											onClick={() => onPick(s.scene.id)}
											aria-current={active ? "true" : undefined}
											className={cn(
												"group flex w-full items-center gap-2.5 rounded-lg border border-transparent px-2 py-1.5 text-left transition-colors",
												selected ? "border-border bg-card shadow-xs" : "hover:bg-accent/70",
											)}
										>
											<span
												className={cn(
													"flex size-7 shrink-0 items-center justify-center rounded-md border bg-background transition-colors",
													active ? "border-primary/40 bg-primary-soft text-primary" : "text-muted-foreground",
												)}
											>
												<Icon className="size-3.5" />
											</span>
											<span className="min-w-0 flex-1">
												<span className="block truncate text-[13px] font-medium leading-5">{sceneName(s.scene)}</span>
												<span className="block truncate text-[11px] leading-4 text-muted-foreground">
													{SCENE_LABELS[s.scene.type]} · {formatTime(s.durationInFrames, timeline.fps)}
												</span>
											</span>
											{active ? <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-primary" aria-label="Playing" /> : null}
										</button>
									</li>
								);
							})}
					</ul>
				</section>
			))}
		</nav>
	);
});
