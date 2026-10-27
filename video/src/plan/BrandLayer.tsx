import { useState } from "react";
import { AbsoluteFill, Img, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { brandFontStack, type BrandStamp } from "../../../src/shared/brand";
import { isNarrow, isPhone } from "../../../src/shared/plan/frame";

/**
 * The brand kit on screen: an intro before the first scene, an outro with an
 * end screen after the last, and a watermark in between. All of it uses the
 * kit's own colours and font, so the channel looks the same in every style.
 */

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

function palette(b: BrandStamp) {
	const dark = b.colors.dark;
	return {
		bg: dark ? "#0d0f14" : "#f7f8fa",
		text: dark ? "#f3f5f9" : "#12141a",
		muted: dark ? "#a3a9b8" : "#5a6070",
		font: brandFontStack(b.font),
	};
}

/** The logo, or the channel's first letter in a disc when there is no logo or it does not load. */
function Logo({ b, size }: { b: BrandStamp; size: number }) {
	const [failed, setFailed] = useState(false);
	if (b.logo && !failed) return <Img src={b.logo} onError={() => setFailed(true)} style={{ height: size, width: "auto", maxWidth: size * 3, objectFit: "contain", display: "block" }} />;
	return (
		<div
			style={{
				width: size,
				height: size,
				borderRadius: size,
				background: `linear-gradient(135deg, ${b.colors.primary}, ${b.colors.accent})`,
				color: "#fff",
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				fontSize: size * 0.5,
				fontWeight: 800,
				fontFamily: brandFontStack(b.font),
			}}
		>
			{(b.channel.trim()[0] ?? "?").toUpperCase()}
		</div>
	);
}

/** Fades the whole card out over its last frames, so the cut to the next part is soft. */
function useFadeOut(frames: number) {
	const frame = useCurrentFrame();
	const { durationInFrames } = useVideoConfig();
	return interpolate(frame, [durationInFrames - frames, durationInFrames], [1, 0], clamp);
}

function Glow({ b }: { b: BrandStamp }) {
	return (
		<>
			<div style={{ position: "absolute", width: 1100, height: 1100, left: -300, top: -420, borderRadius: 1100, background: b.colors.primary, opacity: 0.16, filter: "blur(120px)" }} />
			<div style={{ position: "absolute", width: 900, height: 900, right: -260, bottom: -380, borderRadius: 900, background: b.colors.secondary, opacity: 0.14, filter: "blur(120px)" }} />
		</>
	);
}

export function BrandIntro({ b }: { b: BrandStamp }) {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	const p = palette(b);
	const logo = spring({ frame, fps, config: { damping: 13, mass: 0.7 } });
	const name = spring({ frame: frame - 8, fps, config: { damping: 200 } });
	const tag = spring({ frame: frame - 18, fps, config: { damping: 200 } });
	const bar = interpolate(frame, [10, 34], [0, 1], clamp);
	const out = useFadeOut(10);
	const { width, height } = useVideoConfig();
	const tall = isNarrow(width, height);
	return (
		<AbsoluteFill style={{ background: p.bg, color: p.text, fontFamily: p.font, opacity: out, overflow: "hidden" }} data-brand="intro">
			<Glow b={b} />
			<AbsoluteFill style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 34, padding: tall ? "0 72px" : undefined, textAlign: tall ? "center" : undefined }}>
				<div style={{ transform: `scale(${0.4 + 0.6 * logo})`, opacity: Math.min(1, logo * 1.4) }}>
					<Logo b={b} size={180} />
				</div>
				<div style={{ fontSize: 96, fontWeight: 800, letterSpacing: -2, opacity: name, transform: `translateY(${(1 - name) * 30}px)` }}>{b.channel}</div>
				<div style={{ width: 260 * bar, height: 8, borderRadius: 8, background: `linear-gradient(90deg, ${b.colors.primary}, ${b.colors.secondary})` }} />
				{b.tagline ? <div style={{ fontSize: 40, color: p.muted, opacity: tag, transform: `translateY(${(1 - tag) * 16}px)` }}>{b.tagline}</div> : null}
				{b.series ? (
					<div
						style={{
							marginTop: 6,
							opacity: tag,
							fontSize: 30,
							fontWeight: 700,
							letterSpacing: 3,
							textTransform: "uppercase",
							color: b.colors.primary,
							padding: "10px 26px",
							borderRadius: 999,
							background: `${b.colors.primary}1a`,
						}}
					>
						{b.series.title} · Episode {b.series.episode}
					</div>
				) : null}
			</AbsoluteFill>
		</AbsoluteFill>
	);
}

export function BrandOutro({ b }: { b: BrandStamp }) {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	const p = palette(b);
	const a = spring({ frame, fps, config: { damping: 200 } });
	const c = spring({ frame: frame - 12, fps, config: { damping: 12 } });
	const zones = spring({ frame: frame - 6, fps, config: { damping: 200 } });
	const out = useFadeOut(12);
	const { width, height } = useVideoConfig();
	const tall = isNarrow(width, height);
	// With an end screen the words sit on the left, leaving the right for YouTube's elements.
	// Narrow videos (Shorts, TikTok, Reels, feeds) have no end screens: the words stay centred.
	const left = b.endScreen && !tall;
	return (
		<AbsoluteFill style={{ background: p.bg, color: p.text, fontFamily: p.font, opacity: out, overflow: "hidden" }} data-brand="outro">
			<Glow b={b} />
			<div
				style={{
					position: "absolute",
					top: 0,
					bottom: 0,
					left: left ? 150 : tall ? 72 : 0,
					right: left ? 960 : tall ? 72 : 0,
					display: "flex",
					flexDirection: "column",
					justifyContent: "center",
					alignItems: left ? "flex-start" : "center",
					textAlign: left ? "left" : "center",
					gap: 36,
				}}
			>
				<div style={{ display: "flex", alignItems: "center", gap: 24, opacity: a }}>
					<Logo b={b} size={96} />
					<div style={{ fontSize: 44, fontWeight: 700 }}>{b.channel}</div>
				</div>
				{b.message ? <div style={{ fontSize: 88, fontWeight: 800, lineHeight: 1.05, letterSpacing: -2, opacity: a, transform: `translateY(${(1 - a) * 30}px)` }}>{b.message}</div> : null}
				{b.callToAction ? (
					<div
						style={{
							display: "inline-flex",
							alignItems: "center",
							gap: 16,
							padding: "20px 36px",
							borderRadius: 999,
							background: b.colors.primary,
							color: "#fff",
							fontSize: 38,
							fontWeight: 700,
							transform: `scale(${0.7 + 0.3 * c})`,
							transformOrigin: left ? "left center" : "center",
							opacity: Math.min(1, c * 1.5),
						}}
					>
						<svg width="34" height="34" viewBox="0 0 24 24" aria-hidden>
							<path d="M8 5v14l11-7z" fill="#fff" />
						</svg>
						{b.callToAction}
					</div>
				) : null}
			</div>
			{left ? (
				<div style={{ position: "absolute", right: 150, top: 230, width: 720, opacity: zones }} data-brand="end-screen">
					{/* Framed space for YouTube's end screen elements. YouTube draws them on top. */}
					<div style={{ width: 720, height: 405, borderRadius: 22, border: `4px dashed ${b.colors.primary}88`, background: `${b.colors.primary}0d`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 30, color: p.muted }}>Watch next</div>
					<div style={{ display: "flex", alignItems: "center", gap: 28, marginTop: 44 }}>
						<div style={{ width: 200, height: 200, borderRadius: 200, border: `4px dashed ${b.colors.secondary}99`, background: `${b.colors.secondary}10` }} />
						<div style={{ fontSize: 30, color: p.muted }}>Subscribe</div>
					</div>
				</div>
			) : null}
		</AbsoluteFill>
	);
}

const MARK_SIZE = { small: 60, medium: 84, large: 120 } as const;

/** Small logo in a corner while the scenes play. Stays clear of the chapter progress bar. */
export function Watermark({ b, dark }: { b: BrandStamp; dark: boolean }) {
	const frame = useCurrentFrame();
	const { durationInFrames, width, height } = useVideoConfig();
	// Phones (9:16): below the app's own bar at the top. Narrow frames: closer to the side.
	const tall = isPhone(width, height);
	const narrow = isNarrow(width, height);
	const w = b.watermark;
	const fade = interpolate(frame, [0, 15, durationInFrames - 15, durationInFrames], [0, 1, 1, 0], clamp);
	const size = MARK_SIZE[w.size];
	// Vertical: the phone app puts its buttons in the lower corners, so the mark goes to the top.
	const top = w.corner.startsWith("top") || tall;
	const leftSide = w.corner.endsWith("left");
	return (
		<div
			data-brand="watermark"
			style={{
				position: "absolute",
				[top ? "top" : "bottom"]: top ? (tall ? 170 : 50) : 84,
				[leftSide ? "left" : "right"]: narrow ? 48 : 60,
				opacity: w.opacity * fade,
				display: "flex",
				alignItems: "center",
				gap: 14,
				fontFamily: brandFontStack(b.font),
				fontWeight: 700,
				fontSize: size * 0.34,
				color: dark ? "#ffffff" : "#14161c",
				pointerEvents: "none",
			}}
		>
			<Logo b={b} size={size} />
			{b.logo ? null : <span>{b.channel}</span>}
		</div>
	);
}
