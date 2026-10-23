import { app, type BrowserWindow } from "electron";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { appChannels } from "@shared/ipc/app";
import { appFolders, FOLDERS } from "../app/folders";
import { logFile, writeLog } from "../app/logger";
import { db } from "../db/connection";
import { listBackups } from "../db/backup";
import { TABLES } from "../db/migrations";
import { keystore } from "../security/safe-storage";

/**
 * EXPLAINER_SELFTEST=<result.json>: checks that need the real Electron app
 * (renderer isolation, safeStorage, real folders and database), writes the
 * results as JSON, then quits. Dev builds only.
 */
export function runSelfTest(win: BrowserWindow, out: string): void {
	win.webContents.once("did-finish-load", async () => {
		const results: Record<string, unknown> = {};
		const pass = (name: string, ok: boolean, detail?: unknown) => (results[name] = { ok, detail });
		try {
			await new Promise((r) => setTimeout(r, 1000));
			const r = (await win.webContents.executeJavaScript(
				`(async () => {
					const out = {
						require: typeof require, process: typeof process, module: typeof module, Buffer: typeof Buffer,
						bridgeKeys: Object.keys(window.studio ?? {}).sort(),
						ipcRenderer: typeof window.ipcRenderer, electron: typeof window.electron,
						csp: document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content ?? null,
					};
					try { await window.studio.invoke(${JSON.stringify(appChannels.setTheme.name)}, { pref: "neon" }); out.badIpc = "accepted"; }
					catch (e) { out.badIpc = String(e.message); }
					try { await window.studio.invoke("app:notAChannel", {}); out.unknownIpc = "accepted"; }
					catch (e) { out.unknownIpc = String(e.message); }
					try { eval("1"); out.eval = "allowed"; } catch (e) { out.eval = "blocked"; }
					return out;
				})()`,
				true,
			)) as Record<string, unknown>;
			pass("renderer has no Node globals", r.require === "undefined" && r.process === "undefined" && r.module === "undefined" && r.Buffer === "undefined", r);
			pass("bridge exposes only invoke/on/pathForFile", JSON.stringify(r.bridgeKeys) === JSON.stringify(["invoke", "on", "pathForFile"]), r.bridgeKeys);
			pass("invalid IPC payload rejected", String(r.badIpc).includes("Invalid input"), r.badIpc);
			pass("unknown IPC channel rejected", String(r.unknownIpc).includes("No handler registered"), r.unknownIpc);
			pass("CSP meta present and eval blocked", typeof r.csp === "string" && String(r.csp).includes("script-src 'self'") && r.eval === "blocked", { csp: r.csp, eval: r.eval });

			const secret = `es-selftest-${crypto.randomUUID()}`;
			const sealed = await keystore.seal(secret);
			const opened = await keystore.open(sealed);
			writeLog("selftest", "info", `using key ${secret}`);
			const log = readFileSync(logFile("selftest")!, "utf8");
			pass("safeStorage round-trip", opened === secret && !Buffer.from(sealed).toString("latin1").includes(secret), { sealedBytes: sealed.length });
			pass("secret not in log", !log.includes(secret) && log.includes("[REDACTED]"));

			const f = appFolders();
			pass("app folders exist", FOLDERS.every((k) => existsSync(f[k])), f);
			const tables = (db().prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((t) => t.name);
			pass("all tables present", TABLES.every((t) => tables.includes(t)), tables);
			pass("database file in data folder", existsSync(join(f.data, "studio.db")), join(f.data, "studio.db"));
			pass("backups listed", true, listBackups(f.backups).map((b) => b.file));
		} catch (err) {
			pass("selftest crashed", false, String((err as Error)?.stack ?? err));
		}
		writeFileSync(out, JSON.stringify(results, null, 2));
		console.log(`[selftest] ${Object.values(results).every((x) => (x as { ok: boolean }).ok) ? "ALL PASS" : "FAILURES"} -> ${out}`);
		app.quit();
	});
}
