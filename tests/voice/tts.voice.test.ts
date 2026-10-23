import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createVoiceEngine } from "../../src/main/voice/engine";
import { tempDir } from "../helpers";

/**
 * Uses the voice engine the app installed (Settings → Voice → Install).
 * EXPLAINER_VOICE_DIR overrides the folder; the default is the app's own python folder.
 */
const root = process.env.EXPLAINER_VOICE_DIR ?? join(process.env.APPDATA ?? "", "Explainer Studio", "python");
const installed = existsSync(join(root, "env.json"));
const engine = createVoiceEngine({ root, scriptsDir: resolve("resources/python"), log: (l, m) => l !== "info" && console.log(`[voice:${l}] ${m}`) });
afterAll(() => engine.stop());

describe.skipIf(!installed)("Kokoro tts (real engine)", () => {
	it("is ready", async () => {
		expect((await engine.status()).state).toBe("ready");
	});

	it("returns the WAV path and duration in ms", async () => {
		const out = join(tempDir("es-voice-"), "sentence.wav");
		const r = await engine.speak({ text: "Light bends when it moves from air into water.", voice: "af_heart", speed: 1, out });
		expect(r.path).toBe(out);
		expect(existsSync(out)).toBe(true);
		const wav = readFileSync(out);
		expect(wav.subarray(0, 4).toString()).toBe("RIFF");
		expect(wav.subarray(8, 12).toString()).toBe("WAVE");
		const rate = wav.readUInt32LE(24);
		const measured = Math.round(((statSync(out).size - 44) / 2 / rate) * 1000);
		expect(rate).toBe(24000);
		expect(Math.abs(measured - r.durationMs)).toBeLessThanOrEqual(1);
		// A 9-word sentence is a few seconds long.
		expect(r.durationMs).toBeGreaterThan(1500);
		expect(r.durationMs).toBeLessThan(8000);
		console.log(`[voice] ${out} ${r.durationMs} ms`);
	});

	it("speaks faster at a higher speed and works with a British voice", async () => {
		const dir = tempDir("es-voice-");
		const text = "Every rainbow is a circle of light, but the ground hides the bottom half.";
		const slow = await engine.speak({ text, voice: "bm_george", speed: 0.8, out: join(dir, "slow.wav") });
		const fast = await engine.speak({ text, voice: "bm_george", speed: 1.4, out: join(dir, "fast.wav") });
		expect(fast.durationMs).toBeLessThan(slow.durationMs * 0.8);
	});

	it("lists English voices", async () => {
		const ids = await engine.voiceIds();
		for (const v of ["af_heart", "am_michael", "bf_emma", "bm_george"]) expect(ids).toContain(v);
	});

	it("rejects bad requests without stopping the engine", async () => {
		await expect(engine.speak({ text: "hi", voice: "af_heart", speed: 1, out: "relative.wav" })).rejects.toThrow(/absolute/);
		await expect(engine.speak({ text: "   ", voice: "af_heart", speed: 1, out: join(tempDir(), "x.wav") })).rejects.toThrow(/No text/);
		const r = await engine.speak({ text: "Still working.", voice: "af_bella", speed: 1, out: join(tempDir(), "ok.wav") });
		expect(r.durationMs).toBeGreaterThan(300);
	});
});
