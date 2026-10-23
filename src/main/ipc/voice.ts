import { shell } from "electron";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { DEFAULT_VOICE, VoiceSettings, voiceChannels } from "@shared/ipc/voice";
import { appFolders } from "../app/folders";
import { repos } from "../db/repos";
import { voiceEngine } from "../voice";
import { cancelNarration, narrationStatus, saveVoiceSetup, startNarration } from "../voice/narration-jobs";
import { describeVoices, sampleSentence } from "../voice/voices";
import { handle } from "./register";

const SETTINGS_KEY = "voice.settings";
const PREVIEW_KEEP = 40;

function getSettings(): VoiceSettings {
	const r = VoiceSettings.safeParse(repos.settings.get(SETTINGS_KEY));
	return r.success ? r.data : { voice: DEFAULT_VOICE, speed: 1 };
}

/** Preview clips are cached by voice, speed and text. Only the newest few are kept. */
async function previewFile(voice: string, speed: number, text: string): Promise<string> {
	const dir = join(appFolders().cache, "voice-preview");
	await mkdir(dir, { recursive: true });
	const key = createHash("sha256").update(`${voice}|${speed.toFixed(2)}|${text}`).digest("hex").slice(0, 24);
	return join(dir, `${voice}-${key}.wav`);
}

async function prunePreviews(): Promise<void> {
	const dir = join(appFolders().cache, "voice-preview");
	const names = (await readdir(dir)).filter((n) => n.endsWith(".wav"));
	if (names.length <= PREVIEW_KEEP) return;
	const withTime = await Promise.all(names.map(async (n) => ({ p: join(dir, n), t: (await stat(join(dir, n))).mtimeMs })));
	withTime.sort((a, b) => b.t - a.t);
	for (const f of withTime.slice(PREVIEW_KEEP)) await rm(f.p, { force: true });
}

export function registerVoiceIpc(): void {
	handle(voiceChannels.status, () => voiceEngine().status());
	handle(voiceChannels.install, ({ repair }) => {
		// Runs in the background; progress goes out as voice:progress events.
		void voiceEngine().install(repair);
		return { ok: true as const };
	});
	handle(voiceChannels.cancel, () => {
		voiceEngine().cancel();
		return { ok: true as const };
	});
	handle(voiceChannels.voices, async () => describeVoices(await voiceEngine().voiceIds()));
	handle(voiceChannels.preview, async ({ voice, speed, text }) => {
		const engine = voiceEngine();
		const name = describeVoices([voice])[0];
		if (!name) throw new Error("Unknown voice");
		const say = text ?? sampleSentence(name);
		const out = await previewFile(voice, speed, say);
		const cached = existsSync(out);
		if (!cached) {
			await engine.speak({ text: say, voice, speed, out });
			void prunePreviews().catch(() => {});
		}
		const wav = await engine.readWav(out);
		// 16-bit mono WAV: 44-byte header, 2 bytes per sample.
		const rate = wav.readUInt32LE(24);
		const durationMs = Math.round(((wav.length - 44) / 2 / rate) * 1000);
		return { audio: `data:audio/wav;base64,${wav.toString("base64")}`, durationMs, cached };
	});
	handle(voiceChannels.getSettings, () => getSettings());
	handle(voiceChannels.setSettings, (s) => {
		repos.settings.set(SETTINGS_KEY, s);
		return s;
	});
	handle(voiceChannels.draftStatus, ({ draftId }) => narrationStatus(draftId));
	handle(voiceChannels.draftSetup, ({ draftId, setup }) => saveVoiceSetup(draftId, setup));
	handle(voiceChannels.draftStart, ({ draftId }) => ({ jobId: startNarration(draftId) }));
	handle(voiceChannels.draftCancel, ({ jobId }) => {
		cancelNarration(jobId);
		return { ok: true as const };
	});
	handle(voiceChannels.reveal, async () => {
		const err = await shell.openPath(appFolders().python);
		if (err) throw new Error(err);
		return { ok: true as const };
	});
}
