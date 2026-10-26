import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import { Player, Thumbnail, type PlayerRef } from "@remotion/player";
import { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { checkFrames, type CheckIssue, type CheckResult, type FromPreview, type ToPreview } from "@shared/code-preview";
import { VideoPlan } from "@shared/plan/schema";
import { computeTimeline } from "@shared/plan/timing";
import { allowVideoCode } from "@video/code/runtime";
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
		};
		window.addEventListener("message", onMessage);
		send({ type: "ready" });
		return () => window.removeEventListener("message", onMessage);
	}, []);

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

const tick = () => new Promise((r) => setTimeout(r, 0));
const short = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** How see-through an element really is (its own opacity times its parents', up to the frame). */
function opacityOf(el: Element, stop: Element): number {
	let o = 1;
	for (let e: Element | null = el; e && e !== stop; e = e.parentElement) o *= Number(getComputedStyle(e).opacity) || 0;
	return o;
}

/** Problems in one drawn frame: NaN values, an empty picture, text outside the frame. */
function inspect(frameBox: HTMLElement, frame: number, scene: number, settled: boolean, out: { errors: CheckIssue[]; warnings: CheckIssue[] }) {
	const box = frameBox.getBoundingClientRect();
	const all = [...frameBox.querySelectorAll("*")];
	const bad = all.find((el) => [...el.attributes].some((a) => /\bNaN\b|\bInfinity\b/.test(a.value)));
	if (bad) {
		const a = [...bad.attributes].find((x) => /\bNaN\b|\bInfinity\b/.test(x.value))!;
		out.errors.push({ frame, scene, message: `A value is NaN or Infinity: <${bad.tagName.toLowerCase()} ${a.name}="${short(a.value, 120)}">. Check the maths (division by zero, a missing prop, an empty list).` });
	}
	if (!settled) return;
	const text = frameBox.innerText.trim();
	const shapes = frameBox.querySelector("svg, img, canvas");
	const filled = all.filter((el) => {
		const cs = getComputedStyle(el);
		return (cs.backgroundImage !== "none" || !/rgba\(0, 0, 0, 0\)|transparent/.test(cs.backgroundColor)) && el.getBoundingClientRect().width > 0;
	}).length;
	if (!text && !shapes && filled <= 1) out.warnings.push({ frame, scene, message: "The frame shows nothing but a background." });
	let outside = 0;
	// The text itself (its glyphs), not the box around it: a wide box with short text is fine.
	const walker = document.createTreeWalker(frameBox, NodeFilter.SHOW_TEXT);
	const range = document.createRange();
	for (let n = walker.nextNode(); n && outside < 3; n = walker.nextNode()) {
		const t = n.textContent?.trim();
		const el = n.parentElement;
		if (!t || !el) continue;
		range.selectNodeContents(n);
		const r = range.getBoundingClientRect();
		if (r.width === 0 || r.height === 0) continue;
		const off = r.left < box.left - 4 || r.right > box.right + 4 || r.top < box.top - 4 || r.bottom > box.bottom + 4;
		if (off && opacityOf(el, frameBox) > 0.05) {
			outside++;
			out.warnings.push({ frame, scene, message: `Text "${short(t)}" goes outside the ${Math.round(box.width)}×${Math.round(box.height)} frame (it reaches x ${Math.round(r.left - box.left)} to ${Math.round(r.right - box.left)}, y ${Math.round(r.top - box.top)} to ${Math.round(r.bottom - box.top)}).` });
		}
	}
}

/** Draws the video at a few frames per scene and reports crashes and visible problems. */
async function check(req: { plan: unknown; figureBase?: string }): Promise<CheckResult> {
	const out = { errors: [] as CheckIssue[], warnings: [] as CheckIssue[] };
	const parsed = VideoPlan.safeParse(req.plan);
	if (!parsed.success) return { ...out, errors: [{ frame: 0, scene: -1, message: "The plan does not parse." }], frames: 0 };
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
	const frames = checkFrames(timeline.scenes);
	let drawn = 0;
	try {
		for (const f of frames) {
			at = f;
			flushSync(() =>
				root.render(
					<Thumbnail
						component={PlanVideo}
						inputProps={{ plan, figureBase: req.figureBase, onCodeError } satisfies PlanVideoProps}
						compositionWidth={width}
						compositionHeight={height}
						durationInFrames={timeline.durationInFrames}
						fps={timeline.fps}
						frameToDisplay={f.frame}
						style={{ width, height }}
					/>,
				),
			);
			await tick();
			await tick();
			drawn++;
			// The file did not load: every frame is the built-in video, nothing more to learn.
			if (out.errors.some((e) => e.scene === -1)) break;
			inspect(host, f.frame, f.scene, f.settled, out);
			if (out.errors.length >= 20) break;
		}
	} finally {
		root.unmount();
		host.remove();
	}
	return { errors: out.errors, warnings: out.warnings.slice(0, 20), frames: drawn };
}

const mode = new URLSearchParams(window.location.search).get("mode");
if (mode === "check") (window as unknown as { __esCheck: typeof check }).__esCheck = check;
else createRoot(document.getElementById("root")!).render(<PreviewPlayer />);
