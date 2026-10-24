import { z } from "zod";

/**
 * A look recipe: the "AI free-form" style. The AI picks colours, fonts, a background,
 * card shapes and motion from fixed menus. It is pure data (nothing is executed),
 * and `fixLook` makes every recipe safe to show: readable colours, known fonts,
 * values in range. Any recipe, even a bad one, gives a working video.
 */

const hex = z
	.string()
	.trim()
	.regex(/^#?[0-9a-fA-F]{6}$/, "A colour like #1a2b3c")
	.transform((v) => (v.startsWith("#") ? v : `#${v}`).toLowerCase());

/** Fonts that are bundled with the app or ship with Windows 10/11. */
export const LOOK_FONTS = {
	modern: { label: "Modern sans (Inter)", stack: "'Inter Variable', Inter, 'Segoe UI', system-ui, sans-serif" },
	friendly: { label: "Friendly sans (Trebuchet)", stack: "'Trebuchet MS', 'Segoe UI', sans-serif" },
	soft: { label: "Soft rounded (Candara)", stack: "Candara, Corbel, 'Segoe UI', sans-serif" },
	tech: { label: "Technical (Bahnschrift)", stack: "Bahnschrift, 'DIN Alternate', 'Segoe UI', sans-serif" },
	bold: { label: "Heavy display (Arial Black)", stack: "'Arial Black', 'Segoe UI Black', Impact, sans-serif" },
	serif: { label: "Book serif (Georgia)", stack: "Georgia, Cambria, 'Times New Roman', serif" },
	elegant: { label: "Elegant serif (Palatino)", stack: "'Palatino Linotype', 'Book Antiqua', Palatino, Georgia, serif" },
	classic: { label: "Classic serif (Constantia)", stack: "Constantia, Cambria, Georgia, serif" },
	typewriter: { label: "Typewriter (Courier)", stack: "'Courier New', Courier, monospace" },
	code: { label: "Code (JetBrains Mono)", stack: "'JetBrains Mono Variable', 'JetBrains Mono', Consolas, monospace" },
	handwriting: { label: "Handwriting (Ink Free)", stack: "'Ink Free', 'Segoe Print', 'Comic Sans MS', cursive" },
	marker: { label: "Marker (Segoe Print)", stack: "'Segoe Print', 'Comic Sans MS', 'Bradley Hand', cursive" },
	comic: { label: "Comic (Comic Sans)", stack: "'Comic Sans MS', 'Segoe Print', 'Chalkboard SE', cursive" },
} as const;
export type LookFont = keyof typeof LOOK_FONTS;
const FONT_KEYS = Object.keys(LOOK_FONTS) as [LookFont, ...LookFont[]];
const HAND_FONTS: LookFont[] = ["handwriting", "marker", "comic"];

export const LOOK_BACKGROUNDS = ["plain", "dots", "grid", "ruled", "gradient", "glow", "rays", "waves", "stripes", "shapes", "grain", "frame"] as const;
export const LOOK_ENTERS = ["rise", "drop", "slide", "pop", "fade", "blur", "swing"] as const;

export const LookRecipe = z.object({
	/** A short name for the look, like "Desert dusk". */
	name: z.string().trim().min(1).max(40).catch("AI look"),
	/** One line on why it fits the topic. */
	idea: z.string().trim().max(200).catch(""),
	colors: z.object({
		background: hex,
		/** Cards and panels. */
		surface: hex,
		text: hex,
		/** Secondary text. */
		muted: hex,
		accent: hex,
		accent2: hex,
		accent3: hex,
		/** "Correct" and good-news colour. */
		positive: hex.catch("#16a34a"),
		/** The second background colour (gradients, patterns, glows). */
		background2: hex.optional().catch(undefined),
	}),
	/** 0 = see-through cards (only an outline), 1 = solid cards. */
	surfaceOpacity: z.number().min(0).max(1).catch(1),
	headingFont: z.enum(FONT_KEYS).catch("modern"),
	bodyFont: z.enum(FONT_KEYS).catch("modern"),
	headingWeight: z.number().int().min(300).max(900).catch(700),
	/** Card corner radius in pixels. */
	corners: z.number().min(0).max(40).catch(16),
	line: z.object({ width: z.number().min(0).max(5).catch(1.5), dashed: z.boolean().catch(false) }).catch({ width: 1.5, dashed: false }),
	shadow: z.enum(["none", "soft", "lifted", "hard", "glow"]).catch("soft"),
	/** Rough edges on text and lines, like chalk or pencil. */
	texture: z.enum(["none", "chalk", "pencil"]).catch("none"),
	/** Headings and accents glow (best on dark backgrounds). */
	glow: z.boolean().catch(false),
	background: z
		.object({
			kind: z.enum(LOOK_BACKGROUNDS).catch("plain"),
			/** How strong the pattern is: 0 = hidden, 1 = strong. */
			strength: z.number().min(0).max(1).catch(0.5),
			/** The pattern moves slowly. */
			moving: z.boolean().catch(false),
			/** Gradient and stripe angle in degrees. */
			angle: z.number().min(0).max(360).catch(135),
		})
		.catch({ kind: "plain", strength: 0.5, moving: false, angle: 135 }),
	motion: z
		.object({
			/** How text and items come in. */
			enter: z.enum(LOOK_ENTERS).catch("rise"),
			bounce: z.enum(["none", "soft", "lively"]).catch("soft"),
			speed: z.enum(["slow", "normal", "fast"]).catch("normal"),
		})
		.catch({ enter: "rise", bounce: "soft", speed: "normal" }),
});
export type LookRecipe = z.infer<typeof LookRecipe>;
export type LookRecipeInput = z.input<typeof LookRecipe>;

/** Used when a draft has "AI free-form" but no recipe yet (and in tests). */
export const DEFAULT_LOOK: LookRecipe = {
	name: "Warm studio",
	idea: "Warm paper colours with a calm teal accent.",
	colors: { background: "#f6efe4", surface: "#fffaf2", text: "#2a211b", muted: "#6b5d52", accent: "#0f766e", accent2: "#c2410c", accent3: "#7c3aed", positive: "#15803d", background2: "#e9dcc7" },
	surfaceOpacity: 1,
	headingFont: "elegant",
	bodyFont: "friendly",
	headingWeight: 700,
	corners: 14,
	line: { width: 1.5, dashed: false },
	shadow: "lifted",
	texture: "none",
	glow: false,
	background: { kind: "waves", strength: 0.5, moving: true, angle: 160 },
	motion: { enter: "swing", bounce: "soft", speed: "normal" },
};

/* ---------- colour maths (WCAG 2) ---------- */

const rgb = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const toHex = (c: [number, number, number]) => `#${c.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("")}`;

export function luminance(h: string): number {
	const [r, g, b] = rgb(h).map((v) => {
		const c = v / 255;
		return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	}) as [number, number, number];
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
	const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m) as [number, number];
	return (x + 0.05) / (y + 0.05);
}

/** Mixes `a` toward `b` by t (0 = a, 1 = b). */
export function mix(a: string, b: string, t: number): string {
	const [x, y] = [rgb(a), rgb(b)];
	return toHex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
}

/** `fg` moved toward white or black (away from every background) until it reaches `min` contrast on all of them. */
export function readable(fg: string, bgs: string[], min: number): string {
	const ok = (c: string) => bgs.every((b) => contrast(c, b) >= min);
	if (ok(fg)) return fg;
	// The first colour is the background: text goes the other way from it.
	const target = isDark(bgs[0]!) ? "#ffffff" : "#000000";
	for (let t = 0.08; t < 1; t += 0.08) {
		const c = mix(fg, target, t);
		if (ok(c)) return c;
	}
	return target;
}

/** White text reads better on it than black text. */
export const isDark = (h: string) => contrast("#ffffff", h) > contrast("#000000", h);

/** A colour moved away from the middle (toward black when dark, white when light) until text can reach `min` contrast on it. */
function roomForText(h: string, min: number): string {
	const target = isDark(h) ? "#000000" : "#ffffff";
	const best = (c: string) => Math.max(contrast("#ffffff", c), contrast("#000000", c));
	for (let t = 0; t < 1; t += 0.06) {
		const c = mix(h, target, t);
		if (best(c) >= min) return c;
	}
	return target;
}

const alpha = (h: string, a: number) => `${h}${Math.round(Math.min(1, Math.max(0, a)) * 255).toString(16).padStart(2, "0")}`;

/** A recipe with the colours and choices made safe. Everything a look shows is read from this. */
export type FixedLook = LookRecipe & {
	dark: boolean;
	/** Card colour as drawn (may be see-through). */
	surfaceFill: string;
	border: string;
	onAccent: string;
	hand: boolean;
};

/**
 * Makes any recipe readable:
 * - text 7:1, secondary text 4.5:1 and accents 3:1 against both the background and the cards;
 * - the text on accent fills is black or white, whichever reads better;
 * - effects that fight each other are dropped (blur entry with textures or glow, glow on light backgrounds).
 */
export function fixLook(input: LookRecipe): FixedLook {
	const r = LookRecipe.parse(input);
	const c = { ...r.colors };
	// Mid-tone colours (neither light nor dark) leave no room for readable text.
	c.background = roomForText(c.background, 10);
	const dark = isDark(c.background);
	// Cards sit on the same side (dark or light) as the background, else no text colour reads on both.
	c.surface = roomForText(c.surface, 10);
	if (isDark(c.surface) !== dark) c.surface = mix(c.background, dark ? "#ffffff" : "#000000", 0.06);
	// Cards stay close to the background, so text that reads on one reads on both.
	if (contrast(c.surface, c.background) > 2.2) c.surface = mix(c.surface, c.background, 0.5);
	const surfaceSeen = r.surfaceOpacity >= 0.999 ? c.surface : mix(c.background, c.surface, r.surfaceOpacity);
	const both = [c.background, surfaceSeen];
	c.text = readable(c.text, both, 7);
	c.muted = readable(c.muted, both, 4.5);
	for (const k of ["accent", "accent2", "accent3", "positive"] as const) c[k] = readable(c[k], both, 3);
	const onAccent = contrast("#ffffff", c.accent) >= contrast("#111111", c.accent) ? "#ffffff" : "#111111";
	const glowOk = r.glow && dark;
	const enter = r.motion.enter === "blur" && (r.texture !== "none" || glowOk) ? "fade" : r.motion.enter;
	return {
		...r,
		colors: c,
		glow: glowOk,
		shadow: r.shadow === "glow" && !dark ? "soft" : r.shadow,
		motion: { ...r.motion, enter },
		dark,
		surfaceFill: r.surfaceOpacity >= 0.999 ? c.surface : alpha(c.surface, r.surfaceOpacity),
		border: mix(c.text, surfaceSeen, r.line.width >= 2.5 ? 0.3 : 0.75),
		onAccent,
		hand: HAND_FONTS.includes(r.headingFont) || r.texture !== "none",
	};
}

/** The look in a few words for the AI: so a new look is not the same as the old one. */
export const lookSummary = (l: LookRecipe) => `${l.name}: ${l.colors.background} background, ${l.colors.accent} accent, ${l.headingFont} headings, ${l.background.kind} background, ${l.motion.enter} motion`;
