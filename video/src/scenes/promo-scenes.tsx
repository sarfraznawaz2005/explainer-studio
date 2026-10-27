import { useState, type CSSProperties } from "react";
import { Img, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { PropsOf } from "../../../src/shared/plan/schema";
import { texture } from "../styles/styles";
import { accentAt, appearStyle, borders, ramp, SceneFrame, Surface, useAppear, useLayout, useRevealFrames, useScene, useStyle } from "./kit";

/**
 * Promo and social scenes: a name bar, a phone or browser, a chat, a social
 * post, a call to action and a logo outro. Generic designs (no real app or
 * brand look), drawn in the video's style.
 */

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** Text size by length: big for short lines, smaller for long ones. */
const sizeFor = (text: string, sizes: [number, number, number], limits: [number, number] = [40, 90]) => (text.length <= limits[0] ? sizes[0] : text.length <= limits[1] ? sizes[1] : sizes[2]);

/** 12300 → "12.3K". */
export function compactNumber(n: number): string {
	if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
	if (n >= 1_000) return `${+(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;
	return String(Math.round(n));
}

/** A picture from the source filling a box; nothing when there is no picture folder or the file cannot be read. */
function Picture({ file, style }: { file: string; style?: CSSProperties }) {
	const { figureBase } = useScene();
	const [failed, setFailed] = useState(false);
	if (!figureBase || failed) return null;
	return <Img src={`${figureBase}${encodeURIComponent(file)}`} onError={() => setFailed(true)} maxRetries={1} style={{ display: "block", width: "100%", height: "100%", objectFit: "cover", ...style }} />;
}

/* ---------- Name bar ---------- */

export function LowerThirdScene({ name, role, statement, side }: PropsOf<"lowerthird">) {
	const s = useStyle();
	const frame = useCurrentFrame();
	const { vertical } = useLayout();
	const bar = useAppear(statement ? 10 : 4, { damping: 200 });
	const big = useAppear(0, { damping: 200 });
	const wipe = interpolate(bar, [0, 1], [100, 0], clamp);
	const right = side === "right";
	const size = statement ? sizeFor(statement, vertical ? [64, 54, 46] : [76, 64, 54]) : 0;
	return (
		<SceneFrame center>
			<div style={{ ...texture(s), flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between", minHeight: 0 }}>
				<div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
					{statement ? <div style={{ ...appearStyle(big, 20, s.motion), maxWidth: 1400, textAlign: "center", fontFamily: s.headingFont, fontWeight: s.headingWeight, fontSize: size, lineHeight: 1.2 }}>{statement}</div> : null}
				</div>
				<div style={{ display: "flex", justifyContent: right ? "flex-end" : "flex-start" }}>
					<div style={{ display: "flex", flexDirection: right ? "row-reverse" : "row", alignItems: "stretch", clipPath: right ? `inset(0 0 0 ${wipe}%)` : `inset(0 ${wipe}% 0 0)` }}>
						<div style={{ width: 14, background: s.accent, borderRadius: 4 }} />
						<div style={{ background: s.surface, ...borders(`${Math.max(1, s.line.width)}px ${s.line.style} ${s.surfaceBorder}`), boxShadow: s.shadow, padding: vertical ? "18px 30px" : "20px 36px", textAlign: right ? "right" : "left" }}>
							<div style={{ fontFamily: s.headingFont, fontWeight: s.headingWeight, fontSize: vertical ? 50 : 54, lineHeight: 1.1, opacity: ramp(frame, (statement ? 10 : 4) + 6, (statement ? 10 : 4) + 16) }}>{name}</div>
							{role ? <div style={{ marginTop: 6, fontSize: vertical ? 32 : 34, color: s.muted, opacity: ramp(frame, (statement ? 10 : 4) + 12, (statement ? 10 : 4) + 22) }}>{role}</div> : null}
						</div>
					</div>
				</div>
			</div>
		</SceneFrame>
	);
}

/* ---------- Phone or browser ---------- */

function AppScreen({ title, items, frames, size }: { title?: string; items: string[]; frames: number[]; size: number }) {
	const s = useStyle();
	const frame = useCurrentFrame();
	return (
		<div style={{ height: "100%", display: "flex", flexDirection: "column", background: s.bg }}>
			<div style={{ padding: `${size * 0.6}px ${size * 0.8}px`, background: s.hand ? "transparent" : s.accent, color: s.hand ? s.accent : s.onAccent, fontWeight: 800, fontSize: size * 1.05, borderBottom: s.hand ? `3px solid ${s.accent}` : "none" }}>{title ?? ""}</div>
			<div style={{ display: "flex", flexDirection: "column", gap: size * 0.55, padding: size * 0.7 }}>
				{items.map((t, i) => {
					const p = ramp(frame, frames[i]!, frames[i]! + 12);
					return (
						<div key={i} style={{ ...appearStyle(p, 18, s.motion), display: "flex", alignItems: "center", gap: size * 0.5, padding: `${size * 0.5}px ${size * 0.6}px`, borderRadius: Math.min(16, s.radius), background: s.surface, ...borders(`${Math.max(1, s.line.width)}px ${s.line.style} ${s.surfaceBorder}`), fontSize: size, lineHeight: 1.25 }}>
							<div style={{ flexShrink: 0, width: size * 0.7, height: size * 0.7, borderRadius: 99, background: accentAt(s, i) }} />
							<div style={{ minWidth: 0 }}>{t}</div>
						</div>
					);
				})}
			</div>
		</div>
	);
}

export function DeviceScene({ heading, device, url, figure, items, caption }: PropsOf<"device">) {
	const s = useStyle();
	const frame = useCurrentFrame();
	const frames = useRevealFrames(items.length);
	const { vertical, contentW, stageH } = useLayout();
	const enter = useAppear(0, { damping: 18 });
	const capP = useAppear(caption ? 20 : null, { damping: 200 });
	// With a picture on the screen, the items are a list beside it (wide) or under it (narrow).
	const side = !!figure && items.length > 0;
	const capH = caption ? 70 : 0;
	const stage = stageH(heading) - capH - (side && vertical ? items.length * 74 + 20 : 0);
	const phone = device === "phone";
	const boxW = side && !vertical ? contentW * 0.55 : contentW;
	const [w, h] = phone ? [Math.min(boxW, stage * 0.49), Math.min(stage, boxW / 0.49)] : [Math.min(boxW, stage * 1.6), Math.min(stage, boxW / 1.6)];
	const bezel = phone ? Math.round(w * 0.045) : 0;
	const unit = Math.max(26, Math.round((phone ? w : w * 0.55) * 0.075));
	const screen = figure ? <Picture file={figure} /> : null;
	const app = <AppScreen title={heading ?? url} items={side ? [] : items} frames={frames} size={unit} />;
	const deviceBox = phone ? (
		<div style={{ width: w, height: h, borderRadius: w * 0.14, background: s.dark ? "#0b0b10" : "#1c1c24", padding: bezel, boxShadow: s.shadow, flexShrink: 0 }}>
			<div style={{ position: "relative", width: "100%", height: "100%", borderRadius: w * 0.1, overflow: "hidden", background: s.bg }}>
				{screen ?? app}
				<div style={{ position: "absolute", top: bezel * 0.6, left: "50%", width: w * 0.28, height: bezel * 1.1, marginLeft: -w * 0.14, borderRadius: 99, background: "#0b0b10" }} />
			</div>
		</div>
	) : (
		<div style={{ width: w, height: h, borderRadius: Math.min(18, s.radius), overflow: "hidden", background: s.surface, ...borders(`${Math.max(2, s.line.width)}px ${s.line.style} ${s.surfaceBorder}`), boxShadow: s.shadow, display: "flex", flexDirection: "column", flexShrink: 0 }}>
			<div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 18px", background: s.dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)", borderBottom: `1px solid ${s.surfaceBorder}` }}>
				{["#ff5f57", "#febc2e", "#28c840"].map((c) => (
					<div key={c} style={{ width: 16, height: 16, borderRadius: 99, background: c }} />
				))}
				<div style={{ marginLeft: 14, flex: 1, padding: "6px 16px", borderRadius: 99, background: s.bg, color: s.muted, fontSize: 24, fontFamily: s.monoFont, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{url ?? "example.com"}</div>
			</div>
			<div style={{ flex: 1, minHeight: 0 }}>{screen ?? app}</div>
		</div>
	);
	const list = side ? (
		<div style={{ display: "flex", flexDirection: "column", gap: 22, flex: 1, minWidth: 0 }}>
			{items.map((t, i) => {
				const p = ramp(frame, frames[i]!, frames[i]! + 12);
				return (
					<div key={i} style={{ ...appearStyle(p, 18, s.motion), display: "flex", alignItems: "center", gap: 18, fontSize: vertical ? 38 : 42, lineHeight: 1.25 }}>
						<div style={{ flexShrink: 0, width: 18, height: 18, borderRadius: 99, background: accentAt(s, i) }} />
						{t}
					</div>
				);
			})}
		</div>
	) : null;
	return (
		<SceneFrame heading={heading} center={!heading}>
			<div style={{ ...texture(s), display: "flex", flexDirection: "column", alignItems: "center", gap: 20 }}>
				<div style={{ display: "flex", flexDirection: vertical ? "column" : "row", alignItems: "center", justifyContent: "center", gap: vertical ? 20 : 70, width: "100%" }}>
					<div style={{ opacity: Math.min(1, enter * 1.4), transform: `translateY(${(1 - enter) * 60}px) scale(${0.94 + 0.06 * enter})` }}>{deviceBox}</div>
					{list}
				</div>
				{caption ? <div style={{ ...appearStyle(capP, 12, s.motion), fontSize: 32, color: s.muted, textAlign: "center" }}>{caption}</div> : null}
			</div>
		</SceneFrame>
	);
}

/* ---------- Chat ---------- */

function Typing({ color }: { color: string }) {
	const frame = useCurrentFrame();
	return (
		<div style={{ display: "flex", gap: 8, padding: "20px 24px" }}>
			{[0, 1, 2].map((i) => (
				<div key={i} style={{ width: 14, height: 14, borderRadius: 99, background: color, opacity: 0.35 + 0.65 * Math.abs(Math.sin((frame - i * 5) * 0.25)) }} />
			))}
		</div>
	);
}

export function ChatScene({ heading, title, messages }: PropsOf<"chat">) {
	const s = useStyle();
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	const frames = useRevealFrames(messages.length);
	const { vertical, contentW, stageH } = useLayout();
	const W = vertical ? contentW : Math.min(1200, contentW);
	const H = stageH(heading);
	const size = vertical ? 40 : 38;
	const intro = useAppear(0, { damping: 200 });
	const name = title ?? "Chat";
	return (
		<SceneFrame heading={heading} center={!heading}>
			<div style={{ ...texture(s), ...appearStyle(intro, 24, s.motion), width: W, height: H, margin: "0 auto", display: "flex", flexDirection: "column" }}>
				<Surface style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
					<div style={{ display: "flex", alignItems: "center", gap: 18, padding: "18px 26px", borderBottom: `${Math.max(1, s.line.width)}px ${s.line.style} ${s.surfaceBorder}` }}>
						<div style={{ width: 56, height: 56, borderRadius: 99, background: s.accent2, color: s.onAccent, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 28 }}>{name.slice(0, 1).toUpperCase()}</div>
						<div style={{ fontWeight: 800, fontSize: 34 }}>{name}</div>
					</div>
					{/* Older messages scroll up and fade out at the top, as in a messaging app. */}
					<div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", justifyContent: "flex-end", gap: 16, padding: "20px 26px", overflow: "hidden", maskImage: "linear-gradient(to bottom, transparent 0, black 90px)" }}>
						{messages.map((m, i) => {
							const at = frames[i]!;
							const me = m.from === "me";
							// The other side types for a moment first.
							if (!me && frame >= at - 14 && frame < at) return <div key={i} style={{ alignSelf: "flex-start", background: s.dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)", borderRadius: 26 }}><Typing color={s.muted} /></div>;
							if (frame < at) return null;
							const p = spring({ frame: frame - at, fps, config: { damping: 14, mass: 0.6 } });
							return (
								<div
									key={i}
									style={{
										alignSelf: me ? "flex-end" : "flex-start",
										maxWidth: "78%",
										padding: `${size * 0.42}px ${size * 0.62}px`,
										borderRadius: 26,
										[me ? "borderBottomRightRadius" : "borderBottomLeftRadius"]: 6,
										background: me ? s.accent : s.dark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.06)",
										color: me ? s.onAccent : s.text,
										fontSize: size,
										lineHeight: 1.3,
										opacity: Math.min(1, p * 1.5),
										transform: `scale(${0.85 + 0.15 * p})`,
										transformOrigin: me ? "right bottom" : "left bottom",
									}}
								>
									{m.text}
								</div>
							);
						})}
					</div>
				</Surface>
			</div>
		</SceneFrame>
	);
}

/* ---------- Social post ---------- */

function Icon({ d, color, size }: { d: string; color: string; size: number }) {
	return (
		<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
			<path d={d} />
		</svg>
	);
}
const HEART = "M12 21s-7.5-4.6-9.5-9.2C1 8.3 3.2 5 6.6 5c2 0 3.6 1.1 5.4 3.1C13.8 6.1 15.4 5 17.4 5 20.8 5 23 8.3 21.5 11.8 19.5 16.4 12 21 12 21z";
const SHARE = "M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7M16 6l-4-4-4 4M12 2v14";

export function SocialScene({ author, handle, text, stars, likes, shares }: PropsOf<"social">) {
	const s = useStyle();
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	const { timed } = useScene();
	const { vertical, contentW } = useLayout();
	const card = useAppear(0, { damping: 16 });
	const words = text.split(/\s+/).filter(Boolean);
	// The words appear over most of the narration, so they are read along with the voice.
	const last = timed.sentences.at(-1);
	const end = Math.max(30, Math.min(timed.durationInFrames - 40, (last ? last.from + last.duration : 60) * 0.7));
	const shown = interpolate(frame, [8, end], [0, words.length], clamp);
	const count = interpolate(frame, [end - 10, end + 30], [0, 1], clamp);
	const size = sizeFor(text, vertical ? [52, 44, 38] : [58, 48, 42], [80, 170]);
	const W = vertical ? contentW : Math.min(1300, contentW);
	const initials = author
		.split(/\s+/)
		.slice(0, 2)
		.map((w) => w.slice(0, 1).toUpperCase())
		.join("");
	return (
		<SceneFrame center>
			<div style={{ ...texture(s), width: W, margin: "0 auto", opacity: Math.min(1, card * 1.4), transform: `translateY(${(1 - card) * 50}px)` }}>
				<Surface style={{ padding: vertical ? "40px 40px" : "48px 56px" }}>
					<div style={{ display: "flex", alignItems: "center", gap: 22 }}>
						<div style={{ flexShrink: 0, width: 84, height: 84, borderRadius: 99, background: s.accent, color: s.onAccent, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 34 }}>{initials}</div>
						<div style={{ minWidth: 0 }}>
							<div style={{ fontWeight: 800, fontSize: 40 }}>{author}</div>
							{handle ? <div style={{ fontSize: 30, color: s.muted }}>{handle}</div> : null}
						</div>
					</div>
					{stars ? (
						<div style={{ marginTop: 22, display: "flex", gap: 8 }}>
							{Array.from({ length: 5 }, (_, i) => (
								<svg key={i} width={44} height={44} viewBox="0 0 24 24" style={{ transform: `scale(${spring({ frame: frame - 10 - i * 4, fps, config: { damping: 10 } })})` }}>
									<path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9z" fill={i < stars ? s.accent2 : "none"} stroke={s.accent2} strokeWidth={1.6} />
								</svg>
							))}
						</div>
					) : null}
					<div style={{ marginTop: 26, fontSize: size, lineHeight: 1.35 }}>
						{words.map((w, i) => (
							<span key={i} style={{ opacity: interpolate(shown - i, [0, 1], [0.15, 1], clamp) }}>
								{w}{" "}
							</span>
						))}
					</div>
					{likes !== undefined || shares !== undefined ? (
						<div style={{ marginTop: 30, display: "flex", gap: 46, fontSize: 32, color: s.muted, opacity: count > 0 ? 1 : 0.4 }}>
							{likes !== undefined ? (
								<div style={{ display: "flex", alignItems: "center", gap: 12 }}>
									<Icon d={HEART} color={s.accent} size={38} />
									{compactNumber(likes * count)}
								</div>
							) : null}
							{shares !== undefined ? (
								<div style={{ display: "flex", alignItems: "center", gap: 12 }}>
									<Icon d={SHARE} color={s.accent2} size={36} />
									{compactNumber(shares * count)}
								</div>
							) : null}
						</div>
					) : null}
				</Surface>
			</div>
		</SceneFrame>
	);
}

/* ---------- Call to action ---------- */

export function CtaScene({ headline, action, detail, points }: PropsOf<"cta">) {
	const s = useStyle();
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	const { vertical } = useLayout();
	const frames = useRevealFrames(points.length);
	const head = useAppear(0, { damping: 200 });
	const buttonAt = (points.length ? frames.at(-1)! : 10) + 14;
	const button = spring({ frame: frame - buttonAt, fps, config: { damping: 11, mass: 0.7 } });
	const pulse = frame > buttonAt + 20 ? 1 + 0.03 * Math.sin((frame - buttonAt) * 0.18) : 1;
	const det = useAppear(detail ? buttonAt + 12 : null, { damping: 200 });
	const size = sizeFor(headline, vertical ? [76, 64, 54] : [88, 74, 62]);
	return (
		<SceneFrame center>
			<div style={{ ...texture(s), display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: vertical ? 44 : 40 }}>
				<div style={{ ...appearStyle(head, 24, s.motion), maxWidth: 1500, fontFamily: s.headingFont, fontWeight: s.headingWeight, fontSize: size, lineHeight: 1.12 }}>{headline}</div>
				{points.length ? (
					<div style={{ display: "flex", flexDirection: vertical ? "column" : "row", gap: vertical ? 18 : 44, alignItems: vertical ? "flex-start" : "center" }}>
						{points.map((p, i) => {
							const a = ramp(frame, frames[i]!, frames[i]! + 12);
							return (
								<div key={i} style={{ ...appearStyle(a, 14, s.motion), display: "flex", alignItems: "center", gap: 14, fontSize: vertical ? 38 : 36 }}>
									<svg width={34} height={34} viewBox="0 0 24 24">
										<circle cx={12} cy={12} r={11} fill={s.positive} />
										<path d="M7 12.5l3.2 3.2L17 9" fill="none" stroke={s.onAccent} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
									</svg>
									{p}
								</div>
							);
						})}
					</div>
				) : null}
				<div style={{ opacity: Math.min(1, button * 1.5), transform: `scale(${(0.6 + 0.4 * button) * pulse})` }}>
					<div style={{ display: "inline-flex", alignItems: "center", gap: 20, padding: vertical ? "26px 52px" : "24px 56px", borderRadius: 999, background: s.hand ? "transparent" : s.accent, border: s.hand ? `4px solid ${s.accent}` : "none", color: s.hand ? s.accent : s.onAccent, fontSize: vertical ? 50 : 48, fontWeight: 800, boxShadow: s.shadow }}>
						{action}
						<svg width={40} height={40} viewBox="0 0 24 24">
							<path d="M5 12h13M13 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth={2.8} strokeLinecap="round" strokeLinejoin="round" />
						</svg>
					</div>
				</div>
				{detail ? <div style={{ ...appearStyle(det, 12, s.motion), fontSize: vertical ? 38 : 36, color: s.muted, fontFamily: s.monoFont }}>{detail}</div> : null}
			</div>
		</SceneFrame>
	);
}

/* ---------- Logo outro ---------- */

export function LogoScene({ name, tagline, figure }: PropsOf<"logo">) {
	const s = useStyle();
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	const { vertical } = useLayout();
	const { figureBase } = useScene();
	const mark = spring({ frame: frame - 4, fps, config: { damping: 11, mass: 0.8 } });
	const burst = ramp(frame, 10, 34);
	const letters = [...name];
	const tag = useAppear(tagline ? 14 + letters.length * 2 : null, { damping: 200 });
	const D = vertical ? 260 : 240;
	const size = sizeFor(name, vertical ? [92, 76, 60] : [104, 86, 68], [14, 28]);
	const picture = figure && figureBase ? <Picture file={figure} style={{ objectFit: "contain" }} /> : null;
	return (
		<SceneFrame center>
			<div style={{ ...texture(s), display: "flex", flexDirection: "column", alignItems: "center", gap: 40, textAlign: "center" }}>
				<div style={{ position: "relative", width: D, height: D }}>
					{/* A ring of rays that bursts out once. */}
					<svg width={D * 1.8} height={D * 1.8} viewBox="-90 -90 180 180" style={{ position: "absolute", left: -D * 0.4, top: -D * 0.4, opacity: 1 - burst, overflow: "visible" }}>
						{Array.from({ length: 12 }, (_, i) => {
							const a = (i / 12) * Math.PI * 2;
							const r0 = 52 + 22 * burst;
							const r1 = r0 + 14;
							return <line key={i} x1={Math.cos(a) * r0} y1={Math.sin(a) * r0} x2={Math.cos(a) * r1} y2={Math.sin(a) * r1} stroke={accentAt(s, i)} strokeWidth={4} strokeLinecap="round" />;
						})}
					</svg>
					<div style={{ position: "absolute", inset: 0, borderRadius: picture ? Math.min(28, s.radius) : 999, overflow: "hidden", background: picture ? "transparent" : s.accent, display: "flex", alignItems: "center", justifyContent: "center", transform: `scale(${mark}) rotate(${(1 - mark) * -40}deg)`, boxShadow: picture ? "none" : s.shadow }}>
						{picture ?? <span style={{ color: s.onAccent, fontFamily: s.headingFont, fontWeight: 900, fontSize: D * 0.5, lineHeight: 1 }}>{name.slice(0, 1).toUpperCase()}</span>}
					</div>
				</div>
				<div style={{ fontFamily: s.headingFont, fontWeight: s.headingWeight, fontSize: size, lineHeight: 1.1, letterSpacing: s.hand ? 0 : -1 }}>
					{letters.map((c, i) => {
						const p = ramp(frame, 12 + i * 2, 24 + i * 2);
						return (
							<span key={i} style={{ display: "inline-block", whiteSpace: "pre", opacity: p, transform: `translateY(${(1 - p) * 30}px)` }}>
								{c}
							</span>
						);
					})}
				</div>
				{tagline ? <div style={{ ...appearStyle(tag, 14, s.motion), fontSize: vertical ? 40 : 38, color: s.muted, maxWidth: 1200 }}>{tagline}</div> : null}
			</div>
		</SceneFrame>
	);
}

