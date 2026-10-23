import { z } from "zod";
import { defineChannel, NoInput, Ok } from "./channels";

export const ThemePref = z.enum(["light", "dark", "system"]);
export type ThemePref = z.infer<typeof ThemePref>;

export const ThemeState = z.object({
	pref: ThemePref,
	/** What is actually shown after resolving "system". */
	resolved: z.enum(["light", "dark"]),
});
export type ThemeState = z.infer<typeof ThemeState>;

export const AppInfo = z.object({
	name: z.string(),
	version: z.string(),
	platform: z.string(),
	isPackaged: z.boolean(),
});

export const appChannels = {
	info: defineChannel("app:info", NoInput, AppInfo),
	getTheme: defineChannel("app:theme:get", NoInput, ThemeState),
	setTheme: defineChannel("app:theme:set", z.object({ pref: ThemePref }), ThemeState),
	/** Lets the title bar overlay (native window buttons) match the app colours. */
	setTitleBarColors: defineChannel(
		"app:titlebar:colors",
		z.object({ color: z.string().regex(/^#[0-9a-fA-F]{6}$/), symbolColor: z.string().regex(/^#[0-9a-fA-F]{6}$/) }),
		Ok,
	),
};

/** Push events from main to renderer. */
export const appEvents = {
	themeChanged: "app:theme:changed",
} as const;
