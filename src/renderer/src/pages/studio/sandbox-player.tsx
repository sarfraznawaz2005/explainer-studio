import { forwardRef, useEffect, useImperativeHandle, useRef, type CSSProperties } from "react";
import { FromPreview, PREVIEW_ORIGIN, PREVIEW_PAGE, type ToPreview } from "@shared/code-preview";
import type { PlanVideoProps } from "@video/plan/PlanVideo";

/** The Player calls the Studio uses: the real Player and the sandboxed one both have them. */
export type PreviewEvent = "frameupdate" | "seeked" | "play" | "pause" | "ended";
type Listener = (e: { detail: { frame: number } }) => void;
export type PreviewHandle = {
	seekTo(frame: number): void;
	toggle(): void;
	addEventListener(type: PreviewEvent, fn: Listener): void;
	removeEventListener(type: PreviewEvent, fn: Listener): void;
};

/** Props the sandbox gets: data only (functions cannot cross into the frame). */
export type SandboxProps = Omit<PlanVideoProps, "onCodeError">;

/**
 * The Studio preview for "AI free-form" videos. The AI's code runs only inside
 * this iframe: its own origin (es-preview://), no preload and no app bridge, a
 * strict policy with no network. The app talks to it by postMessage and checks
 * every message it gets back (FromPreview).
 */
export const SandboxPlayer = forwardRef<PreviewHandle, { props: SandboxProps; initialFrame: number; style?: CSSProperties; onCodeError?: (message: string, scene: number) => void }>(function SandboxPlayer({ props, initialFrame, style, onCodeError }, ref) {
	const frame = useRef<HTMLIFrameElement>(null);
	const ready = useRef(false);
	const listeners = useRef(new Map<PreviewEvent, Set<Listener>>());
	const latest = useRef({ props, initialFrame, onCodeError });
	latest.current = { props, initialFrame, onCodeError };

	const post = (m: ToPreview) => frame.current?.contentWindow?.postMessage(m, PREVIEW_ORIGIN);
	const emit = (type: PreviewEvent, f = 0) => listeners.current.get(type)?.forEach((fn) => fn({ detail: { frame: f } }));

	useImperativeHandle(
		ref,
		() => ({
			seekTo: (f) => post({ type: "seek", frame: f }),
			toggle: () => post({ type: "toggle" }),
			addEventListener: (type, fn) => {
				const set = listeners.current.get(type) ?? new Set();
				set.add(fn);
				listeners.current.set(type, set);
			},
			removeEventListener: (type, fn) => listeners.current.get(type)?.delete(fn),
		}),
		[],
	);

	useEffect(() => {
		const onMessage = (e: MessageEvent) => {
			if (e.source !== frame.current?.contentWindow || e.origin !== PREVIEW_ORIGIN) return;
			const r = FromPreview.safeParse(e.data);
			if (!r.success) return;
			const m = r.data;
			if (m.type === "ready") {
				ready.current = true;
				post({ type: "props", props: latest.current.props as Record<string, unknown>, initialFrame: latest.current.initialFrame });
			} else if (m.type === "frame") emit("frameupdate", m.frame);
			else if (m.type === "seeked") emit("seeked", m.frame);
			else if (m.type === "code-error") latest.current.onCodeError?.(m.message, m.scene);
			else emit(m.type);
		};
		window.addEventListener("message", onMessage);
		return () => window.removeEventListener("message", onMessage);
	}, []);

	// New plan, sound or style: the sandbox draws with it at once.
	useEffect(() => {
		if (ready.current) post({ type: "props", props: props as Record<string, unknown> });
	}, [props]);

	return <iframe ref={frame} title="Video preview" src={`${PREVIEW_ORIGIN}${PREVIEW_PAGE}?mode=player`} sandbox="allow-scripts allow-same-origin" allow="fullscreen; autoplay" style={{ border: 0, display: "block", ...style }} data-testid="sandbox-player" />;
});
