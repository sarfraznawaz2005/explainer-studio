import { interpolate, useCurrentFrame } from "remotion";
import type { PropsOf } from "../../../src/shared/plan/schema";
import { outline, texture, type VisualStyle } from "../styles/styles";
import { accentAt, appearStyle, borders, ramp, SceneFrame, Surface, useAppear, useLayout, useRevealFrames, useStyle } from "./kit";

/* Cycle, hierarchy tree, mind map, Venn diagram, pros and cons. */

const rad = (deg: number) => (deg * Math.PI) / 180;

/** A small arrowhead at (x, y) pointing along `angle` (radians). */
function ArrowHead({ x, y, angle, color, size = 16, opacity = 1 }: { x: number; y: number; angle: number; color: string; size?: number; opacity?: number }) {
	const deg = (angle * 180) / Math.PI;
	return <path d={`M ${-size} ${-size * 0.65} L 0 0 L ${-size} ${size * 0.65}`} transform={`translate(${x} ${y}) rotate(${deg})`} fill="none" stroke={color} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" opacity={opacity} />;
}

/** A node card centred on a point. */
function NodeCard({ x, y, w, p, color, label, detail, size = 34, round }: { x: number; y: number; w: number; p: number; color: string; label: string; detail?: string; size?: number; round?: boolean }) {
	const s = useStyle();
	return (
		<div style={{ position: "absolute", left: x - w / 2, top: y, width: w, transform: `translateY(-50%) scale(${0.7 + 0.3 * p})`, opacity: p }}>
			<Surface edge={{ side: "top", color }} style={{ padding: "18px 20px", textAlign: "center", borderRadius: round ? 999 : s.radius }}>
				<div style={{ fontSize: size, fontWeight: 700, lineHeight: 1.15 }}>{label}</div>
				{detail ? <div style={{ fontSize: size * 0.7, color: s.muted, lineHeight: 1.3, marginTop: 8 }}>{detail}</div> : null}
			</Surface>
		</div>
	);
}

export function CycleScene({ heading, center, steps }: PropsOf<"cycle">) {
	const s = useStyle();
	const frame = useCurrentFrame();
	const n = steps.length;
	const { vertical, contentW: W, stageH } = useLayout();
	const H = stageH(heading);
	const frames = useRevealFrames(n);
	const cx = W / 2;
	const cy = H / 2;
	const cardW = vertical ? (n > 6 ? 230 : 270) : n > 6 ? 250 : 290;
	// A wide ellipse in a wide frame; a tall one in a tall frame, with the cards kept inside the width.
	const R = vertical ? Math.min(H / 2 - 110, 560) : Math.min(H / 2 - 95, 340);
	const Rx = vertical ? W / 2 - cardW / 2 - 10 : R * 1.55;
	const pos = (k: number) => {
		const a = rad(-90 + (k * 360) / n);
		return { x: cx + Math.cos(a) * Rx, y: cy + Math.sin(a) * R, a };
	};
	const ring = useAppear(0, { damping: 200 });
	const closeAt = frames[n - 1]! + 15;
	// Arcs between neighbours on the ellipse, trimmed so they stop short of the cards.
	const arc = (k: number) => {
		const a0 = rad(-90 + (k * 360) / n) + 0.32;
		const a1 = rad(-90 + ((k + 1) * 360) / n) - 0.32;
		const pts = Array.from({ length: 24 }, (_, i) => {
			const a = a0 + ((a1 - a0) * i) / 23;
			return [cx + Math.cos(a) * Rx, cy + Math.sin(a) * R] as const;
		});
		const end = pts[23]!;
		const prev = pts[22]!;
		return { d: pts.map((p, i) => `${i ? "L" : "M"} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" "), end, angle: Math.atan2(end[1] - prev[1], end[0] - prev[0]) };
	};
	return (
		<SceneFrame heading={heading} center={!heading}>
			<div style={{ ...texture(s), position: "relative", width: W, height: H }}>
				<svg width={W} height={H} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
					<ellipse cx={cx} cy={cy} rx={Rx * 0.55} ry={R * 0.55} fill="none" stroke={s.surfaceBorder} strokeWidth={2} strokeDasharray="4 14" opacity={ring} transform={`rotate(${frame / 6} ${cx} ${cy})`} />
					{steps.map((_, k) => {
						const { d, end, angle } = arc(k);
						const from = k === n - 1 ? closeAt : frames[k + 1]! - 12;
						const draw = ramp(frame, from, from + 14);
						return (
							<g key={k}>
								<path d={d} fill="none" stroke={s.muted} strokeWidth={5} strokeLinecap="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - draw} />
								<ArrowHead x={end[0]} y={end[1]} angle={angle} color={s.muted} opacity={draw > 0.95 ? 1 : 0} />
							</g>
						);
					})}
				</svg>
				{center ? (
					<div style={{ position: "absolute", left: cx - 180, top: cy, width: 360, transform: "translateY(-50%)", textAlign: "center", fontFamily: s.headingFont, fontSize: vertical ? 40 : 44, fontWeight: 800, color: s.accent, opacity: ring }}>{center}</div>
				) : null}
				{steps.map((st, k) => {
					const p = pos(k);
					return <CycleNode key={k} x={p.x} y={p.y} w={cardW} at={frames[k]!} color={accentAt(s, k)} label={st.label} detail={st.detail} />;
				})}
			</div>
		</SceneFrame>
	);
}

function CycleNode({ at, ...rest }: { x: number; y: number; w: number; at: number; color: string; label: string; detail?: string }) {
	const p = useAppear(at, { damping: 14 });
	return <NodeCard {...rest} p={p} size={32} />;
}

/** Tidy tree layout: leaves spread evenly, parents centred over their children. */
export function treeLayout(nodes: { parent?: number }[]) {
	const kids = nodes.map(() => [] as number[]);
	nodes.forEach((n, i) => {
		if (i > 0 && n.parent !== undefined) kids[n.parent]!.push(i);
	});
	const depth = nodes.map(() => 0);
	nodes.forEach((n, i) => {
		if (i > 0 && n.parent !== undefined) depth[i] = depth[n.parent]! + 1;
	});
	const x = nodes.map(() => 0);
	let leaf = 0;
	const place = (i: number) => {
		if (!kids[i]!.length) x[i] = leaf++;
		else {
			kids[i]!.forEach(place);
			x[i] = (x[kids[i]![0]!]! + x[kids[i]!.at(-1)!]!) / 2;
		}
	};
	place(0);
	// Depth-first order, for the indented (tall frame) layout.
	const order: number[] = [];
	const walk = (i: number) => {
		order.push(i);
		kids[i]!.forEach(walk);
	};
	walk(0);
	return { x, depth, leaves: Math.max(1, leaf), levels: Math.max(...depth) + 1, order };
}

export function TreeScene({ heading, nodes }: PropsOf<"tree">) {
	const s = useStyle();
	const frame = useCurrentFrame();
	const { vertical, contentW: W, stageH } = useLayout();
	const frames = useRevealFrames(nodes.length);
	const { x, depth, leaves, levels, order } = treeLayout(nodes);
	if (vertical) return <OutlineTree heading={heading} nodes={nodes} depth={depth} order={order} frames={frames} W={W} H={stageH(heading)} />;
	const H = stageH(heading);
	const perLevel = Math.max(...Array.from({ length: levels }, (_, d) => depth.filter((v) => v === d).length));
	const boxW = Math.min(300, W / Math.max(leaves, perLevel) - 24);
	const boxH = 92;
	const px = (i: number) => ((x[i]! + 0.5) / leaves) * W;
	const py = (i: number) => (levels === 1 ? H / 2 : boxH / 2 + 10 + (depth[i]! * (H - boxH - 20)) / (levels - 1));
	const size = boxW < 180 ? 26 : boxW < 240 ? 30 : 34;
	return (
		<SceneFrame heading={heading} center={!heading}>
			<div style={{ ...texture(s), position: "relative", width: W, height: H }}>
				<svg width={W} height={H} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
					{nodes.map((n, i) => {
						if (i === 0 || n.parent === undefined) return null;
						const draw = ramp(frame, frames[i]! - 10, frames[i]! + 4);
						const x0 = px(n.parent);
						const y0 = py(n.parent) + boxH / 2;
						const x1 = px(i);
						const y1 = py(i) - boxH / 2;
						const mid = (y0 + y1) / 2;
						return <path key={i} d={`M ${x0} ${y0} V ${mid} H ${x1} V ${y1}`} fill="none" stroke={s.muted} strokeWidth={4} strokeLinejoin="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - draw} />;
					})}
				</svg>
				{nodes.map((n, i) => (
					<TreeNode key={i} x={px(i)} y={py(i)} w={boxW} at={frames[i]!} color={depth[i] === 0 ? s.accent : accentAt(s, depth[i]!)} label={n.label} size={depth[i] === 0 ? size + 4 : size} root={i === 0} />
				))}
			</div>
		</SceneFrame>
	);
}

/**
 * Tall frames: the tree as an indented outline, one node per row, each child
 * joined to its parent by an elbow line. Wide trees no longer need the width.
 */
function OutlineTree({ heading, nodes, depth, order, frames, W, H }: { heading?: string; nodes: PropsOf<"tree">["nodes"]; depth: number[]; order: number[]; frames: number[]; W: number; H: number }) {
	const s = useStyle();
	const frame = useCurrentFrame();
	const rows = order.length;
	const boxH = Math.min(104, Math.floor(H / rows) - 18);
	const rowH = Math.min(boxH + 34, H / rows);
	const indent = Math.min(110, (W - 420) / Math.max(1, Math.max(...depth)));
	const row = new Map(order.map((n, r) => [n, r]));
	const top = (H - rows * rowH) / 2;
	const cy = (i: number) => top + row.get(i)! * rowH + rowH / 2;
	const left = (i: number) => depth[i]! * indent;
	const size = boxH < 70 ? 28 : 34;
	return (
		<SceneFrame heading={heading} center={!heading}>
			<div style={{ ...texture(s), position: "relative", width: W, height: H }}>
				<svg width={W} height={H} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
					{nodes.map((n, i) => {
						if (i === 0 || n.parent === undefined) return null;
						const draw = ramp(frame, frames[i]! - 10, frames[i]! + 4);
						const x0 = left(n.parent) + 36;
						return <path key={i} d={`M ${x0} ${cy(n.parent) + boxH / 2} V ${cy(i)} H ${left(i)}`} fill="none" stroke={s.muted} strokeWidth={4} strokeLinejoin="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - draw} />;
					})}
				</svg>
				{nodes.map((n, i) => (
					<TreeNode
						key={i}
						x={left(i) + (W - left(i)) / 2}
						y={cy(i)}
						w={W - left(i)}
						h={boxH}
						at={frames[i]!}
						color={depth[i] === 0 ? s.accent : accentAt(s, depth[i]!)}
						label={n.label}
						size={depth[i] === 0 ? size + 4 : size}
						root={i === 0}
						align="left"
					/>
				))}
			</div>
		</SceneFrame>
	);
}

function TreeNode({ x, y, w, h = 92, at, color, label, size, root, align = "center" }: { x: number; y: number; w: number; h?: number; at: number; color: string; label: string; size: number; root: boolean; align?: "center" | "left" }) {
	const s = useStyle();
	const p = useAppear(at, { damping: 15 });
	return (
		<div style={{ position: "absolute", left: x - w / 2, top: y, width: w, height: h, transform: `translateY(-50%) scale(${0.7 + 0.3 * p})`, opacity: p, display: "flex" }}>
			<div
				style={{
					flex: 1,
					display: "flex",
					alignItems: "center",
					justifyContent: align === "left" ? "flex-start" : "center",
					textAlign: align,
					padding: align === "left" ? "0 28px" : "0 14px",
					borderRadius: s.radius,
					background: root && !s.hand ? color : s.surface,
					color: root && !s.hand ? s.onAccent : s.text,
					...borders(outline(s, root ? color : s.surfaceBorder), `${Math.max(5, s.line.width * 2)}px solid ${color}`),
					boxShadow: s.shadow,
					fontSize: size,
					fontWeight: 700,
					lineHeight: 1.12,
				}}
			>
				{label}
			</div>
		</div>
	);
}

export function MindmapScene({ center, branches }: PropsOf<"mindmap">) {
	const s = useStyle();
	const frame = useCurrentFrame();
	const { vertical, contentW: W, stageH } = useLayout();
	const H = stageH();
	const frames = useRevealFrames(branches.length);
	const cx = W / 2;
	const cy = H / 2;
	// Branch and leaf distances: wide in a wide frame, tall in a tall one.
	const [bX, bY, lX, lY] = vertical ? [W / 2 - 170, H * 0.3, 160, 210] : [470, 255, 250, 150];
	const n = branches.length;
	const core = useAppear(0, { damping: 13 });
	const angle = (k: number) => rad(-90 + (k * 360) / n + (n % 2 ? 0 : 180 / n));
	const clampX = (v: number, w: number) => Math.min(W - w / 2, Math.max(w / 2, v));
	const clampY = (v: number) => Math.min(H - 40, Math.max(40, v));
	return (
		<SceneFrame center>
			<div style={{ ...texture(s), position: "relative", width: W, height: H }}>
				<svg width={W} height={H} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
					{branches.map((b, k) => {
						const a = angle(k);
						const bx = cx + Math.cos(a) * bX;
						const by = cy + Math.sin(a) * bY;
						const draw = ramp(frame, frames[k]! - 12, frames[k]! + 2);
						const color = accentAt(s, k);
						const ctrl = { x: cx + Math.cos(a - 0.35) * bX * 0.53, y: cy + Math.sin(a - 0.35) * bY * 0.55 };
						return (
							<g key={k}>
								<path d={`M ${cx} ${cy} Q ${ctrl.x} ${ctrl.y} ${bx} ${by}`} fill="none" stroke={color} strokeWidth={s.hand ? 6 : 9} strokeLinecap="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - draw} />
								{b.children.map((_, j) => {
									const spread = (j - (b.children.length - 1) / 2) * 0.32;
									const ca = a + spread;
									const tx = clampX(bx + Math.cos(ca) * lX, 220);
									const ty = clampY(by + Math.sin(ca) * lY);
									const d2 = ramp(frame, frames[k]! + 6 + j * 4, frames[k]! + 18 + j * 4);
									return <path key={j} d={`M ${bx} ${by} L ${tx} ${ty}`} stroke={color} strokeWidth={3} strokeLinecap="round" opacity={0.7} pathLength={1} strokeDasharray={1} strokeDashoffset={1 - d2} />;
								})}
							</g>
						);
					})}
				</svg>
				{branches.map((b, k) => {
					const a = angle(k);
					const bx = cx + Math.cos(a) * bX;
					const by = cy + Math.sin(a) * bY;
					const color = accentAt(s, k);
					return (
						<MindBranch key={k} at={frames[k]!} color={color} x={clampX(bx, 300)} y={by} label={b.label}>
							{b.children.map((c, j) => {
								const spread = (j - (b.children.length - 1) / 2) * 0.32;
								const ca = a + spread;
								return <MindLeaf key={j} at={frames[k]! + 12 + j * 4} color={color} x={clampX(bx + Math.cos(ca) * lX, 220)} y={clampY(by + Math.sin(ca) * lY)} label={c} />;
							})}
						</MindBranch>
					);
				})}
				<div
					style={{
						position: "absolute",
						left: cx - (vertical ? 170 : 190),
						top: cy,
						width: vertical ? 340 : 380,
						minHeight: 150,
						transform: `translateY(-50%) scale(${core})`,
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						textAlign: "center",
						padding: "26px 30px",
						borderRadius: 999,
						background: s.hand ? s.bg : s.accent,
						color: s.hand ? s.accent : s.onAccent,
						border: s.hand ? `${s.line.width + 2}px ${s.line.style} ${s.accent}` : "none",
						boxShadow: s.shadow,
						fontFamily: s.headingFont,
						fontSize: center.length > 24 ? 40 : 50,
						fontWeight: 800,
						lineHeight: 1.1,
					}}
				>
					{center}
				</div>
			</div>
		</SceneFrame>
	);
}

function MindBranch({ at, color, x, y, label, children }: { at: number; color: string; x: number; y: number; label: string; children: React.ReactNode }) {
	const s = useStyle();
	const p = useAppear(at, { damping: 14 });
	return (
		<>
			{children}
			<div style={{ position: "absolute", left: x - 150, top: y, width: 300, transform: `translateY(-50%) scale(${0.6 + 0.4 * p})`, opacity: p, textAlign: "center" }}>
				<div style={{ display: "inline-block", padding: "14px 26px", borderRadius: s.radius, background: s.surface, ...borders(outline(s, color), `${Math.max(5, s.line.width * 2)}px solid ${color}`), boxShadow: s.shadow, fontSize: 36, fontWeight: 700, lineHeight: 1.15 }}>{label}</div>
			</div>
		</>
	);
}

function MindLeaf({ at, color, x, y, label }: { at: number; color: string; x: number; y: number; label: string }) {
	const s = useStyle();
	const p = useAppear(at, { damping: 16 });
	return (
		<div style={{ position: "absolute", left: x - 110, top: y, width: 220, transform: `translateY(-50%)`, opacity: p, textAlign: "center" }}>
			<span style={{ display: "inline-block", padding: "8px 18px", borderRadius: 999, background: s.hand ? "transparent" : `${color}1f`, border: s.hand ? `2px ${s.line.style} ${color}` : "none", fontSize: 26, lineHeight: 1.2, color: s.text }}>{label}</span>
		</div>
	);
}

/** Circle centres and radius for 2 or 3 sets in a box. */
export function vennLayout(n: number, W: number, H: number) {
	if (n === 2) {
		// Side by side when the box is wide, one above the other when it is tall.
		if (H > W) {
			const r = Math.min(W * 0.42, H * 0.3, 380);
			const d = r * 0.62;
			return { r, centers: [{ x: W / 2, y: H / 2 - d }, { x: W / 2, y: H / 2 + d }], middle: { x: W / 2, y: H / 2 } };
		}
		const r = Math.min(H * 0.43, 350);
		const d = r * 0.62;
		return { r, centers: [{ x: W / 2 - d, y: H / 2 }, { x: W / 2 + d, y: H / 2 }], middle: { x: W / 2, y: H / 2 } };
	}
	const r = Math.min(H * 0.36, W * 0.32, 300);
	const d = r * 0.6;
	const my = H / 2 + r * 0.12;
	const centers = [-90, 30, 150].map((a) => ({ x: W / 2 + Math.cos(rad(a)) * d, y: my + Math.sin(rad(a)) * d }));
	return { r, centers, middle: { x: W / 2, y: my } };
}

function vennFill(s: VisualStyle, color: string) {
	return s.hand ? `${color}14` : `${color}${s.dark ? "38" : "2e"}`;
}

export function VennScene({ heading, sets, overlap, overlapLabel }: PropsOf<"venn">) {
	const s = useStyle();
	const frame = useCurrentFrame();
	const { contentW: W, stageH } = useLayout();
	const H = stageH(heading);
	const frames = useRevealFrames(sets.length + 1);
	const { r, centers, middle } = vennLayout(sets.length, W, H);
	const stacked = sets.length === 2 && H > W;
	const midAt = frames[sets.length]!;
	const mid = useAppear(midAt, { damping: 14 });
	const pulse = interpolate(frame - midAt, [0, 10, 24], [0, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
	return (
		<SceneFrame heading={heading} center={!heading}>
			<div style={{ ...texture(s), position: "relative", width: W, height: H }}>
				<svg width={W} height={H} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
					{sets.map((_, k) => (
						<VennCircle key={k} at={frames[k]!} cx={centers[k]!.x} cy={centers[k]!.y} r={r} color={accentAt(s, k)} />
					))}
					<circle cx={middle.x} cy={middle.y} r={r * 0.3 + pulse * 30} fill="none" stroke={s.accent} strokeWidth={4} opacity={pulse} />
				</svg>
				{sets.map((set, k) => {
					const c = centers[k]!;
					const ox = c.x - middle.x;
					const oy = c.y - middle.y;
					const len = Math.hypot(ox, oy) || 1;
					// Items sit in the part of the circle away from the middle; the label sits beyond them.
					const ix = c.x + (ox / len) * r * 0.38;
					const iy = c.y + (oy / len) * r * 0.38;
					// Two sets: labels above the circles (side by side), or above the top one and below the bottom one (stacked).
					const lx = stacked ? c.x : c.x + (ox / len) * r * (sets.length === 2 ? 0.2 : 1.12);
					const ly = stacked ? c.y + (oy / len) * (r + 40) : sets.length === 2 ? c.y - r - 34 : c.y + (oy / len) * r * 1.12;
					return <VennSet key={k} at={frames[k]!} color={accentAt(s, k)} label={set.label} items={set.items} ix={ix} iy={iy} lx={lx} ly={ly} />;
				})}
				<div style={{ position: "absolute", left: middle.x - 150, top: middle.y, width: 300, transform: `translateY(-50%) scale(${0.7 + 0.3 * mid})`, opacity: mid, textAlign: "center" }}>
					{overlapLabel ? <div style={{ fontSize: 30, fontWeight: 800, color: s.text, marginBottom: 10 }}>{overlapLabel}</div> : null}
					{overlap.map((o, i) => (
						<div key={i} style={{ fontSize: 27, lineHeight: 1.3, fontWeight: 600 }}>
							{o}
						</div>
					))}
				</div>
			</div>
		</SceneFrame>
	);
}

function VennCircle({ at, cx, cy, r, color }: { at: number; cx: number; cy: number; r: number; color: string }) {
	const s = useStyle();
	const p = useAppear(at, { damping: 15 });
	return (
		<circle
			cx={cx}
			cy={cy}
			r={r * (0.6 + 0.4 * p)}
			fill={vennFill(s, color)}
			stroke={color}
			strokeWidth={s.line.width + 3}
			strokeDasharray={s.line.style === "dashed" ? "14 10" : undefined}
			opacity={p}
		/>
	);
}

function VennSet({ at, color, label, items, ix, iy, lx, ly }: { at: number; color: string; label: string; items: string[]; ix: number; iy: number; lx: number; ly: number }) {
	const s = useStyle();
	const p = useAppear(at + 6, { damping: 200 });
	return (
		<>
			<div style={{ position: "absolute", left: lx - 200, top: ly, width: 400, transform: "translateY(-50%)", textAlign: "center", opacity: p, fontFamily: s.headingFont, fontSize: 42, fontWeight: 800, color }}>{label}</div>
			<div style={{ position: "absolute", left: ix - 140, top: iy, width: 280, transform: "translateY(-50%)", textAlign: "center", opacity: p }}>
				{items.map((t, i) => (
					<div key={i} style={{ fontSize: 28, lineHeight: 1.35 }}>
						{t}
					</div>
				))}
			</div>
		</>
	);
}

function ProsConsColumn({ title, sign, color, items, frames }: { title: string; sign: "+" | "−"; color: string; items: string[]; frames: number[] }) {
	const s = useStyle();
	const head = useAppear(Math.max(0, frames[0]! - 8), { damping: 200 });
	return (
		<div style={{ flex: 1, minWidth: 0 }}>
			<Surface edge={{ side: "top", color }} style={{ padding: "36px 44px", height: "100%" }}>
				<div style={{ ...appearStyle(head, 10), display: "flex", alignItems: "center", gap: 20, marginBottom: 30 }}>
					<div style={{ width: 62, height: 62, borderRadius: 99, background: s.hand ? "transparent" : color, border: s.hand ? `4px solid ${color}` : "none", color: s.hand ? color : s.onAccent, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 50, fontWeight: 800, lineHeight: 1 }}>{sign}</div>
					<div style={{ fontFamily: s.headingFont, fontSize: 52, fontWeight: s.headingWeight, color }}>{title}</div>
				</div>
				<div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
					{items.map((t, i) => (
						<ProsConsItem key={i} at={frames[i]!} color={color} text={t} />
					))}
				</div>
			</Surface>
		</div>
	);
}

function ProsConsItem({ at, color, text }: { at: number; color: string; text: string }) {
	const p = useAppear(at);
	return (
		<div style={{ ...appearStyle(p, 16), display: "flex", gap: 20, alignItems: "flex-start", fontSize: 38, lineHeight: 1.3 }}>
			<div style={{ flexShrink: 0, width: 14, height: 14, borderRadius: 99, background: color, marginTop: 16 }} />
			<div>{text}</div>
		</div>
	);
}

export function ProsConsScene({ heading, pros, cons, verdict }: PropsOf<"proscons">) {
	const s = useStyle();
	const frames = useRevealFrames(pros.length + cons.length);
	const verdictP = useAppear(verdict ? Math.max(...frames) + 30 : null);
	const { vertical } = useLayout();
	return (
		<SceneFrame heading={heading}>
			<div style={{ ...texture(s), display: "flex", flexDirection: "column", gap: 32, flex: vertical ? undefined : 1, minHeight: 0 }}>
				<div style={{ display: "flex", flexDirection: vertical ? "column" : "row", gap: vertical ? 32 : 40, alignItems: "stretch" }}>
					<ProsConsColumn title="Pros" sign="+" color={s.positive} items={pros} frames={frames.slice(0, pros.length)} />
					<ProsConsColumn title="Cons" sign="−" color={s.accent2} items={cons} frames={frames.slice(pros.length)} />
				</div>
				{verdict ? (
					<div style={{ ...appearStyle(verdictP, 16), fontSize: 40, textAlign: "center", color: s.muted }}>
						<span style={{ color: s.accent, fontWeight: 700 }}>On balance: </span>
						{verdict}
					</div>
				) : null}
			</div>
		</SceneFrame>
	);
}
