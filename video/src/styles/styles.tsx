import type { CSSProperties, ReactNode } from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import type { StyleId } from "../../../src/shared/plan/schema";

/**
 * A visual style is a whole-video look: colours, fonts, lines and a background.
 * Scenes read only these tokens, so switching style never changes content.
 * Fonts are bundled (Inter, JetBrains Mono) or ship with Windows 10/11.
 */
export type VisualStyle = {
	id: StyleId;
	name: string;
	bg: string;
	surface: string;
	surfaceBorder: string;
	text: string;
	muted: string;
	accent: string;
	accent2: string;
	accent3: string;
	positive: string;
	/** Text on top of an accent fill. */
	onAccent: string;
	headingFont: string;
	bodyFont: string;
	monoFont: string;
	headingWeight: number;
	radius: number;
	/** Hand-drawn look: wobbly lines, dashed outlines, hatched fills, outlined markers. */
	hand: boolean;
	/** Light text on a dark background. */
	dark: boolean;
	/** Outline width and pattern for cards and shapes. */
	line: { width: number; style: "solid" | "dashed" };
	/** Card shadow ("none" for flat looks). */
	shadow: string;
	/** Neon look: headings and accents glow. */
	glow: boolean;
	/** SVG filter (defined by the background) that roughens text and lines. */
	texture: "chalk" | "pencil" | null;
	code: { bg: string; text: string; keyword: string; string: string; comment: string; number: string; fn: string; focus: string; dim: number };
	Background: () => ReactNode;
};

/** Colours a brand kit gives the "brand" style. */
export type BrandColors = { primary: string; secondary: string; accent?: string; dark?: boolean; font?: string };
export const DEFAULT_BRAND: BrandColors = { primary: "#0f766e", secondary: "#f97316", accent: "#6366f1" };

const SANS = "'Inter Variable', Inter, 'Segoe UI', system-ui, sans-serif";
const MONO = "'JetBrains Mono Variable', 'JetBrains Mono', Consolas, monospace";
const CHALK = "'Segoe Print', 'Comic Sans MS', 'Bradley Hand', cursive";
const PENCIL = "'Ink Free', 'Segoe Print', 'Comic Sans MS', cursive";
const TECH = "Bahnschrift, 'DIN Alternate', 'Segoe UI', sans-serif";
const KIDS = "'Comic Sans MS', 'Segoe Print', 'Chalkboard SE', cursive";
const SERIF = "Georgia, Cambria, 'Times New Roman', serif";

const DARK_CODE = { bg: "#16161d", text: "#e6e6ef", keyword: "#a5b4fc", string: "#86efac", comment: "#6b7280", number: "#fcd34d", fn: "#f9a8d4", focus: "rgba(91,91,240,0.28)", dim: 0.35 };

/** Rough edges for text and lines. Referenced by CSS filter: url(#chalk) or url(#pencil). */
function TextureFilters() {
	return (
		<defs>
			<filter id="chalk" x="-5%" y="-5%" width="110%" height="110%">
				<feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="2" seed="7" result="n" />
				<feDisplacementMap in="SourceGraphic" in2="n" scale="2.2" result="d" />
				<feComponentTransfer in="n" result="speck">
					<feFuncA type="discrete" tableValues="1 1 1 0.55 1 1" />
				</feComponentTransfer>
				<feComposite in="d" in2="speck" operator="in" />
			</filter>
			<filter id="pencil" x="-5%" y="-5%" width="110%" height="110%">
				<feTurbulence type="fractalNoise" baseFrequency="1.1" numOctaves="2" seed="11" result="n" />
				<feDisplacementMap in="SourceGraphic" in2="n" scale="1.4" result="d" />
				<feComponentTransfer in="n" result="grain">
					<feFuncA type="discrete" tableValues="1 0.82 1 1 0.9 1" />
				</feComponentTransfer>
				<feComposite in="d" in2="grain" operator="in" />
			</filter>
		</defs>
	);
}

function CleanBackground({ glowA = "rgba(99,102,241,0.16)", glowB = "rgba(236,72,153,0.09)", base = "#f8f8fb" }: { glowA?: string; glowB?: string; base?: string }) {
	const frame = useCurrentFrame();
	const { width, height } = useVideoConfig();
	const drift = Math.sin(frame / 240) * 40;
	return (
		<AbsoluteFill style={{ background: base }}>
			<AbsoluteFill style={{ backgroundImage: "radial-gradient(#d9d9e3 1.4px, transparent 1.4px)", backgroundSize: "36px 36px", opacity: 0.55 }} />
			<div style={{ position: "absolute", width: width * 0.7, height: width * 0.7, left: width * 0.55 + drift, top: -height * 0.45, borderRadius: "50%", background: `radial-gradient(closest-side, ${glowA}, transparent)` }} />
			<div style={{ position: "absolute", width: width * 0.55, height: width * 0.55, left: -width * 0.2 - drift, top: height * 0.55, borderRadius: "50%", background: `radial-gradient(closest-side, ${glowB}, transparent)` }} />
		</AbsoluteFill>
	);
}

function ChalkBackground() {
	return (
		<AbsoluteFill style={{ background: "#22372d" }}>
			<svg width="100%" height="100%" style={{ position: "absolute", inset: 0 }}>
				<TextureFilters />
				<defs>
					<filter id="board-grain">
						<feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="3" />
						<feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.07 0" />
					</filter>
					<radialGradient id="smudge" cx="50%" cy="50%" r="50%">
						<stop offset="0%" stopColor="#ffffff" stopOpacity="0.05" />
						<stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
					</radialGradient>
				</defs>
				<rect width="100%" height="100%" filter="url(#board-grain)" />
				<ellipse cx="25%" cy="30%" rx="22%" ry="12%" fill="url(#smudge)" />
				<ellipse cx="72%" cy="68%" rx="26%" ry="14%" fill="url(#smudge)" />
			</svg>
			<AbsoluteFill style={{ boxShadow: "inset 0 0 220px rgba(0,0,0,0.55)" }} />
			{/* Wooden frame edge. */}
			<AbsoluteFill style={{ border: "18px solid #5b3d25", boxShadow: "inset 0 0 0 3px #3e2817" }} />
		</AbsoluteFill>
	);
}

function PaperBackground() {
	return (
		<AbsoluteFill style={{ background: "#fbf7ec" }}>
			<svg width="100%" height="100%" style={{ position: "absolute", inset: 0 }}>
				<TextureFilters />
				<defs>
					<filter id="paper-grain">
						<feTurbulence type="fractalNoise" baseFrequency="0.75" numOctaves="3" seed="5" />
						<feColorMatrix values="0 0 0 0 0.35  0 0 0 0 0.3  0 0 0 0 0.2  0 0 0 0.09 0" />
					</filter>
					<pattern id="paper-lines" width="100%" height="54" patternUnits="userSpaceOnUse">
						<line x1="0" x2="100%" y1="53" y2="53" stroke="#a9c3e6" strokeWidth="1.6" opacity="0.55" />
					</pattern>
				</defs>
				<rect width="100%" height="100%" fill="url(#paper-lines)" />
				<line x1="112" x2="112" y1="0" y2="100%" stroke="#e8888a" strokeWidth="2.4" opacity="0.7" />
				<rect width="100%" height="100%" filter="url(#paper-grain)" />
			</svg>
			<AbsoluteFill style={{ boxShadow: "inset 0 0 160px rgba(120,95,40,0.16)" }} />
		</AbsoluteFill>
	);
}

function BlueprintBackground() {
	return (
		<AbsoluteFill style={{ background: "radial-gradient(ellipse at 50% 40%, #1a4f8a 0%, #123c6c 60%, #0d2f57 100%)" }}>
			<AbsoluteFill
				style={{
					backgroundImage:
						"linear-gradient(rgba(255,255,255,0.13) 2px, transparent 2px), linear-gradient(90deg, rgba(255,255,255,0.13) 2px, transparent 2px), linear-gradient(rgba(255,255,255,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.06) 1px, transparent 1px)",
					backgroundSize: "160px 160px, 160px 160px, 32px 32px, 32px 32px",
				}}
			/>
			{/* Title block in the corner, like a real drawing sheet. */}
			<div style={{ position: "absolute", right: 36, bottom: 30, width: 260, height: 70, border: "2px solid rgba(234,242,255,0.35)", borderRadius: 2 }}>
				<div style={{ position: "absolute", left: 0, right: 0, top: 34, borderTop: "2px solid rgba(234,242,255,0.25)" }} />
			</div>
			<AbsoluteFill style={{ border: "2px solid rgba(234,242,255,0.3)", margin: 24 }} />
		</AbsoluteFill>
	);
}

function NeonBackground() {
	const frame = useCurrentFrame();
	const { width, height } = useVideoConfig();
	const pulse = 0.85 + Math.sin(frame / 50) * 0.15;
	return (
		<AbsoluteFill style={{ background: "#07070f" }}>
			<div style={{ position: "absolute", width: width * 0.8, height: width * 0.8, left: width * 0.45, top: -height * 0.7, borderRadius: "50%", opacity: pulse, background: "radial-gradient(closest-side, rgba(244,114,182,0.22), transparent)" }} />
			<div style={{ position: "absolute", width: width * 0.7, height: width * 0.7, left: -width * 0.25, top: height * 0.35, borderRadius: "50%", opacity: pulse, background: "radial-gradient(closest-side, rgba(34,211,238,0.18), transparent)" }} />
			{/* Perspective grid floor. */}
			<div
				style={{
					position: "absolute",
					left: -width * 0.5,
					right: -width * 0.5,
					bottom: -height * 0.15,
					height: height * 0.55,
					transform: "perspective(600px) rotateX(62deg)",
					transformOrigin: "bottom",
					backgroundImage: "linear-gradient(rgba(168,85,247,0.35) 2px, transparent 2px), linear-gradient(90deg, rgba(168,85,247,0.35) 2px, transparent 2px)",
					backgroundSize: "90px 90px",
					maskImage: "linear-gradient(to top, black, transparent)",
					opacity: 0.55,
				}}
			/>
		</AbsoluteFill>
	);
}

function CartoonBackground() {
	const frame = useCurrentFrame();
	const drift = (frame / 3) % 1920;
	const cloud = (x: number, y: number, s: number) => (
		<g transform={`translate(${((x + drift * s) % 2200) - 140} ${y}) scale(${s})`} opacity={0.9}>
			<ellipse cx="0" cy="0" rx="90" ry="46" fill="#ffffff" />
			<ellipse cx="-62" cy="14" rx="58" ry="34" fill="#ffffff" />
			<ellipse cx="66" cy="16" rx="62" ry="34" fill="#ffffff" />
		</g>
	);
	return (
		<AbsoluteFill style={{ background: "linear-gradient(180deg, #bfe8ff 0%, #e6f6ff 55%, #fff6d8 100%)" }}>
			<svg width="100%" height="100%" viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice" style={{ position: "absolute", inset: 0 }}>
				{cloud(200, 140, 1)}
				{cloud(1100, 90, 0.8)}
				{cloud(1600, 220, 0.6)}
				<path d="M0 1046 Q 300 1006 620 1040 T 1280 1036 T 1920 1026 V 1080 H 0 Z" fill="#a7e08b" stroke="#1f1d2b" strokeWidth="5" />
			</svg>
		</AbsoluteFill>
	);
}

function AcademicBackground() {
	return (
		<AbsoluteFill style={{ background: "#fbfaf6" }}>
			<AbsoluteFill style={{ backgroundImage: "radial-gradient(rgba(60,50,30,0.05) 1px, transparent 1px)", backgroundSize: "6px 6px" }} />
			<div style={{ position: "absolute", left: 80, right: 80, top: 44, borderTop: "3px solid #1f3a68", borderBottom: "1px solid #1f3a68", height: 6 }} />
			<div style={{ position: "absolute", left: 80, right: 80, bottom: 70, borderTop: "1px solid #c9c2b0" }} />
		</AbsoluteFill>
	);
}

const base = { headingWeight: 700, glow: false, texture: null, shadow: "none" } as const;

export const STYLES: Record<Exclude<StyleId, "brand">, VisualStyle> & { brand: VisualStyle } = {
	clean: {
		...base,
		id: "clean",
		name: "Clean minimal",
		bg: "#f8f8fb",
		surface: "#ffffff",
		surfaceBorder: "#e4e4ec",
		text: "#16161d",
		muted: "#5f5f6e",
		accent: "#5b5bf0",
		accent2: "#ec4899",
		accent3: "#0ea5a4",
		positive: "#16a34a",
		onAccent: "#ffffff",
		headingFont: SANS,
		bodyFont: SANS,
		monoFont: MONO,
		radius: 22,
		hand: false,
		dark: false,
		line: { width: 1.5, style: "solid" },
		shadow: "0 18px 50px -20px rgba(22,22,40,0.25), 0 2px 6px rgba(22,22,40,0.05)",
		code: DARK_CODE,
		Background: () => <CleanBackground />,
	},
	chalkboard: {
		...base,
		id: "chalkboard",
		name: "Chalkboard",
		bg: "#22372d",
		surface: "rgba(255,255,255,0.04)",
		surfaceBorder: "rgba(245,245,235,0.55)",
		text: "#f4f1e6",
		muted: "#c9c6b8",
		accent: "#ffe27a",
		accent2: "#ff9ec4",
		accent3: "#8fd8ff",
		positive: "#b5f29a",
		onAccent: "#22372d",
		headingFont: CHALK,
		bodyFont: CHALK,
		monoFont: MONO,
		radius: 6,
		hand: true,
		dark: true,
		line: { width: 3, style: "dashed" },
		texture: "chalk",
		code: { bg: "rgba(0,0,0,0.28)", text: "#f4f1e6", keyword: "#ffe27a", string: "#b5f29a", comment: "#9fb0a4", number: "#ff9ec4", fn: "#8fd8ff", focus: "rgba(255,226,122,0.18)", dim: 0.35 },
		Background: ChalkBackground,
	},
	paper: {
		...base,
		id: "paper",
		name: "Paper and pencil",
		bg: "#fbf7ec",
		surface: "rgba(255,253,246,0.7)",
		surfaceBorder: "#5b5a66",
		text: "#2b2a33",
		muted: "#5d5b66",
		accent: "#2457c5",
		accent2: "#d1373f",
		accent3: "#2f8f5b",
		positive: "#2f8f5b",
		onAccent: "#ffffff",
		headingFont: PENCIL,
		bodyFont: PENCIL,
		monoFont: MONO,
		radius: 10,
		hand: true,
		dark: false,
		line: { width: 2.5, style: "solid" },
		texture: "pencil",
		code: { bg: "#fffdf6", text: "#2b2a33", keyword: "#2457c5", string: "#2f8f5b", comment: "#8a8794", number: "#d1373f", fn: "#8a4fc8", focus: "rgba(36,87,197,0.12)", dim: 0.4 },
		Background: PaperBackground,
	},
	blueprint: {
		...base,
		id: "blueprint",
		name: "Blueprint",
		bg: "#123c6c",
		surface: "rgba(255,255,255,0.05)",
		surfaceBorder: "rgba(234,242,255,0.62)",
		text: "#eef4ff",
		muted: "#b8cbe6",
		accent: "#ffd166",
		accent2: "#7fdbff",
		accent3: "#ff9fb7",
		positive: "#95f9c3",
		onAccent: "#123c6c",
		headingFont: TECH,
		bodyFont: TECH,
		monoFont: MONO,
		headingWeight: 600,
		radius: 3,
		hand: false,
		dark: true,
		line: { width: 2, style: "solid" },
		code: { bg: "rgba(5,22,45,0.55)", text: "#eef4ff", keyword: "#ffd166", string: "#95f9c3", comment: "#8fa7c7", number: "#ff9fb7", fn: "#7fdbff", focus: "rgba(255,209,102,0.16)", dim: 0.38 },
		Background: BlueprintBackground,
	},
	neon: {
		...base,
		id: "neon",
		name: "Neon dark",
		bg: "#07070f",
		surface: "rgba(20,20,40,0.72)",
		surfaceBorder: "rgba(34,211,238,0.55)",
		text: "#f5f3ff",
		muted: "#a9a6c7",
		accent: "#22d3ee",
		accent2: "#f472b6",
		accent3: "#a3e635",
		positive: "#4ade80",
		onAccent: "#07070f",
		headingFont: SANS,
		bodyFont: SANS,
		monoFont: MONO,
		headingWeight: 800,
		radius: 16,
		hand: false,
		dark: true,
		glow: true,
		line: { width: 2, style: "solid" },
		shadow: "0 0 34px -6px rgba(34,211,238,0.45), inset 0 0 22px -12px rgba(34,211,238,0.5)",
		code: { bg: "#0d0d1c", text: "#e9e7ff", keyword: "#f472b6", string: "#a3e635", comment: "#6c6a8a", number: "#fde047", fn: "#22d3ee", focus: "rgba(34,211,238,0.18)", dim: 0.32 },
		Background: NeonBackground,
	},
	cartoon: {
		...base,
		id: "cartoon",
		name: "Kids cartoon",
		bg: "#e6f6ff",
		surface: "#ffffff",
		surfaceBorder: "#1f1d2b",
		text: "#1f1d2b",
		muted: "#4b4860",
		accent: "#ff6b35",
		accent2: "#3a86ff",
		accent3: "#8338ec",
		positive: "#2bb673",
		onAccent: "#ffffff",
		headingFont: KIDS,
		bodyFont: KIDS,
		monoFont: MONO,
		headingWeight: 800,
		radius: 28,
		hand: false,
		dark: false,
		line: { width: 4, style: "solid" },
		shadow: "8px 8px 0 #1f1d2b",
		code: DARK_CODE,
		Background: CartoonBackground,
	},
	academic: {
		...base,
		id: "academic",
		name: "Academic serif",
		bg: "#fbfaf6",
		surface: "#ffffff",
		surfaceBorder: "#d6cfbd",
		text: "#1d1d22",
		muted: "#56565f",
		accent: "#8c1c13",
		accent2: "#1f3a68",
		accent3: "#a37a12",
		positive: "#2f6b3a",
		onAccent: "#ffffff",
		headingFont: SERIF,
		bodyFont: SERIF,
		monoFont: MONO,
		headingWeight: 700,
		radius: 4,
		hand: false,
		dark: false,
		line: { width: 1, style: "solid" },
		shadow: "0 10px 28px -18px rgba(40,30,10,0.35)",
		code: { bg: "#f6f3ea", text: "#1d1d22", keyword: "#1f3a68", string: "#2f6b3a", comment: "#8b8676", number: "#8c1c13", fn: "#6b3fa0", focus: "rgba(140,28,19,0.1)", dim: 0.4 },
		Background: AcademicBackground,
	},
	brand: brandStyle(DEFAULT_BRAND),
};

/** The "brand" style: the clean layout in a brand kit's colours and font. */
export function brandStyle(b: BrandColors): VisualStyle {
	const dark = !!b.dark;
	const font = b.font ? `'${b.font.replace(/['"\\]/g, "")}', ${SANS}` : SANS;
	return {
		...base,
		id: "brand",
		name: "Brand kit colours",
		bg: dark ? "#0f1115" : "#f8f9fb",
		surface: dark ? "#171a21" : "#ffffff",
		surfaceBorder: dark ? "#2a2f3a" : "#e3e6ec",
		text: dark ? "#f2f4f8" : "#14161c",
		muted: dark ? "#a3a9b8" : "#5c6270",
		accent: b.primary,
		accent2: b.secondary,
		accent3: b.accent ?? b.secondary,
		positive: "#16a34a",
		onAccent: "#ffffff",
		headingFont: font,
		bodyFont: font,
		monoFont: MONO,
		radius: 18,
		hand: false,
		dark,
		line: { width: 1.5, style: "solid" },
		shadow: dark ? "0 18px 50px -20px rgba(0,0,0,0.6)" : "0 18px 50px -20px rgba(22,22,40,0.25), 0 2px 6px rgba(22,22,40,0.05)",
		code: DARK_CODE,
		Background: () => <CleanBackground base={dark ? "#0f1115" : "#f8f9fb"} glowA={`${b.primary}2e`} glowB={`${b.secondary}1f`} />,
	};
}

/** The style for an id; "brand" uses the brand colours when given. */
export function styleFor(id: StyleId, brand?: BrandColors): VisualStyle {
	if (id === "brand") return brand ? brandStyle(brand) : STYLES.brand;
	return STYLES[id] ?? STYLES.clean;
}

/** Texture for text and strokes: rough edges in the hand-drawn styles, a soft glow in neon. */
export const texture = (s: VisualStyle): CSSProperties => (s.texture ? { filter: `url(#${s.texture})` } : s.glow ? { filter: `drop-shadow(0 0 7px ${s.accent}55)` } : {});

/** Glow for the neon style (text-shadow). */
export const glow = (s: VisualStyle, color = s.accent): CSSProperties => (s.glow ? { textShadow: `0 0 18px ${color}99, 0 0 2px ${color}` } : {});

/** An outline in the style's line width and pattern. */
export const outline = (s: VisualStyle, color = s.surfaceBorder) => `${s.line.width}px ${s.line.style} ${color}`;
