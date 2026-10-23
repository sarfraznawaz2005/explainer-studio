import { app } from "electron";
import { appChannels } from "@shared/ipc/app";
import { applyTheme, themeState } from "../app/theme";
import { getMainWindow, TITLEBAR_HEIGHT } from "../app/window";
import { handle } from "./register";

export function registerAppIpc(): void {
	handle(appChannels.info, () => ({
		name: app.getName(),
		version: app.getVersion(),
		platform: process.platform,
		isPackaged: app.isPackaged,
	}));
	handle(appChannels.getTheme, () => themeState());
	handle(appChannels.setTheme, ({ pref }) => applyTheme(pref));
	handle(appChannels.setTitleBarColors, ({ color, symbolColor }) => {
		getMainWindow()?.setTitleBarOverlay({ color, symbolColor, height: TITLEBAR_HEIGHT });
		return { ok: true as const };
	});
}
