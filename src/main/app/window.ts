import { app, BrowserWindow, dialog, screen, shell } from "electron";
import { join } from "node:path";
import { attachDevAids } from "../dev/tour";
import { classifyLink } from "../security/links";
import { writeLog } from "./logger";
import { getPref, setPref } from "./prefs";
import { themeBackground, themeState } from "./theme";

let win: BrowserWindow | null = null;

/** Window and taskbar icon (made by scripts/make-icon.cjs). The release exe also has it built in. */
const appIcon = () => (app.isPackaged ? join(process.resourcesPath, "icon.png") : join(app.getAppPath(), "resources", "icon.png"));

interface Bounds {
	x?: number;
	y?: number;
	width: number;
	height: number;
	maximized?: boolean;
}

export const TITLEBAR_HEIGHT = 40;

/** Normal size: 1440x900, but never more than 90% of the screen. */
function defaultSize(): Bounds {
	const a = screen.getPrimaryDisplay().workArea;
	return { width: Math.min(1440, Math.round(a.width * 0.9)), height: Math.min(900, Math.round(a.height * 0.9)) };
}

/** Last saved bounds, shrunk to fit and re-centred if the saved spot is off every screen. */
function savedBounds(): Bounds {
	const b = getPref<Bounds>("window:bounds");
	if (!b) return defaultSize();
	const area = screen.getDisplayMatching({ x: b.x ?? 0, y: b.y ?? 0, width: b.width, height: b.height }).workArea;
	const width = Math.min(b.width, area.width);
	const height = Math.min(b.height, area.height);
	if (b.x !== undefined && b.y !== undefined) {
		const visible = screen.getAllDisplays().some((d) => {
			const a = d.workArea;
			return b.x! < a.x + a.width - 100 && b.x! + width > a.x + 100 && b.y! >= a.y - 50 && b.y! < a.y + a.height - 100;
		});
		if (!visible) return { width, height, maximized: b.maximized };
	}
	return { ...b, width, height };
}

export function getMainWindow(): BrowserWindow | null {
	return win && !win.isDestroyed() ? win : null;
}

/** Only our own pages may load in the app window: the dev server in development, the bundled file in production. */
function isAppUrl(url: string): boolean {
	const dev = process.env.ELECTRON_RENDERER_URL;
	if (dev && url.startsWith(dev)) return true;
	return url.startsWith("file://");
}

/** Opens a link in the system browser after the allowlist check (see security/links.ts). */
export async function openExternalSafe(url: string): Promise<boolean> {
	const { verdict, host } = classifyLink(url);
	if (verdict === "block") {
		writeLog("security", "warn", `blocked link with scheme or form not allowed: ${url.slice(0, 200)}`);
		return false;
	}
	if (verdict === "ask") {
		const parent = getMainWindow();
		const opts = {
			type: "question" as const,
			buttons: ["Open link", "Cancel"],
			defaultId: 1,
			cancelId: 1,
			title: "Open link?",
			message: `Open this link in your browser?`,
			detail: `${host}

${url.slice(0, 500)}`,
		};
		const { response } = parent ? await dialog.showMessageBox(parent, opts) : await dialog.showMessageBox(opts);
		if (response !== 0) return false;
	}
	await shell.openExternal(url);
	return true;
}

export function createWindow(): BrowserWindow {
	const b = savedBounds();
	const dark = themeState().resolved === "dark";
	win = new BrowserWindow({
		center: b.x === undefined || b.y === undefined,
		x: b.x,
		y: b.y,
		width: b.width,
		height: b.height,
		minWidth: 1100,
		minHeight: 700,
		show: false,
		title: "Explainer Studio",
		icon: appIcon(),
		backgroundColor: themeBackground(),
		// Frameless look with native window buttons drawn over our own title bar.
		titleBarStyle: "hidden",
		titleBarOverlay: { color: themeBackground(), symbolColor: dark ? "#e4e4e7" : "#27272a", height: TITLEBAR_HEIGHT },
		autoHideMenuBar: true,
		webPreferences: {
			preload: join(__dirname, "../preload/index.js"),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
			webSecurity: true,
			spellcheck: false,
		},
	});
	if (b.maximized) win.maximize();
	if (process.platform === "win32") {
		win.setAppDetails({ appId: app.isPackaged ? "com.sarfraz.explainerstudio" : "com.sarfraz.explainerstudio.dev", relaunchDisplayName: "Explainer Studio" });
	}
	win.once("ready-to-show", () => win?.show());

	let saveTimer: NodeJS.Timeout | null = null;
	const saveNow = () => {
		if (saveTimer) clearTimeout(saveTimer);
		saveTimer = null;
		if (!win || win.isDestroyed() || win.isMinimized()) return;
		setPref("window:bounds", { ...win.getNormalBounds(), maximized: win.isMaximized() });
	};
	const saveSoon = () => {
		if (saveTimer) clearTimeout(saveTimer);
		saveTimer = setTimeout(saveNow, 500);
	};
	win.on("resize", saveSoon);
	win.on("move", saveSoon);
	win.on("maximize", saveNow);
	win.on("unmaximize", saveNow);
	win.on("close", saveNow);
	win.on("closed", () => {
		win = null;
	});

	// No new windows. Links go through the allowlist: known hosts open, others ask first, other schemes are dropped.
	win.webContents.setWindowOpenHandler(({ url }) => {
		void openExternalSafe(url);
		return { action: "deny" };
	});
	// The app window never navigates away from the app.
	win.webContents.on("will-navigate", (e, url) => {
		if (!isAppUrl(url)) e.preventDefault();
	});

	attachDevAids(win);
	if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL);
	else void win.loadFile(join(__dirname, "../renderer/index.html"));
	return win;
}
