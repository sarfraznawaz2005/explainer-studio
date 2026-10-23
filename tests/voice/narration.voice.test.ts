import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { VoiceSetup } from "../../src/shared/narration";
import { VideoPlan } from "../../src/shared/plan/schema";
import { computeTimeline } from "../../src/shared/plan/timing";
import { createVoiceEngine } from "../../src/main/voice/engine";
import { applyVoice, narrationCounts, plannedClips, voicePlan, wavDurationMs } from "../../src/main/voice/narration";
import { tempDir } from "../helpers";

/** Per-sentence voice with the real Kokoro engine the app installed (see tts.voice.test.ts). */
const root = process.env.EXPLAINER_VOICE_DIR ?? join(process.env.APPDATA ?? "", "Explainer Studio", "python");
const installed = existsSync(join(root, "env.json"));
const engine = createVoiceEngine({ root, scriptsDir: resolve("resources/python"), log: (l, m) => l !== "info" && console.log(`[voice:${l}] ${m}`) });
afterAll(() => engine.stop());

const said: string[] = [];
const speak = async (req: { text: string; voice: string; speed: number; out: string }) => {
	said.push(req.text);
	return engine.speak(req);
};

const plan = VideoPlan.parse({
	version: 1,
	meta: { title: "SQL", level: "High school" },
	chapters: [
		{
			id: "ch1",
			title: "Asking questions",
			scenes: [
				{ id: "s1", type: "bullets", props: { items: ["Tables", "Queries"] }, narration: [{ id: "n1", text: "SQL is a language for asking a database questions." }, { id: "n2", text: "Data lives in tables." }] },
				{ id: "s2", type: "bullets", props: { items: ["SELECT", "WHERE"] }, narration: [{ id: "n3", text: "A query starts with SELECT." }, { id: "n4", text: "WHERE picks the rows you want." }] },
			],
		},
	],
});

describe.skipIf(!installed)("per-sentence voice with Kokoro", () => {
	const dir = tempDir("es-narr-voice-");
	const setup: VoiceSetup = { voice: "af_heart", speed: 1, lexicon: [] };

	it("voices each sentence, measures it, and the timeline uses the real lengths", async () => {
		const t0 = Date.now();
		const r = await voicePlan(plan, setup, { dir, speak });
		console.log(`[narration] ${r.made} clips in ${Date.now() - t0} ms`);
		expect(r).toMatchObject({ total: 4, made: 4, reused: 0 });
		const voiced = applyVoice(plan, setup, r.durations);
		const t = computeTimeline(voiced);
		for (const s of t.scenes.flatMap((x) => x.sentences)) {
			expect(s.estimated).toBe(false);
			const ms = await wavDurationMs(join(dir, s.audio!));
			// Frame length equals the measured clip, to the nearest frame.
			expect(Math.abs(s.duration - (ms / 1000) * 30)).toBeLessThanOrEqual(0.5);
		}
		expect(narrationCounts(voiced, setup, dir)).toMatchObject({ voiced: 4, pending: 0 });
	});

	it("an edit re-voices only that sentence", async () => {
		const edited = VideoPlan.parse({ ...plan, chapters: [{ ...plan.chapters[0]!, scenes: [plan.chapters[0]!.scenes[0]!, { ...plan.chapters[0]!.scenes[1]!, narration: [{ id: "n3", text: "Every query starts with SELECT." }, { id: "n4", text: "WHERE picks the rows you want." }] }] }] });
		said.length = 0;
		const r = await voicePlan(edited, setup, { dir, speak });
		expect(r).toMatchObject({ total: 4, made: 1, reused: 3 });
		expect(said).toEqual(["Every query starts with SELECT."]);
	});

	it("a pronunciation rule changes what Kokoro says", async () => {
		const withLex: VoiceSetup = { ...setup, lexicon: [{ word: "SQL", say: "sequel", matchCase: false }] };
		said.length = 0;
		const r = await voicePlan(plan, withLex, { dir, speak });
		expect(r.made).toBe(1);
		expect(said).toEqual(["sequel is a language for asking a database questions."]);
		const before = plannedClips(plan, setup)[0]!.clip;
		const after = plannedClips(plan, withLex)[0]!.clip;
		const a = readFileSync(join(dir, before));
		const b = readFileSync(join(dir, after));
		const msA = await wavDurationMs(join(dir, before));
		const msB = await wavDurationMs(join(dir, after));
		console.log(`[narration] "SQL ..." ${msA} ms, "sequel ..." ${msB} ms`);
		expect(a.equals(b)).toBe(false);
		// The rule clip is the same sound as typing "sequel" yourself.
		const typed = join(dir, "typed.wav");
		await engine.speak({ text: "sequel is a language for asking a database questions.", voice: "af_heart", speed: 1, out: typed });
		const c = readFileSync(typed);
		expect(Math.abs((await wavDurationMs(typed)) - msB)).toBeLessThanOrEqual(1);
		expect(c.equals(b)).toBe(true);
	});
});
