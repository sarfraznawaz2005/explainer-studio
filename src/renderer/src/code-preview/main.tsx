import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import { Player, Thumbnail, type PlayerRef } from "@remotion/player";
import { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { checkFrames, PartId, type CheckResult, type FromPreview, type ToPreview } from "@shared/code-preview";
import { VideoPlan } from "@shared/plan/schema";
import { computeTimeline } from "@shared/plan/timing";
import { allowVideoCode } from "@video/code/runtime";
import { inspect, motionPass, short, tick, type Out } from "./checks";
import { PlanVideo, planMetadata, type PlanVideoProps } from "@video/plan/PlanVideo";

/**
 * The sandbox page for AI video code (es-preview://app/code-preview.html).
 * No preload, its own origin, a strict policy (see preview-protocol.ts).
 *  - ?mode=player: the Studio preview, inside an iframe. Talks to the app by postMessage.
 *  - ?mode=check: the test draw, in a hidden window. Main calls window.__esCheck.
 */
allowVideoCode();

const send = (m: FromPreview) => window.parent.postMessage(m, "*");

/* ---------- Player ---------- */

function PreviewPlayer() {
	const [state, setState] = useState<{ props: PlanVideoProps; initialFrame: number } | null>(null);
	const player = useRef<PlayerRef>(null);

	useEffect(() => {
		const onMessage = (e: MessageEvent) => {
			if (e.source !== window.parent) return;
			const m = e.data as ToPreview;
			if (m?.type === "props") setState((s) => ({ props: m.props as PlanVideoProps, initialFrame: s?.initialFrame ?? Math.max(0, Number(m.initialFrame) || 0) }));
			else if (m?.type === "seek") player.current?.seekTo(Math.max(0, Number(m.frame) || 0));
			else if (m?.type === "toggle") player.current?.toggle();
			else if (m?.type === "pick") setPicking(m.on === true);
		};
		window.addEventListener("message", onMessage);
		send({ type: "ready" });
		return () => window.removeEventListener("message", onMessage);
	}, []);

	// Pick mode: the part (an element with a data-id) under the pointer is outlined; a click sends its id.
	const [picking, setPicking] = useState(false);
	const [hover, setHover] = useState<DOMRect | null>(null);
	useEffect(() => {
		if (!picking) {
			setHover(null);
			return;
		}
		player.current?.pause();
		// The player lays a click layer over the picture and the picture takes no pointer hits:
		// the part is the smallest named element whose box holds the point.
		const partAt = (e: MouseEvent) => {
			let best: HTMLElement | null = null;
			let bestArea = Infinity;
			for (const el of document.querySelectorAll<HTMLElement>("[data-id]")) {
				const r = el.getBoundingClientRect();
				const area = r.width * r.height;
				if (area > 0 && area < bestArea && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
					best = el;
					bestArea = area;
				}
			}
			return best;
		};
		const onMove = (e: MouseEvent) => setHover(partAt(e)?.getBoundingClientRect() ?? null);
		const onClick = (e: MouseEvent) => {
			// Before the player's own click (play/pause).
			e.preventDefault();
			e.stopPropagation();
			const el = partAt(e);
			const id = el?.getAttribute("data-id") ?? "";
			if (!el || !PartId.safeParse(id).success) return;
			send({ type: "picked", id, text: (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 200) });
			setPicking(false);
		};
		const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPicking(false);
		window.addEventListener("mousemove", onMove, true);
		window.addEventListener("click", onClick, true);
		window.addEventListener("keydown", onKey, true);
		return () => {
			window.removeEventListener("mousemove", onMove, true);
			window.removeEventListener("click", onClick, true);
			window.removeEventListener("keydown", onKey, true);
		};
	}, [picking]);

	const ready = !!state;
	useEffect(() => {
		const p = player.current;
		if (!p) return;
		// One frame message per paint at most (the app mirrors the clock for its timeline).
		let raf = 0;
		let latest = 0;
		const onFrame = (e: { detail: { frame: number } }) => {
			latest = e.detail.frame;
			if (!raf)
				raf = requestAnimationFrame(() => {
					raf = 0;
					send({ type: "frame", frame: latest });
				});
		};
		const onSeeked = (e: { detail: { frame: number } }) => send({ type: "seeked", frame: e.detail.frame });
		const onPlay = () => send({ type: "play" });
		const onPause = () => send({ type: "pause" });
		const onEnded = () => send({ type: "ended" });
		p.addEventListener("frameupdate", onFrame);
		p.addEventListener("seeked", onSeeked);
		p.addEventListener("play", onPlay);
		p.addEventListener("pause", onPause);
		p.addEventListener("ended", onEnded);
		return () => {
			p.removeEventListener("frameupdate", onFrame);
			p.removeEventListener("seeked", onSeeked);
			p.removeEventListener("play", onPlay);
			p.removeEventListener("pause", onPause);
			p.removeEventListener("ended", onEnded);
			cancelAnimationFrame(raf);
		};
	}, [ready]);

	// Each code error once, so a crash on every frame is not a flood of messages.
	const seen = useRef(new Set<string>());
	const inputProps = useMemo<PlanVideoProps | null>(
		() =>
			state
				? {
						...state.props,
						onCodeError: (message, scene) => {
							const key = `${scene}:${message}`;
							if (seen.current.has(key)) return;
							seen.current.add(key);
							send({ type: "code-error", message: message.slice(0, 2000), scene });
						},
					}
				: null,
		[state],
	);
	if (!state || !inputProps) return null;
	const meta = planMetadata(state.props.plan);
	return (
		<>
			<PlayerOf meta={meta} player={player} state={state} inputProps={inputProps} />
			{picking ? (
				<div style={{ position: "fixed", inset: 0, cursor: "crosshair", pointerEvents: "none", zIndex: 10 }}>
					{hover ? <div style={{ position: "fixed", left: hover.left - 3, top: hover.top - 3, width: hover.width + 6, height: hover.height + 6, border: "3px solid #f59e0b", borderRadius: 6, background: "rgba(245,158,11,0.12)" }} /> : null}
				</div>
			) : null}
		</>
	);
}

function PlayerOf({ meta, player, state, inputProps }: { meta: ReturnType<typeof planMetadata>; player: React.RefObject<PlayerRef | null>; state: { initialFrame: number }; inputProps: PlanVideoProps }) {
	return (
		<Player
			ref={player}
			initialFrame={Math.min(state.initialFrame, meta.durationInFrames - 1)}
			component={PlanVideo}
			inputProps={inputProps}
			durationInFrames={meta.durationInFrames}
			fps={meta.fps}
			compositionWidth={meta.width}
			compositionHeight={meta.height}
			style={{ width: "100%", height: "100%" }}
			controls
			clickToPlay
			doubleClickToFullscreen
			spaceKeyToPlayOrPause={false}
			numberOfSharedAudioTags={0}
			acknowledgeRemotionLicense
		/>
	);
}

/* ---------- Test draw ---------- */

/** Draws the video at a few frames per scene and reports crashes and visible problems. */
async function check(req: { plan: unknown; figureBase?: string }): Promise<CheckResult> {
	const out: Out = { errors: [], warnings: [], kinds: new Map() };
	const parsed = VideoPlan.safeParse(req.plan);
	if (!parsed.success) return { errors: [{ frame: 0, scene: -1, message: "The plan does not parse." }], warnings: [], frames: 0 };
	const plan = parsed.data;
	const timeline = computeTimeline(plan);
	const { width, height } = plan.meta;
	const host = document.createElement("div");
	host.style.cssText = `position:absolute;left:0;top:0;width:${width}px;height:${height}px;overflow:hidden`;
	document.body.appendChild(host);
	const root = createRoot(host);
	let at = { frame: 0, scene: 0 };
	const onCodeError = (message: string, scene: number) => {
		const issue = { frame: at.frame, scene: scene >= 0 ? scene : -1, message: short(message, 600) };
		if (!out.errors.some((e) => e.scene === issue.scene && e.message === issue.message)) out.errors.push(issue);
	};
	const draw = (frame: number, scene: number) => {
		at = { frame, scene };
		flushSync(() =>
			root.render(
				<Thumbnail
					component={PlanVideo}
					inputProps={{ plan, figureBase: req.figureBase, onCodeError } satisfies PlanVideoProps}
					compositionWidth={width}
					compositionHeight={height}
					durationInFrames={timeline.durationInFrames}
					fps={timeline.fps}
					frameToDisplay={frame}
					style={{ width, height }}
				/>,
			),
		);
	};
	const fileFailed = () => out.errors.some((e) => e.scene === -1);
	let drawn = 0;
	try {
		for (const f of checkFrames(timeline.scenes)) {
			draw(f.frame, f.scene);
			await tick();
			await tick();
			drawn++;
			// The file did not load: every frame is the built-in video, nothing more to learn.
			if (fileFailed()) break;
			inspect(host, f.frame, f.scene, f.settled, out);
			if (out.errors.length >= 20) break;
		}
		// More frames: motion over time (frozen stretches, text shown too briefly); crashes there count too.
		if (!fileFailed() && out.errors.length < 20) await motionPass(draw, host, timeline, out);
	} finally {
		root.unmount();
		host.remove();
	}
	return { errors: out.errors.slice(0, 200), warnings: out.warnings.slice(0, 20), frames: drawn };
}

const mode = new URLSearchParams(window.location.search).get("mode");
if (mode === "check") (window as unknown as { __esCheck: typeof check }).__esCheck = check;
else createRoot(document.getElementById("root")!).render(<PreviewPlayer />);
