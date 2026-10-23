import { memo, useRef } from "react";
import { sceneName } from "@shared/plan/describe";
import type { Soundtrack } from "@shared/plan/soundtrack";
import { formatTime, type Timeline } from "@shared/plan/timing";
import { Tooltip } from "@renderer/components/ui/primitives";
import { cn } from "@renderer/lib/utils";
import { SCENE_ICONS } from "./scene-meta";

/** One thin lane of the sound timeline. */
function Lane({ label, children, empty }: { label: string; children: React.ReactNode; empty: string }) {
	return (
		<div className="flex items-center gap-2">
			<span className="w-12 shrink-0 text-right text-[10.5px] font-medium text-muted-foreground">{label}</span>
			<div className="relative h-3 flex-1 overflow-hidden rounded bg-muted" role="img" aria-label={`${label} lane`}>
				{children}
				{!children || (Array.isArray(children) && !children.length) ? <span className="absolute inset-0 flex items-center px-1.5 text-[9.5px] text-muted-foreground">{empty}</span> : null}
			</div>
		</div>
	);
}

/** Scene blocks sized by duration, grouped by chapter, with a playhead, and lanes for voice, music and effects. Click anywhere to seek. */
export const TimelineStrip = memo(function TimelineStrip({
	timeline,
	chapterTitles,
	frame,
	selectedId,
	onSeek,
	soundtrack,
}: {
	timeline: Timeline;
	chapterTitles: string[];
	frame: number;
	selectedId: string | undefined;
	onSeek: (frame: number) => void;
	soundtrack?: Soundtrack;
}) {
	const ref = useRef<HTMLDivElement>(null);
	const total = timeline.durationInFrames;
	const pct = (f: number) => `${(f / total) * 100}%`;

	const seekFromPointer = (clientX: number) => {
		const box = ref.current?.getBoundingClientRect();
		if (!box) return;
		onSeek(Math.round(Math.min(1, Math.max(0, (clientX - box.left) / box.width)) * (total - 1)));
	};

	return (
		<div className="select-none">
			<div className="relative mb-1.5 h-4">
				{timeline.chapters.map((c, i) => (
					<div key={c.id} className="absolute top-0 truncate pr-2 text-[11px] font-medium text-muted-foreground" style={{ left: pct(c.from), width: pct(c.durationInFrames) }}>
						{chapterTitles[i]}
					</div>
				))}
			</div>
			<div
				ref={ref}
				role="slider"
				tabIndex={0}
				aria-label="Timeline"
				aria-valuemin={0}
				aria-valuemax={total - 1}
				aria-valuenow={frame}
				aria-valuetext={formatTime(frame, timeline.fps)}
				onPointerDown={(e) => {
					e.currentTarget.setPointerCapture(e.pointerId);
					seekFromPointer(e.clientX);
				}}
				onPointerMove={(e) => {
					if (e.currentTarget.hasPointerCapture(e.pointerId)) seekFromPointer(e.clientX);
				}}
				onKeyDown={(e) => {
					const step = e.shiftKey ? timeline.fps * 5 : timeline.fps;
					if (e.key === "ArrowRight") onSeek(Math.min(total - 1, frame + step));
					else if (e.key === "ArrowLeft") onSeek(Math.max(0, frame - step));
					else return;
					e.preventDefault();
				}}
				className="relative flex h-12 cursor-pointer gap-px overflow-hidden rounded-lg border bg-muted p-1"
			>
				{timeline.scenes.map((s) => {
					const Icon = SCENE_ICONS[s.scene.type];
					const even = s.chapterIndex % 2 === 0;
					return (
						<Tooltip key={s.scene.id} content={`${sceneName(s.scene)} · ${formatTime(s.durationInFrames, timeline.fps)}`}>
							<div
								className={cn(
									"flex min-w-0 items-center gap-1.5 overflow-hidden rounded-[5px] px-1.5 text-[11px] font-medium transition-colors",
									even ? "bg-primary/14 text-primary-soft-foreground" : "bg-card text-foreground/80",
									s.scene.id === selectedId && "ring-2 ring-primary ring-inset",
								)}
								style={{ flexGrow: s.durationInFrames, flexBasis: 0 }}
							>
								<Icon className="size-3 shrink-0 opacity-70" />
								<span className="truncate">{sceneName(s.scene)}</span>
							</div>
						</Tooltip>
					);
				})}
				<div className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-foreground shadow-[0_0_0_1px_var(--background)]" style={{ left: pct(frame) }}>
					<div className="absolute -top-px left-1/2 size-2.5 -translate-x-1/2 rotate-45 rounded-[2px] bg-foreground" />
				</div>
			</div>
			<div className="relative mt-2 space-y-1" data-testid="sound-lanes" onPointerDown={(e) => {
				const box = (e.currentTarget.lastElementChild as HTMLElement | null)?.getBoundingClientRect();
				if (box) onSeek(Math.round(Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)) * (total - 1)));
			}}>
				<Lane label="Voice" empty="No narration">
					{timeline.scenes.flatMap((sc) =>
						sc.sentences.map((st) => (
							<div
								key={st.id}
								title={st.estimated ? "Not voiced yet (estimated length)" : "Voiced"}
								className={cn("absolute inset-y-0.5 rounded-[2px]", st.estimated ? "bg-warning/45" : "bg-primary/60")}
								style={{ left: pct(sc.from + st.from), width: `max(1px, ${pct(st.duration)})` }}
							/>
						)),
					)}
				</Lane>
				<Lane label="Music" empty="No music">
					{(soundtrack?.music ?? []).map((m, i) => (
						<div key={i} title="Music bed" className="absolute inset-y-0.5 rounded-[2px] bg-success/50" style={{ left: pct(m.from), width: pct(m.durationInFrames) }} />
					))}
				</Lane>
				<Lane label="Effects" empty="No sound effects">
					{(soundtrack?.sfx ?? []).map((x, i) => (
						<div key={i} title={`Sound effect: ${x.role}`} className="absolute inset-y-0 w-[3px] -translate-x-1/2 rounded-full bg-accent-foreground/70" style={{ left: pct(x.frame) }} />
					))}
				</Lane>
				<div className="pointer-events-none absolute inset-y-0 left-14 right-0">
					<div className="absolute inset-y-0 w-px bg-foreground/70" style={{ left: pct(frame) }} />
				</div>
			</div>
			<div className="mt-1.5 flex justify-between text-[11px] tabular-nums text-muted-foreground">
				<span>{formatTime(frame, timeline.fps)}</span>
				<span>{formatTime(total, timeline.fps)}</span>
			</div>
		</div>
	);
});
