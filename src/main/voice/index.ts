import { app } from "electron";
import { join } from "node:path";
import { voiceEvents } from "@shared/ipc/voice";
import { appFolders } from "../app/folders";
import { writeLog } from "../app/logger";
import { getMainWindow } from "../app/window";
import { createVoiceEngine, type VoiceEngine } from "./engine";
import { findPython } from "./python";

/** tts.py and requirements.txt. Packaging (TASK-015) copies resources/python next to the app. */
export const scriptsDir = () => (app.isPackaged ? join(process.resourcesPath, "python") : join(app.getAppPath(), "resources", "python"));

/** Dev builds only: EXPLAINER_PYTHON_CANDIDATES="C:\nope\python.exe;python" replaces the Python search list. */
function devCandidates() {
	const raw = !app.isPackaged ? process.env.EXPLAINER_PYTHON_CANDIDATES : undefined;
	return raw ? raw.split(";").filter(Boolean).map((command) => ({ command, args: [] })) : undefined;
}

let engine: VoiceEngine | null = null;

export function voiceEngine(): VoiceEngine {
	if (!engine) {
		const candidates = devCandidates();
		engine = createVoiceEngine({
			root: appFolders().python,
			scriptsDir: scriptsDir(),
			findPython: () => findPython({ candidates }),
			log: (level, msg) => writeLog("voice", level, msg),
			onProgress: (p) => getMainWindow()?.webContents.send(voiceEvents.progress, p),
		});
	}
	return engine;
}

export function stopVoice(): void {
	engine?.cancel();
	engine?.stop();
}
