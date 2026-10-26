import { app, BrowserWindow, dialog } from "electron";
import { bootData } from "./app/boot";
import { writeLog } from "./app/logger";
import { closeDatabase } from "./db/connection";
import { initTheme } from "./app/theme";
import { createWindow, getMainWindow } from "./app/window";
import { registerAiIpc } from "./ipc/ai";
import { registerAppIpc } from "./ipc/app";
import { registerAssetIpc } from "./ipc/assets";
import { cancelStarter, maybeAutoInstallStarter } from "./assets";
import { registerIngestIpc } from "./ipc/ingest";
import { registerPlannerIpc } from "./ipc/planner";
import { cancelAllIngest } from "./ingest/jobs";
import { cancelAllPlanner } from "./planner/jobs";
import { registerCreatorIpc } from "./ipc/brand";
import { registerPicturesIpc } from "./ipc/pictures";
import { registerLibraryIpc } from "./ipc/library";
import { registerRenderIpc } from "./ipc/render";
import { renderQueue, resumeRendersSoon } from "./render";
import { registerVoiceIpc } from "./ipc/voice";
import { stopRenderWorker } from "./render/manager";
import { stopVoice } from "./voice";
import { cancelAllNarration } from "./voice/narration-jobs";
import { appFolders } from "./app/folders";
import { handleMediaProtocol, registerAppSchemes } from "./app/media-protocol";
import { handlePreviewProtocol } from "./app/preview-protocol";
import { closeCodeChecker } from "./app/code-check";

// Development builds only: end-to-end tests run against their own data folder, never the user's.
if (!app.isPackaged && process.env.EXPLAINER_USER_DATA) app.setPath("userData", process.env.EXPLAINER_USER_DATA);

// One instance only: a second launch focuses the existing window.
if (!app.requestSingleInstanceLock()) {
	app.quit();
} else {
	registerAppSchemes();
	// Windows shows notifications under this id (matches the window's app id).
	if (process.platform === "win32") app.setAppUserModelId(app.isPackaged ? "com.sarfraz.explainerstudio" : "com.sarfraz.explainerstudio.dev");
	app.on("second-instance", () => {
		const w = getMainWindow();
		if (!w) return;
		if (w.isMinimized()) w.restore();
		w.focus();
	});

	// Deny every permission request (camera, mic, notifications from web content, ...). Nothing in the UI needs them.
	app.on("web-contents-created", (_e, contents) => {
		contents.session.setPermissionRequestHandler((_wc, _permission, cb) => cb(false));
		contents.on("will-attach-webview", (e) => e.preventDefault());
	});

	void app.whenReady().then(async () => {
		let boot;
		try {
			boot = await bootData();
		} catch (err) {
			writeLog("app", "error", "startup failed", err);
			dialog.showErrorBox("Explainer Studio could not start", (err as Error)?.message ?? String(err));
			app.exit(1);
			return;
		}
		initTheme();
		handleMediaProtocol(() => appFolders());
		handlePreviewProtocol();
		registerAppIpc();
		registerRenderIpc();
		registerAiIpc();
		registerVoiceIpc();
		registerIngestIpc();
		registerPlannerIpc();
		registerAssetIpc();
		registerLibraryIpc();
		registerCreatorIpc();
		registerPicturesIpc();
		const win = createWindow();
		if (boot.recovered) {
			const message = boot.recovered;
			win.once("ready-to-show", () => void dialog.showMessageBox(win, { type: "warning", title: "Database restored", message }));
		}
		maybeAutoInstallStarter();
		resumeRendersSoon();
		app.on("activate", () => {
			if (BrowserWindow.getAllWindows().length === 0) createWindow();
		});
	});

	app.on("will-quit", () => {
		renderQueue.shutdown();
		stopRenderWorker();
		cancelAllNarration();
		cancelStarter();
		stopVoice();
		cancelAllIngest();
		cancelAllPlanner();
		closeCodeChecker();
		closeDatabase();
	});

	app.on("window-all-closed", () => {
		if (process.platform !== "darwin") app.quit();
	});
}
