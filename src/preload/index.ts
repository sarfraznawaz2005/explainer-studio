import { contextBridge, ipcRenderer, webUtils } from "electron";

/**
 * The renderer gets three functions. It never sees ipcRenderer itself.
 * Every channel is validated again in main, so this bridge carries no trust.
 */
const api = {
	invoke: (channel: string, input: unknown): Promise<unknown> => ipcRenderer.invoke(channel, input),
	/** Disk path of a file dropped on the window (Electron removed File.path). */
	pathForFile: (file: File): string => webUtils.getPathForFile(file),
	on: (event: string, cb: (payload: unknown) => void): (() => void) => {
		const listener = (_e: unknown, payload: unknown) => cb(payload);
		ipcRenderer.on(event, listener);
		return () => {
			ipcRenderer.removeListener(event, listener);
		};
	},
};

contextBridge.exposeInMainWorld("studio", api);

export type StudioApi = typeof api;
