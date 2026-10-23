import { z } from "zod";

/**
 * The brand kit: a channel's look, applied to every render (intro, outro with
 * end screen, watermark, and the colours and font of the "brand" style).
 * Stored as JSON in brand_kits.data. Renders get a BrandStamp in plan.meta.brand.
 */

const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a colour like #1a2b3c");

/** Fonts that are bundled with the app (Inter) or ship with Windows 10/11. */
export const BRAND_FONTS = ["Inter", "Segoe UI", "Bahnschrift", "Trebuchet MS", "Verdana", "Georgia", "Cambria", "Comic Sans MS", "Segoe Print", "Ink Free"] as const;
export const BrandFont = z.enum(BRAND_FONTS);
export type BrandFont = z.infer<typeof BrandFont>;

export const CORNERS = ["top-left", "top-right", "bottom-left", "bottom-right"] as const;
export const Corner = z.enum(CORNERS);
export type Corner = z.infer<typeof Corner>;

/** A logo saved by the app: <assets>/brand/<kit id>/logo-<8 hex>.<ext>. */
export const LogoFile = z.string().regex(/^logo-[0-9a-f]{8}\.(png|jpg|webp)$/);

export const BrandKitData = z.object({
	channel: z.string().trim().min(1, "Type the channel name").max(60),
	tagline: z.string().trim().max(100).default(""),
	logo: LogoFile.nullable().default(null),
	colors: z
		.object({ primary: Hex, secondary: Hex, accent: Hex, dark: z.boolean().default(false) })
		.default({ primary: "#0f766e", secondary: "#f97316", accent: "#6366f1", dark: false }),
	font: BrandFont.default("Inter"),
	watermark: z
		.object({
			enabled: z.boolean().default(true),
			corner: Corner.default("bottom-right"),
			/** 0.15 = faint, 1 = solid. */
			opacity: z.number().min(0.15).max(1).default(0.55),
			size: z.enum(["small", "medium", "large"]).default("medium"),
		})
		.default({ enabled: true, corner: "bottom-right", opacity: 0.55, size: "medium" }),
	intro: z
		.object({ enabled: z.boolean().default(true), seconds: z.number().min(2).max(8).default(3) })
		.default({ enabled: true, seconds: 3 }),
	outro: z
		.object({
			enabled: z.boolean().default(true),
			/** YouTube end screens need 5–20 seconds. */
			seconds: z.number().min(5).max(20).default(10),
			message: z.string().trim().max(80).default("Thanks for watching!"),
			callToAction: z.string().trim().max(80).default("Subscribe for more explainers"),
			/** Leaves framed space for YouTube's end screen elements (next video, subscribe). */
			endScreen: z.boolean().default(true),
		})
		.default({ enabled: true, seconds: 10, message: "Thanks for watching!", callToAction: "Subscribe for more explainers", endScreen: true }),
});
export type BrandKitData = z.infer<typeof BrandKitData>;
export type BrandKitDataInput = z.input<typeof BrandKitData>;

/** A kit as the renderer sees it. */
export const BrandKitView = z.object({
	id: z.string(),
	name: z.string(),
	isDefault: z.boolean(),
	data: BrandKitData,
	/** es-media URL of the logo, or null. */
	logoUrl: z.string().nullable(),
	updatedAt: z.string(),
});
export type BrandKitView = z.infer<typeof BrandKitView>;

/**
 * What a render needs from the kit (and the series), frozen into plan.meta.brand.
 * The logo is a URL: es-media in the app, rewritten to the local media server by the render worker.
 */
export const BrandStamp = z.object({
	channel: z.string().max(60),
	tagline: z.string().max(100).default(""),
	logo: z.string().max(400).nullable().default(null),
	colors: z.object({ primary: Hex, secondary: Hex, accent: Hex, dark: z.boolean() }),
	font: BrandFont,
	watermark: z.object({ enabled: z.boolean(), corner: Corner, opacity: z.number().min(0).max(1), size: z.enum(["small", "medium", "large"]) }),
	/** Seconds; 0 = none. */
	intro: z.number().min(0).max(8),
	outro: z.number().min(0).max(20),
	message: z.string().max(80).default(""),
	callToAction: z.string().max(80).default(""),
	endScreen: z.boolean().default(false),
	series: z.object({ title: z.string().max(120), episode: z.number().int().min(1).max(9999) }).nullable().default(null),
});
export type BrandStamp = z.infer<typeof BrandStamp>;

export const defaultBrandKit = (channel = "My channel"): BrandKitData => BrandKitData.parse({ channel });

export function brandStamp(data: BrandKitData, logoUrl: string | null, series: BrandStamp["series"] = null): BrandStamp {
	return {
		channel: data.channel,
		tagline: data.tagline,
		logo: logoUrl,
		colors: data.colors,
		font: data.font,
		watermark: data.watermark,
		intro: data.intro.enabled ? data.intro.seconds : 0,
		outro: data.outro.enabled ? data.outro.seconds : 0,
		message: data.outro.message,
		callToAction: data.outro.callToAction,
		endScreen: data.outro.enabled && data.outro.endScreen,
		series,
	};
}

/** CSS font stack for a brand font (falls back to the bundled Inter). */
export const brandFontStack = (f: BrandFont) => (f === "Inter" ? "'Inter Variable', Inter, 'Segoe UI', system-ui, sans-serif" : `'${f}', 'Inter Variable', 'Segoe UI', sans-serif`);
