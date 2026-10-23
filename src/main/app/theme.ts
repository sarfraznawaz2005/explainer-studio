import { BrowserWindow, nativeTheme } from "electron";
import type { ThemePref, ThemeState } from "@shared/ipc/app";
import { appEvents } from "@shared/ipc/app";
import { getPref, setPref } from "./prefs";

/** Window background per theme, so there is no white flash before the page paints. Matches --background in index.css. */
const BACKGROUND = { light: "#fbfbfc", dark: "#0c0c0f" } as const;

export function themePref(): ThemePref {
	const p = getPref<ThemePref>("theme");
	return p === "light" || p === "dark" || p === "system" ? p : "system";
}

export function themeState(): ThemeState {
	return { pref: themePref(), resolved: nativeTheme.shouldUseDarkColors ? "dark" : "light" };
}

export function themeBackground(): string {
	return BACKGROUND[themeState().resolved];
}

/** Applies a theme preference. nativeTheme handles "system" and tells us when the OS changes. */
export function applyTheme(pref: ThemePref): ThemeState {
	setPref("theme", pref);
	nativeTheme.themeSource = pref;
	return themeState();
}

export function initTheme(): void {
	nativeTheme.themeSource = themePref();
	nativeTheme.on("updated", () => {
		const state = themeState();
		for (const w of BrowserWindow.getAllWindows()) {
			if (w.isDestroyed()) continue;
			w.setBackgroundColor(BACKGROUND[state.resolved]);
			w.webContents.send(appEvents.themeChanged, state);
		}
	});
}
