import { create } from "zustand";
import { appChannels, appEvents, ThemeState, type ThemePref } from "@shared/ipc/app";
import { call, on } from "@renderer/lib/ipc";

/** Title bar overlay colours per theme: match --background and a readable icon colour. */
const TITLEBAR = {
	light: { color: "#fbfbfc", symbolColor: "#3f3f46" },
	dark: { color: "#0c0c0f", symbolColor: "#d4d4d8" },
} as const;

interface ThemeStore {
	pref: ThemePref;
	resolved: "light" | "dark";
	ready: boolean;
	init: () => Promise<void>;
	setPref: (pref: ThemePref) => Promise<void>;
}

function apply(state: ThemeState): void {
	const root = document.documentElement;
	root.classList.toggle("dark", state.resolved === "dark");
	root.style.colorScheme = state.resolved;
	void call(appChannels.setTitleBarColors, TITLEBAR[state.resolved]).catch(() => {});
}

export const useTheme = create<ThemeStore>((set) => ({
	pref: "system",
	resolved: "light",
	ready: false,
	init: async () => {
		const state = await call(appChannels.getTheme);
		apply(state);
		set({ ...state, ready: true });
		// The OS theme (or another window) changed.
		on(appEvents.themeChanged, ThemeState, (s) => {
			apply(s);
			set(s);
		});
	},
	setPref: async (pref) => {
		const state = await call(appChannels.setTheme, { pref });
		apply(state);
		set(state);
	},
}));
