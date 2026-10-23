import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { MAP_VIEWS, PropsOf } from "../../../src/shared/plan/schema";
import { outline, texture } from "../styles/styles";
import { Character } from "./characters";
import { accentAt, appearStyle, borders, ease, ramp, SceneFrame, Surface, useAppear, useLayout, useRevealFrames, useScene, useStyle } from "./kit";
import { WORLD_LAND, WORLD_SCALE } from "./world-land";

/* Timeline, map with pins, analogy split-screen and character dialogue. */

export function TimelineScene({ heading, events }: PropsOf<"timeline">) {
	const s = useStyle();
	const frame = useCurrentFrame();
	const frames = useRevealFrames(events.length);
	const { vertical, contentW: W, stageH } = useLayout();
	const H = stageH(heading);
	const n = events.length;
	// Along the width in a wide frame; down the left side, cards to the right, in a tall frame.
	const margin = vertical ? Math.min(90, H / n / 2) : 110;
	const spacing = ((vertical ? H : W) - 2 * margin) / (n - 1);
	const xAt = (k: number) => margin + k * spacing;
	const y = H / 2;
	const cardW = Math.min(400, spacing * 1.8);
	// The line grows to each event as it is revealed.
	let reach = 0;
	frames.forEach((f, k) => {
		if (k === 0) return;
		reach += ease(ramp(frame, f - 12, f));
	});
	const lineEnd = margin + reach * spacing;
	const start = useAppear(0, { damping: 200 });
	if (vertical) {
		const lx = 40;
		return (
			<SceneFrame heading={heading} center={!heading}>
				<div style={{ ...texture(s), position: "relative", width: W, height: H }}>
					<svg width={W} height={H} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
						<line x1={lx} x2={lx} y1={20} y2={H - 20} stroke={s.surfaceBorder} strokeWidth={6} strokeLinecap="round" strokeDasharray={s.line.style === "dashed" ? "16 12" : undefined} opacity={start} />
						<line x1={lx} x2={lx} y1={margin} y2={lineEnd} stroke={s.accent} strokeWidth={8} strokeLinecap="round" />
					</svg>
					{events.map((e, k) => (
						<TimelineEvent key={k} index={k} at={frames[k]!} x={lx} y={xAt(k)} cardW={W - lx - 60} up={false} side date={e.date} label={e.label} detail={e.detail} />
					))}
				</div>
			</SceneFrame>
		);
	}
	return (
		<SceneFrame heading={heading} center={!heading}>
			<div style={{ ...texture(s), position: "relative", width: W, height: H }}>
				<svg width={W} height={H} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
					<line x1={20} x2={W - 20} y1={y} y2={y} stroke={s.surfaceBorder} strokeWidth={6} strokeLinecap="round" strokeDasharray={s.line.style === "dashed" ? "16 12" : undefined} opacity={start} />
					<line x1={margin} x2={lineEnd} y1={y} y2={y} stroke={s.accent} strokeWidth={8} strokeLinecap="round" />
				</svg>
				{events.map((e, k) => (
					<TimelineEvent key={k} index={k} at={frames[k]!} x={xAt(k)} y={y} cardW={cardW} up={k % 2 === 0} date={e.date} label={e.label} detail={e.detail} />
				))}
			</div>
		</SceneFrame>
	);
}

function TimelineEvent({ index, at, x, y, cardW, up, side, date, label, detail }: { index: number; at: number; x: number; y: number; cardW: number; up: boolean; side?: boolean; date: string; label: string; detail?: string }) {
	const s = useStyle();
	const p = useAppear(at, { damping: 14 });
	const color = accentAt(s, index);
	const dot = <div style={{ position: "absolute", left: x - 20, top: y - 20, width: 40, height: 40, borderRadius: 99, background: s.hand ? s.bg : color, ...borders(`${Math.max(4, s.line.width + 2)}px solid ${s.hand ? color : s.bg}`), transform: `scale(${p})`, boxShadow: s.hand ? "none" : `0 0 0 4px ${color}` }} />;
	if (side)
		// Tall frames: the card sits to the right of its dot.
		return (
			<>
				{dot}
				<div style={{ position: "absolute", left: x + 60, top: y, width: cardW, transform: `translate(${(1 - p) * -20}px, -50%)`, opacity: p }}>
					<div style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", columnGap: 20 }}>
						<div style={{ fontFamily: s.headingFont, fontSize: 44, fontWeight: 800, color }}>{date}</div>
						<div style={{ fontSize: 36, fontWeight: 700, lineHeight: 1.2 }}>{label}</div>
					</div>
					{detail ? <div style={{ fontSize: 30, color: s.muted, lineHeight: 1.3, marginTop: 6 }}>{detail}</div> : null}
				</div>
			</>
		);
	return (
		<>
			{dot}
			<div style={{ position: "absolute", left: x - 2, top: up ? y - 70 : y + 22, width: 4, height: 48 * p, background: color, opacity: 0.7 }} />
			<div style={{ position: "absolute", left: x - cardW / 2, width: cardW, top: up ? undefined : y + 72, bottom: up ? `calc(100% - ${y - 72}px)` : undefined, opacity: p, transform: `translateY(${(1 - p) * (up ? 20 : -20)}px)`, textAlign: "center" }}>
				<div style={{ fontFamily: s.headingFont, fontSize: 40, fontWeight: 800, color, marginBottom: 6 }}>{date}</div>
				<div style={{ fontSize: 31, fontWeight: 700, lineHeight: 1.2 }}>{label}</div>
				{detail ? <div style={{ fontSize: 24, color: s.muted, lineHeight: 1.3, marginTop: 6 }}>{detail}</div> : null}
			</div>
		</>
	);
}

/** Region boxes as [west, east, north, south] in degrees. */
const VIEWS: Record<(typeof MAP_VIEWS)[number], [number, number, number, number]> = {
	world: [-180, 180, 84, -58],
	europe: [-25, 45, 72, 34],
	asia: [25, 150, 60, -10],
	africa: [-20, 55, 38, -36],
	"north-america": [-170, -50, 75, 7],
	"south-america": [-85, -30, 14, -56],
	oceania: [105, 180, 5, -50],
	"middle-east": [25, 65, 43, 10],
	"south-asia": [60, 100, 37, 5],
};

const mx = (lon: number) => (lon + 180) * WORLD_SCALE;
const my = (lat: number) => (90 - lat) * WORLD_SCALE;

/** The map box (in map units) for a view, grown to show every pin and to fill the stage shape. */
/** The view's region grown to show every pin, in degrees: [west, east, north, south]. */
function regionOf(view: (typeof MAP_VIEWS)[number], pins: { lat: number; lon: number }[]): [number, number, number, number] {
	let [w, e, n, so] = VIEWS[view];
	for (const p of pins) {
		w = Math.min(w, p.lon - 6);
		e = Math.max(e, p.lon + 6);
		n = Math.max(n, p.lat + 5);
		so = Math.min(so, p.lat - 5);
	}
	return [Math.max(-180, w), Math.min(180, e), Math.min(85, n), Math.max(-85, so)];
}

/** Width ÷ height of the region on the map, before it is fitted to the stage. */
export function regionAspect(view: (typeof MAP_VIEWS)[number], pins: { lat: number; lon: number }[]): number {
	const [w, e, n, so] = regionOf(view, pins);
	return (mx(e) - mx(w)) / (my(so) - my(n));
}

export function mapBox(view: (typeof MAP_VIEWS)[number], pins: { lat: number; lon: number }[], aspect: number) {
	const [w, e, n, so] = regionOf(view, pins);
	let x = mx(w);
	let y = my(n);
	let bw = mx(e) - x;
	let bh = my(so) - y;
	if (bw / bh > aspect) {
		const nh = bw / aspect;
		y -= (nh - bh) / 2;
		bh = nh;
	} else {
		const nw = bh * aspect;
		x -= (nw - bw) / 2;
		bw = nw;
	}
	return { x, y, w: bw, h: bh };
}

export function MapScene({ heading, view, pins, route }: PropsOf<"map">) {
	const s = useStyle();
	const frame = useCurrentFrame();
	const frames = useRevealFrames(pins.length);
	const { vertical, contentW: W, stageH } = useLayout();
	// Tall frames: the map keeps the shape of its region (a world map stays wide), not the full height, which would be mostly sea.
	const natural = regionAspect(view, pins);
	const H = vertical ? Math.min(stageH(heading), Math.round(W / Math.max(0.8, Math.min(2, natural)))) : stageH(heading);
	const box = mapBox(view, pins, W / H);
	const sx = (lon: number) => ((mx(lon) - box.x) / box.w) * W;
	const sy = (lat: number) => ((my(lat) - box.y) / box.h) * H;
	const intro = useAppear(0, { damping: 200 });
	const ocean = s.dark ? "rgba(255,255,255,0.035)" : `${s.accent3}14`;
	const land = s.dark ? "rgba(255,255,255,0.13)" : s.hand ? "rgba(0,0,0,0.04)" : s.surface;
	const grat: string[] = [];
	for (let lon = -180; lon <= 180; lon += 30) grat.push(`M ${mx(lon)} ${my(85)} V ${my(-85)}`);
	for (let lat = -60; lat <= 60; lat += 30) grat.push(`M ${mx(-180)} ${my(lat)} H ${mx(180)}`);
	return (
		<SceneFrame heading={heading} center={!heading}>
			<div style={{ position: "relative", width: W, height: H, borderRadius: s.radius, overflow: "hidden", background: ocean, ...borders(outline(s)), boxShadow: s.shadow, opacity: intro }}>
				<svg width={W} height={H} viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`} preserveAspectRatio="none" style={{ position: "absolute", inset: 0, ...texture(s) }}>
					<path d={grat.join(" ")} fill="none" stroke={s.surfaceBorder} strokeWidth={1} opacity={0.5} vectorEffect="non-scaling-stroke" />
					<path d={WORLD_LAND} fill={land} stroke={s.dark ? s.surfaceBorder : s.muted} strokeWidth={s.hand ? 2.2 : 1.4} strokeLinejoin="round" vectorEffect="non-scaling-stroke" fillRule="evenodd" />
				</svg>
				{route && pins.length > 1 ? (
					<svg width={W} height={H} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
						{pins.slice(1).map((p, i) => {
							const a = pins[i]!;
							const x0 = sx(a.lon);
							const y0 = sy(a.lat);
							const x1 = sx(p.lon);
							const y1 = sy(p.lat);
							const lift = Math.min(160, Math.hypot(x1 - x0, y1 - y0) * 0.3);
							const draw = ease(ramp(frame, frames[i + 1]! - 16, frames[i + 1]!));
							return <path key={i} d={`M ${x0} ${y0} Q ${(x0 + x1) / 2} ${(y0 + y1) / 2 - lift} ${x1} ${y1}`} fill="none" stroke={s.accent2} strokeWidth={5} strokeLinecap="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - draw} />;
						})}
					</svg>
				) : null}
				{pins.map((p, k) => (
					<MapPin key={k} index={k} at={frames[k]!} x={sx(p.lon)} y={sy(p.lat)} label={p.label} detail={p.detail} flip={sx(p.lon) > W - (vertical ? 300 : 380)} />
				))}
			</div>
		</SceneFrame>
	);
}

function MapPin({ index, at, x, y, label, detail, flip }: { index: number; at: number; x: number; y: number; label: string; detail?: string; flip: boolean }) {
	const s = useStyle();
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	const drop = spring({ frame: frame - at, fps, config: { damping: 9, mass: 0.6 } });
	const shown = frame >= at;
	const ring = ((frame - at) % 50) / 50;
	const color = accentAt(s, index);
	const card = useAppear(at + 8, { damping: 200 });
	if (!shown) return null;
	return (
		<>
			<div style={{ position: "absolute", left: x - 30, top: y - 30, width: 60, height: 60, borderRadius: 99, border: `3px solid ${color}`, opacity: (1 - ring) * 0.8, transform: `scale(${0.3 + ring})` }} />
			<svg width={44} height={60} style={{ position: "absolute", left: x - 22, top: y - 58 - (1 - drop) * 90, overflow: "visible", opacity: Math.min(1, drop * 2) }}>
				<path d="M22 58 C 22 58 2 34 2 22 A 20 20 0 1 1 42 22 C 42 34 22 58 22 58 Z" fill={color} stroke={s.dark ? s.bg : "#ffffff"} strokeWidth={3} />
				<circle cx={22} cy={22} r={7} fill={s.dark ? s.bg : "#ffffff"} />
			</svg>
			<div style={{ position: "absolute", top: y - 44, left: flip ? undefined : x + 30, right: flip ? `calc(100% - ${x - 30}px)` : undefined, opacity: card, transform: `translateX(${(1 - card) * (flip ? 16 : -16)}px)` }}>
				<div style={{ background: s.surface, ...borders(outline(s, color)), borderRadius: Math.min(14, s.radius), padding: "10px 18px", boxShadow: s.shadow, whiteSpace: "nowrap" }}>
					<div style={{ fontSize: 30, fontWeight: 800, color: s.text }}>{label}</div>
					{detail ? <div style={{ fontSize: 22, color: s.muted, maxWidth: 360, whiteSpace: "normal", lineHeight: 1.25 }}>{detail}</div> : null}
				</div>
			</div>
		</>
	);
}

export function AnalogyScene({ heading, idea, like, pairs, limit }: PropsOf<"analogy">) {
	const s = useStyle();
	const frames = useRevealFrames(pairs.length + (limit ? 1 : 0));
	const top = useAppear(0, { damping: 200 });
	const link = useAppear(10, { damping: 12 });
	const limitP = useAppear(limit ? frames[pairs.length]! : null, { damping: 200 });
	const size = pairs.length > 3 ? 32 : 38;
	const { vertical } = useLayout();
	// Tall frames: a narrower link column, so each side keeps room for its words.
	const cols = vertical ? "1fr 110px 1fr" : "1fr 180px 1fr";
	return (
		<SceneFrame heading={heading}>
			<div style={{ ...texture(s), display: "flex", flexDirection: "column", gap: pairs.length > 3 ? 16 : 24 }}>
				<div style={{ ...appearStyle(top, 16), display: "grid", gridTemplateColumns: cols, alignItems: "center", marginBottom: 10 }}>
					<div style={{ fontFamily: s.headingFont, fontSize: vertical ? 44 : 54, fontWeight: 800, color: s.accent, textAlign: "center" }}>{idea}</div>
					<div style={{ textAlign: "center", transform: `scale(${link})` }}>
						<span style={{ display: "inline-block", padding: vertical ? "8px 14px" : "10px 22px", borderRadius: 999, whiteSpace: "nowrap", fontSize: vertical ? 22 : 26, background: s.hand ? "transparent" : s.text, color: s.hand ? s.text : s.bg, border: s.hand ? `3px ${s.line.style} ${s.text}` : "none", fontWeight: 800, letterSpacing: 1.5, textTransform: "uppercase" }}>is like</span>
					</div>
					<div style={{ fontFamily: s.headingFont, fontSize: vertical ? 44 : 54, fontWeight: 800, color: s.accent2, textAlign: "center" }}>{like}</div>
				</div>
				{pairs.map((p, i) => (
					<AnalogyPair key={i} at={frames[i]!} idea={p.idea} like={p.like} size={size} link={vertical ? 110 : 180} />
				))}
				{limit ? (
					<div style={{ ...appearStyle(limitP, 16), marginTop: 12, display: "flex", flexDirection: vertical ? "column" : "row", gap: vertical ? 6 : 20, alignItems: "baseline", fontSize: 34, lineHeight: 1.35, padding: "18px 28px", borderRadius: Math.min(16, s.radius), background: s.hand ? "transparent" : `${s.accent3}18`, ...borders(`${s.line.width}px ${s.line.style} ${s.accent3}`) }}>
						<span style={{ color: s.accent3, fontWeight: 800, whiteSpace: "nowrap" }}>Where it breaks:</span>
						<span>{limit}</span>
					</div>
				) : null}
			</div>
		</SceneFrame>
	);
}

function AnalogyPair({ at, idea, like, size, link }: { at: number; idea: string; like: string; size: number; link: number }) {
	const s = useStyle();
	const frame = useCurrentFrame();
	const p = useAppear(at);
	const draw = ramp(frame, at + 4, at + 16);
	return (
		<div style={{ ...appearStyle(p, 20), display: "grid", gridTemplateColumns: `1fr ${link}px 1fr`, alignItems: "center" }}>
			<Surface edge={{ side: "left", color: s.accent }} style={{ padding: "20px 28px", fontSize: size, lineHeight: 1.3 }}>
				{idea}
			</Surface>
			<svg width={link} height={40} style={{ overflow: "visible" }}>
				<path d={`M 20 20 H ${link - 20}`} stroke={s.muted} strokeWidth={4} strokeDasharray="8 8" strokeLinecap="round" opacity={draw} />
				<path d={`M 34 8 L 20 20 L 34 32 M ${link - 34} 8 L ${link - 20} 20 L ${link - 34} 32`} fill="none" stroke={s.muted} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" opacity={draw} />
			</svg>
			<Surface edge={{ side: "left", color: s.accent2 }} style={{ padding: "20px 28px", fontSize: size, lineHeight: 1.3 }}>
				{like}
			</Surface>
		</div>
	);
}

export function DialogueScene({ setting, characters, lines }: PropsOf<"dialogue">) {
	const s = useStyle();
	const frame = useCurrentFrame();
	const { timed } = useScene();
	const frames = useRevealFrames(lines.length);
	const { vertical, contentW, stageH } = useLayout();
	const H = stageH();
	const k = frames.filter((f) => f <= frame).length - 1;
	// The speaker of the newest line talks until that sentence ends (or the next line starts).
	const startAt = k >= 0 ? frames[k]! : -1;
	const sentence = timed.sentences.find((x) => startAt >= x.from && startAt < x.from + x.duration);
	const talkEnd = Math.min(k + 1 < frames.length ? frames[k + 1]! : Infinity, sentence ? sentence.from + sentence.duration : startAt + 45);
	const talking = k >= 0 && frame < talkEnd ? lines[k]!.who : -1;
	const two = characters.length === 2;
	const intro = useAppear(0, { damping: 200 });
	const charW = 300;
	return (
		<SceneFrame center>
			<div style={{ position: "relative", width: contentW, height: H }}>
				{setting ? (
					<div style={{ ...appearStyle(intro, 10), position: "absolute", left: 0, right: 0, top: 0, textAlign: "center", fontSize: 30, color: s.muted, letterSpacing: s.hand ? 0 : 2, textTransform: "uppercase" }}>{setting}</div>
				) : null}
				{characters.map((c, i) => {
					const mouth = talking === i ? Math.abs(Math.sin(frame * 0.75)) : 0;
					const bounce = talking === i ? Math.abs(Math.sin(frame * 0.37)) * 8 : 0;
					const blink = (frame + i * 37) % 110 < 4;
					const right = two && i === 1;
					return (
						<div key={i} style={{ position: "absolute", bottom: 0, left: right ? undefined : 20, right: right ? 20 : undefined, width: charW, textAlign: "center", opacity: intro, transform: `translateY(${(1 - intro) * 40 - bounce}px)` }}>
							<svg width={charW} height={charW * 1.5} viewBox="0 0 200 300" style={{ transform: right ? "scaleX(-1)" : undefined, overflow: "visible" }}>
								<Character look={c.look} mouth={mouth} blink={blink} />
							</svg>
							<div style={{ marginTop: 10, fontSize: 32, fontWeight: 800, color: accentAt(s, i) }}>{c.name}</div>
						</div>
					);
				})}
				<div
					style={{
						...texture(s),
						position: "absolute",
						// Tall frames: the characters stand at the bottom and the talk fills the space above them.
						left: vertical ? 0 : charW + 70,
						right: vertical ? 0 : two ? charW + 70 : 40,
						top: setting ? 70 : 20,
						bottom: vertical ? charW * 1.5 + 90 : 40,
						display: "flex",
						flexDirection: "column",
						justifyContent: "flex-end",
						gap: 22,
						overflow: "hidden",
						maskImage: "linear-gradient(to bottom, transparent 0, black 120px)",
					}}
				>
					{lines.map((l, i) => (i <= k ? <Bubble key={i} at={frames[i]!} text={l.text} right={two && l.who === 1} color={accentAt(s, l.who)} newest={i === k} /> : null))}
				</div>
			</div>
		</SceneFrame>
	);
}

function Bubble({ at, text, right, color, newest }: { at: number; text: string; right: boolean; color: string; newest: boolean }) {
	const s = useStyle();
	const p = useAppear(at, { damping: 15 });
	const tail = right ? { right: -14 } : { left: -14 };
	return (
		<div style={{ alignSelf: right ? "flex-end" : "flex-start", maxWidth: "82%", position: "relative", opacity: interpolate(p, [0, 1], [0, newest ? 1 : 0.6]), transform: `scale(${0.85 + 0.15 * p})`, transformOrigin: right ? "bottom right" : "bottom left" }}>
			<div style={{ background: s.surface, ...borders(`${Math.max(3, s.line.width)}px ${s.line.style} ${color}`), borderRadius: 30, padding: "22px 32px", fontSize: 38, lineHeight: 1.3, boxShadow: s.shadow }}>{text}</div>
			<div style={{ position: "absolute", bottom: 18, width: 28, height: 28, background: s.surface, borderBottom: `${Math.max(3, s.line.width)}px ${s.line.style} ${color}`, [right ? "borderRight" : "borderLeft"]: `${Math.max(3, s.line.width)}px ${s.line.style} ${color}`, transform: `rotate(${right ? -45 : 45}deg)`, ...tail }} />
		</div>
	);
}
