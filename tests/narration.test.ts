import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyLexicon, type VoiceSetup } from "../src/shared/narration";
import { VideoPlan, type VideoPlanInput } from "../src/shared/plan/schema";
import { computeTimeline, LEAD_IN_MS, msToFrames, SENTENCE_GAP_MS } from "../src/shared/plan/timing";
import { audioBaseFor, mediaPath } from "../src/main/app/media-url";
import { applyVoice, clipName, narrationCounts, plannedClips, pruneClips, voicePlan, wavDurationMs, type Speak } from "../src/main/voice/narration";
import { tempDir } from "./helpers";

/** A real 16-bit mono WAV of `ms` silence, optionally with an extra chunk before the data (as some encoders write). */
function wav(ms: number, rate = 24_000, extraChunk = false): Buffer {
	const samples = Math.round((ms / 1000) * rate);
	const data = Buffer.alloc(samples * 2);
	const fmt = Buffer.alloc(24);
	fmt.write("fmt ", 0, "ascii");
	fmt.writeUInt32LE(16, 4);
	fmt.writeUInt16LE(1, 8);
	fmt.writeUInt16LE(1, 10);
	fmt.writeUInt32LE(rate, 12);
	fmt.writeUInt32LE(rate * 2, 16);
	fmt.writeUInt16LE(2, 20);
	fmt.writeUInt16LE(16, 22);
	const list = extraChunk ? Buffer.concat([Buffer.from("LIST", "ascii"), Buffer.from([5, 0, 0, 0]), Buffer.from("INFOx\0", "ascii")]) : Buffer.alloc(0);
	const dataHead = Buffer.alloc(8);
	dataHead.write("data", 0, "ascii");
	dataHead.writeUInt32LE(data.length, 4);
	const body = Buffer.concat([Buffer.from("WAVE", "ascii"), fmt, list, dataHead, data]);
	const riff = Buffer.alloc(8);
	riff.write("RIFF", 0, "ascii");
	riff.writeUInt32LE(body.length, 4);
	return Buffer.concat([riff, body]);
}

/** Fake engine: 60 ms per character, records every text it was asked to say. */
function fakeSpeak() {
	const said: string[] = [];
	const speak: Speak = async ({ text, out }) => {
		said.push(text);
		const ms = 60 * text.length;
		writeFileSync(out, wav(ms));
		return { durationMs: ms };
	};
	return { speak, said };
}

const bullets = (id: string, texts: string[]) => ({ id, type: "bullets" as const, props: { items: ["One", "Two"] }, narration: texts.map((text, i) => ({ id: `${id}-n${i + 1}`, text })) });

function samplePlan(): VideoPlan {
	const input: VideoPlanInput = {
		version: 1,
		meta: { title: "Databases", level: "High school" },
		chapters: [
			{
				id: "ch1",
				title: "SQL basics",
				scenes: [
					bullets("s1", ["SQL lets you ask a database questions.", "A table has rows and columns.", "Each row is one record."]),
					bullets("s2", ["You write SQL queries with SELECT.", "A table has rows and columns."]),
				],
			},
			{ id: "ch2", title: "Keys", scenes: [bullets("s3", ["A primary key names one row.", "Keys keep the data tidy."])] },
		],
	};
	return VideoPlan.parse(input);
}

const setup: VoiceSetup = { voice: "af_heart", speed: 1, lexicon: [] };

const editSentence = (plan: VideoPlan, id: string, text: string): VideoPlan => ({
	...plan,
	chapters: plan.chapters.map((c) => ({ ...c, scenes: c.scenes.map((s) => ({ ...s, narration: s.narration.map((n) => (n.id === id ? { id, text } : n)) })) })),
});

describe("pronunciation dictionary", () => {
	it("replaces whole words, any case, next to punctuation", () => {
		const lex = [{ word: "SQL", say: "sequel", matchCase: false }];
		expect(applyLexicon("SQL, sql and Sql! But not SQLite or MySQL.", lex)).toBe("sequel, sequel and sequel! But not SQLite or MySQL.");
	});
	it("can match case exactly", () => {
		const lex = [{ word: "US", say: "United States", matchCase: true }];
		expect(applyLexicon("The US helps us.", lex)).toBe("The United States helps us.");
	});
	it("prefers longer entries and never replaces a replacement again", () => {
		const lex = [
			{ word: "York", say: "Yorrk", matchCase: false },
			{ word: "New York", say: "Noo York", matchCase: false },
			{ word: "Noo", say: "WRONG", matchCase: false },
		];
		expect(applyLexicon("New York and York.", lex)).toBe("Noo York and Yorrk.");
	});
	it("treats regex characters in words as plain text", () => {
		expect(applyLexicon("Learn C++ today, not C.", [{ word: "C++", say: "C plus plus", matchCase: false }])).toBe("Learn C plus plus today, not C.");
		expect(applyLexicon("Use a.b here", [{ word: "a.b", say: "A dot B", matchCase: false }])).toBe("Use A dot B here");
	});
	it("works with accented words", () => {
		expect(applyLexicon("Le café est là.", [{ word: "café", say: "ka-fay", matchCase: false }])).toBe("Le ka-fay est là.");
	});
});

describe("clip names", () => {
	it("depend on the spoken text, the voice and the speed", () => {
		const a = clipName("Hello there.", setup);
		expect(a).toMatch(/^[0-9a-f]{32}\.wav$/);
		expect(clipName("Hello there.", setup)).toBe(a);
		expect(clipName("Hello there!", setup)).not.toBe(a);
		expect(clipName("Hello there.", { ...setup, voice: "bm_george" })).not.toBe(a);
		expect(clipName("Hello there.", { ...setup, speed: 1.1 })).not.toBe(a);
	});
});

describe("voicing a plan", () => {
	it("voices each unique sentence once, then reuses every clip", async () => {
		const dir = tempDir("es-narr-");
		const plan = samplePlan();
		const f = fakeSpeak();
		const first = await voicePlan(plan, setup, { dir, speak: f.speak });
		// 7 sentences, one repeated: 6 clips made, the repeat is reused.
		expect(first).toMatchObject({ total: 7, made: 6, reused: 1 });
		const again = await voicePlan(plan, setup, { dir, speak: f.speak });
		expect(again).toMatchObject({ total: 7, made: 0, reused: 7 });
		expect(f.said).toHaveLength(6);
	});

	it("editing one sentence makes exactly one new clip (cache hits for the rest)", async () => {
		const dir = tempDir("es-narr-");
		const f = fakeSpeak();
		let plan = samplePlan();
		plan = applyVoice(plan, setup, (await voicePlan(plan, setup, { dir, speak: f.speak })).durations);
		const edited = editSentence(plan, "s3-n2", "Keys keep every record easy to find.");
		const r = await voicePlan(edited, setup, { dir, speak: f.speak });
		expect(r).toMatchObject({ total: 7, made: 1, reused: 6 });
		expect(f.said.at(-1)).toBe("Keys keep every record easy to find.");
		const after = applyVoice(edited, setup, r.durations);
		expect(narrationCounts(after, setup, dir)).toMatchObject({ total: 7, voiced: 7, pending: 0 });
	});

	it("a pronunciation rule re-voices only the sentences that contain the word, with the new text", async () => {
		const dir = tempDir("es-narr-");
		const f = fakeSpeak();
		const plan = samplePlan();
		await voicePlan(plan, setup, { dir, speak: f.speak });
		const withLex: VoiceSetup = { ...setup, lexicon: [{ word: "SQL", say: "sequel", matchCase: false }] };
		const r = await voicePlan(plan, withLex, { dir, speak: f.speak });
		expect(r.made).toBe(2);
		expect(f.said.slice(-2)).toEqual(["sequel lets you ask a database questions.", "You write sequel queries with SELECT."]);
		// The plan text is unchanged: only the sound is.
		const voiced = applyVoice(plan, withLex, r.durations);
		expect(voiced.chapters[0]!.scenes[0]!.narration[0]!.text).toBe("SQL lets you ask a database questions.");
		expect(narrationCounts(voiced, withLex, dir).pending).toBe(0);
		expect(narrationCounts(voiced, setup, dir).pending).toBe(2);
	});

	it("puts the measured lengths into the timeline, so cues fire when each sentence starts", async () => {
		const dir = tempDir("es-narr-");
		const f = fakeSpeak();
		const plan = samplePlan();
		const voiced = applyVoice(plan, setup, (await voicePlan(plan, setup, { dir, speak: f.speak })).durations);
		const s1 = voiced.chapters[0]!.scenes[0]!;
		expect(s1.narration.every((n) => n.audio && n.durationMs)).toBe(true);
		const t = computeTimeline(voiced).scenes[0]!;
		const ms = s1.narration.map((n) => 60 * n.text.length);
		expect(t.sentences.map((s) => s.estimated)).toEqual([false, false, false]);
		expect(t.sentences.map((s) => s.duration)).toEqual(ms.map((m) => msToFrames(m, 30)));
		const start2 = LEAD_IN_MS + ms[0]! + SENTENCE_GAP_MS;
		expect(t.sentences[1]!.from).toBe(msToFrames(start2, 30));
		// Default reveals: item 2 of 2 appears when sentence 2 (index 1) starts.
		expect(t.cues.find((c) => c.target === 1)!.frame).toBe(t.sentences[1]!.from);
		expect(t.sentences[0]!.audio).toBe(s1.narration[0]!.audio);
	});

	it("applying a run to a plan edited meanwhile leaves the edited sentence unvoiced", async () => {
		const dir = tempDir("es-narr-");
		const f = fakeSpeak();
		const plan = samplePlan();
		const run = await voicePlan(plan, setup, { dir, speak: f.speak });
		const edited = editSentence(plan, "s1-n1", "A new first sentence.");
		const out = applyVoice(edited, setup, run.durations);
		const n = out.chapters[0]!.scenes[0]!.narration;
		expect(n[0]).toEqual({ id: "s1-n1", text: "A new first sentence." });
		expect(n[1]!.audio).toBeTruthy();
	});

	it("stops between sentences and keeps the clips already made", async () => {
		const dir = tempDir("es-narr-");
		const f = fakeSpeak();
		const abort = new AbortController();
		const err = await voicePlan(samplePlan(), setup, { dir, speak: f.speak, signal: abort.signal, onProgress: (p) => p.done === 3 && abort.abort(new Error("stop")) }).catch((e) => e);
		expect(err.message).toBe("stop");
		expect(err.partial.made).toBe(3);
		expect(readdirSync(dir).filter((n) => n.endsWith(".wav"))).toHaveLength(3);
	});

	it("an engine failure keeps the clips already made", async () => {
		const dir = tempDir("es-narr-");
		const f = fakeSpeak();
		let n = 0;
		const failing: Speak = async (req) => {
			if (++n === 3) throw new Error("engine crashed");
			return f.speak(req);
		};
		const err = await voicePlan(samplePlan(), setup, { dir, speak: failing }).catch((e) => e);
		expect(err.message).toBe("engine crashed");
		expect(err.partial.durations.size).toBe(2);
	});

	it("lists the clips of a plan in order", () => {
		const c = plannedClips(samplePlan(), setup);
		expect(c.map((x) => x.sentenceId)).toEqual(["s1-n1", "s1-n2", "s1-n3", "s2-n1", "s2-n2", "s3-n1", "s3-n2"]);
		expect(c[1]!.clip).toBe(c[4]!.clip);
	});
});

describe("wav length", () => {
	it("reads the length from the header, also with extra chunks", async () => {
		const dir = tempDir("es-narr-");
		writeFileSync(join(dir, "a.wav"), wav(2310));
		writeFileSync(join(dir, "b.wav"), wav(1500, 22_050, true));
		writeFileSync(join(dir, "c.wav"), "not a wav");
		expect(await wavDurationMs(join(dir, "a.wav"))).toBe(2310);
		expect(await wavDurationMs(join(dir, "b.wav"))).toBe(1500);
		await expect(wavDurationMs(join(dir, "c.wav"))).rejects.toThrow(/Not a WAV/);
	});

	it("a broken cached clip is voiced again", async () => {
		const dir = tempDir("es-narr-");
		const f = fakeSpeak();
		const plan = samplePlan();
		const first = plannedClips(plan, setup)[0]!;
		writeFileSync(join(dir, first.clip), "broken");
		const r = await voicePlan(plan, setup, { dir, speak: f.speak });
		expect(r.made).toBe(6);
		expect(await wavDurationMs(join(dir, first.clip))).toBeGreaterThan(0);
	});
});

describe("old clips", () => {
	it("are removed only past the allowance, and only clip files", async () => {
		const dir = tempDir("es-narr-");
		const keep = "a".repeat(32) + ".wav";
		const old1 = "b".repeat(32) + ".wav";
		const old2 = "c".repeat(32) + ".wav";
		for (const n of [keep, old1, old2, "notes.txt", "x.wav.part"]) writeFileSync(join(dir, n), "x");
		expect(await pruneClips(dir, new Set([keep]), 2)).toBe(1);
		expect(existsSync(join(dir, old1))).toBe(true);
		expect(existsSync(join(dir, "x.wav.part"))).toBe(false);
		expect(await pruneClips(dir, new Set([keep]), 1)).toBe(2);
		expect(readdirSync(dir).sort()).toEqual([keep, "notes.txt"]);
	});
});

describe("es-media URLs", () => {
	const base = tempDir("es-media-");
	const root = join(base, "drafts");
	const roots = { drafts: root, assets: join(base, "assets") };
	const id = "0f8fad5b-d9cb-469f-a165-70867728950e";
	const clip = "0123456789abcdef0123456789abcdef.wav";
	it("map a clip URL to the draft's voice folder", () => {
		expect(audioBaseFor(id)).toBe(`es-media://voice/${id}/`);
		expect(mediaPath(`${audioBaseFor(id)}${clip}`, roots)).toBe(join(root, id, "voice", clip));
	});
	it("refuse anything else", () => {
		for (const bad of [
			`es-media://voice/${id}/../../secret.wav`,
			`es-media://voice/${id}/..%2F..%2Fsecret.wav`,
			`es-media://voice/${id}/${clip}?x=1`,
			`es-media://voice/${id}/${clip}#t`,
			`es-media://voice/${id}/sub/${clip}`,
			`es-media://voice/not-a-uuid/${clip}`,
			`es-media://voice/${id}/ABC.wav`,
			`es-media://voice/${id}/${clip.replace(".wav", ".exe")}`,
			`es-media://other/${id}/${clip}`,
			`file:///${root}/${id}/voice/${clip}`,
			`es-media://user:pw@voice/${id}/${clip}`,
			"not a url",
		])
			expect(mediaPath(bad, roots), bad).toBeNull();
	});
});
