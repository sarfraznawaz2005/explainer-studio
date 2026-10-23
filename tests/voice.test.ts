import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { voiceChannels } from "../src/shared/ipc/voice";
import { parseInput } from "../src/main/ipc/validate";
import { streamTool, ToolError } from "../src/main/security/exec";
import { ChecksumError, downloadPinned } from "../src/main/voice/download";
import { createVoiceEngine } from "../src/main/voice/engine";
import { cleanPythonEnv, findPython, NO_PYTHON_MESSAGE } from "../src/main/voice/python";
import { createSidecar } from "../src/main/voice/sidecar";
import { describeVoices, langOf, PIPER_VOICES, sampleSentence } from "../src/main/voice/voices";
import { tempDir } from "./helpers";

const ok = (stdout: string) => Promise.resolve({ code: 0, stdout, stderr: "" });
const probe = (v: number[], bits = 64, exe = "C:\\Py\\python.exe") => ok(JSON.stringify({ v, exe, bits }));

describe("findPython", () => {
	it("gives the friendly fix message when nothing is installed", async () => {
		const r = await findPython({ candidates: [{ command: "py", args: ["-3.12"] }], run: () => Promise.reject(new Error("ENOENT")) });
		expect(r).toEqual({ ok: false, message: NO_PYTHON_MESSAGE });
		expect(NO_PYTHON_MESSAGE).toMatch(/python\.org/);
		expect(NO_PYTHON_MESSAGE).toMatch(/Add python\.exe to PATH/);
	});

	it("does not throw for a real missing program", async () => {
		const r = await findPython({ candidates: [{ command: "C:\\nope\\python.exe", args: [] }, { command: "es-no-such-python-xyz", args: [] }] });
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.message).toBe(NO_PYTHON_MESSAGE);
	});

	it("names a wrong version or a 32-bit Python", async () => {
		const r = await findPython({
			candidates: [
				{ command: "a", args: [] },
				{ command: "b", args: [] },
			],
			run: (c) => (c === "a" ? probe([3, 9, 7]) : probe([3, 12, 1], 32)),
		});
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.message).toMatch(/3\.9\.7, 3\.12\.1 \(32-bit\).*64-bit Python 3\.11 to 3\.13/);
	});

	it("takes the first supported 64-bit Python and skips junk output", async () => {
		const r = await findPython({
			candidates: [
				{ command: "stub", args: [] },
				{ command: "old", args: [] },
				{ command: "good", args: [] },
			],
			run: (c) => (c === "stub" ? ok("Python was not found; run without arguments to install from the Microsoft Store") : c === "old" ? probe([3, 14, 0]) : probe([3, 13, 5])),
		});
		expect(r).toEqual({ ok: true, exe: "C:\\Py\\python.exe", version: "3.13.5" });
	});

	it("strips inherited Python variables from the environment", () => {
		const env = cleanPythonEnv({ PATH: "x", PYTHONPATH: "evil", PYTHONHOME: "h", PIP_INDEX_URL: "u", VIRTUAL_ENV: "v" });
		expect(env).toMatchObject({ PATH: "x", PYTHONUTF8: "1", PYTHONNOUSERSITE: "1" });
		expect(env.PYTHONPATH).toBeUndefined();
		expect(env.PYTHONHOME).toBeUndefined();
		expect(env.PIP_INDEX_URL).toBeUndefined();
		expect(env.VIRTUAL_ENV).toBeUndefined();
	});
});

describe("pinned requirements", () => {
	it("pins every package to one version with sha256 hashes", () => {
		const text = readFileSync(resolve("resources/python/requirements.txt"), "utf8");
		const blocks = text.split(/\n(?=[a-z])/i).filter((b) => /^[a-z]/i.test(b));
		expect(blocks.length).toBeGreaterThan(8);
		for (const b of blocks) {
			expect(b).toMatch(/^[A-Za-z0-9._-]+==[\w.]+/);
			expect(b).toMatch(/--hash=sha256:[0-9a-f]{64}/);
		}
		expect(text).toMatch(/^kokoro-onnx==0\.6\.1/m);
		expect(text).toMatch(/^onnxruntime==/m);
	});
});

describe("streamTool", () => {
	it("streams lines and fails with a ToolError on a non-zero exit", async () => {
		const lines: string[] = [];
		const r = await streamTool(process.execPath, ["-e", "console.log('one');console.error('two');console.log('three')"], { onLine: (l) => lines.push(l) });
		expect(r.code).toBe(0);
		expect(lines.sort()).toEqual(["one", "three", "two"]);
		await expect(streamTool(process.execPath, ["-e", "console.error('bad thing');process.exit(3)"])).rejects.toBeInstanceOf(ToolError);
		await expect(streamTool("x.cmd", [])).rejects.toThrow(/Batch files/);
	});

	it("stops the program on cancel", async () => {
		const ac = new AbortController();
		const p = streamTool(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], { signal: ac.signal });
		setTimeout(() => ac.abort(), 200);
		await expect(p).rejects.toThrow(/cancelled|stopped/);
	});
});

describe("downloadPinned", () => {
	const body = Buffer.alloc(300_000, 7);
	const sha = createHash("sha256").update(body).digest("hex");
	let server: Server;
	let base = "";
	beforeAll(async () => {
		server = createServer((req, res) => {
			if (req.url === "/missing") {
				res.statusCode = 404;
				return res.end();
			}
			res.setHeader("content-length", String(body.length));
			res.end(body);
		});
		await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
		base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	});
	afterAll(() => server.close());

	it("writes the file only when size and hash match, with progress", async () => {
		const dir = tempDir();
		const dest = join(dir, "m.bin");
		const seen: number[] = [];
		await downloadPinned({ url: `${base}/m.bin`, bytes: body.length, sha256: sha }, dest, { onBytes: (d) => seen.push(d) });
		expect(readFileSync(dest).equals(body)).toBe(true);
		expect(seen.at(-1)).toBe(body.length);
		expect(existsSync(`${dest}.part`)).toBe(false);
	});

	it("deletes a file with the wrong checksum and leaves nothing behind", async () => {
		const dir = tempDir();
		const dest = join(dir, "m.bin");
		await expect(downloadPinned({ url: `${base}/m.bin`, bytes: body.length, sha256: "0".repeat(64) }, dest)).rejects.toBeInstanceOf(ChecksumError);
		expect(existsSync(dest)).toBe(false);
		expect(existsSync(`${dest}.part`)).toBe(false);
	});

	it("stops a download that is larger than pinned, refuses plain http and reports HTTP errors", async () => {
		const dest = join(tempDir(), "m.bin");
		await expect(downloadPinned({ url: `${base}/m.bin`, bytes: 1000, sha256: sha }, dest)).rejects.toThrow(/larger than expected/);
		expect(existsSync(`${dest}.part`)).toBe(false);
		await expect(downloadPinned({ url: "http://example.com/m.bin", bytes: 1, sha256: sha }, dest)).rejects.toThrow(/https/);
		await expect(downloadPinned({ url: `${base}/missing`, bytes: 1, sha256: sha }, dest)).rejects.toThrow(/HTTP 404/);
	});
});

describe("sidecar protocol", () => {
	/** A stand-in for tts.py written in JS: same JSON-lines protocol. */
	const fake = `
const rl = require("readline").createInterface({ input: process.stdin });
const send = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
if (process.argv[2] === "fatal") { send({ type: "fatal", error: "ModuleNotFoundError: kokoro_onnx" }); process.exit(1); }
console.error("loading model");
send({ type: "ready", voices: ["af_heart", "bm_george"], python: "3.13.5" });
rl.on("line", (l) => {
	const r = JSON.parse(l);
	if (r.cmd === "speak") send({ id: r.id, ok: true, durationMs: r.text.length * 50 });
	else if (r.cmd === "crash") process.exit(7);
	else if (r.cmd === "quit") process.exit(0);
	else send({ id: r.id, ok: false, error: "Unknown command: " + r.cmd });
});`;
	const script = join(tempDir(), "fake-tts.cjs");
	writeFileSync(script, fake);

	it("answers requests, reports errors and survives a crash", async () => {
		const logs: string[] = [];
		const sc = createSidecar({ command: process.execPath, args: [script], log: (_l, m) => logs.push(m) });
		const info = await sc.start();
		expect(info.voices).toEqual(["af_heart", "bm_george"]);
		expect(await sc.request<{ durationMs: number }>("speak", { text: "hello" })).toMatchObject({ ok: true, durationMs: 250 });
		await expect(sc.request("nope")).rejects.toThrow(/Unknown command/);
		await expect(sc.request("crash")).rejects.toThrow(/stopped \(code 7\)/);
		// The next request starts a fresh process.
		expect(await sc.request<{ durationMs: number }>("speak", { text: "hi" })).toMatchObject({ durationMs: 100 });
		expect(logs.some((l) => l.includes("loading model"))).toBe(true);
		sc.stop();
	});

	it("turns a start failure into a readable error", async () => {
		const sc = createSidecar({ command: process.execPath, args: [script, "fatal"] });
		await expect(sc.start()).rejects.toThrow(/could not start: ModuleNotFoundError/);
		const missing = createSidecar({ command: "C:\\nope\\python.exe", args: [] });
		await expect(missing.start()).rejects.toThrow(/Could not start the voice engine/);
	});
});

describe("voice engine status", () => {
	const files = {
		model: { file: "m.onnx", url: "https://example.invalid/m", bytes: 10, sha256: "a".repeat(64) },
		voices: { file: "v.bin", url: "https://example.invalid/v", bytes: 5, sha256: "b".repeat(64) },
	};
	const setup = () => {
		const root = tempDir();
		const scripts = join(root, "scripts");
		mkdirSync(scripts);
		writeFileSync(join(scripts, "requirements.txt"), "kokoro-onnx==0.6.1 \\\n    --hash=sha256:" + "c".repeat(64) + "\n");
		return { root, scripts };
	};

	it("reports no-python with the fix message, then not-installed with the download size", async () => {
		const { root, scripts } = setup();
		const none = createVoiceEngine({ root, scriptsDir: scripts, files, findPython: async () => ({ ok: false, message: NO_PYTHON_MESSAGE }) });
		const s1 = await none.status();
		expect(s1).toMatchObject({ state: "no-python", pythonProblem: NO_PYTHON_MESSAGE, python: null });
		const found = createVoiceEngine({ root, scriptsDir: scripts, files, findPython: async () => ({ ok: true, exe: "C:\\Py\\python.exe", version: "3.12.4" }) });
		const s2 = await found.status();
		expect(s2.state).toBe("not-installed");
		expect(s2.python?.version).toBe("3.12.4");
		expect(s2.downloadBytes).toBeGreaterThan(15);
	});

	it("spots a broken venv, missing models and outdated packages", async () => {
		const { root, scripts } = setup();
		const engine = createVoiceEngine({ root, scriptsDir: scripts, files, findPython: async () => ({ ok: false, message: "x" }) });
		const reqHash = createHash("sha256").update(readFileSync(join(scripts, "requirements.txt"))).digest("hex");
		writeFileSync(join(root, "env.json"), JSON.stringify({ requirementsHash: reqHash, python: { exe: "C:\\Py\\python.exe", version: "3.12.4" }, installedAt: new Date().toISOString() }));
		expect((await engine.status()).state).toBe("broken");

		// A venv whose base Python exists (we point "home" at a folder holding a python file).
		const home = join(root, "basepy");
		mkdirSync(home);
		writeFileSync(join(home, process.platform === "win32" ? "python.exe" : "python3"), "");
		mkdirSync(join(engine.paths.venvPython, ".."), { recursive: true });
		writeFileSync(engine.paths.venvPython, "");
		writeFileSync(join(engine.paths.venv, "pyvenv.cfg"), `home = ${home}\n`);
		const noModels = await engine.status();
		expect(noModels).toMatchObject({ state: "broken" });
		expect(noModels.problem).toMatch(/model files are missing/);

		mkdirSync(engine.paths.modelsDir);
		writeFileSync(join(engine.paths.modelsDir, "m.onnx"), Buffer.alloc(10));
		writeFileSync(join(engine.paths.modelsDir, "v.bin"), Buffer.alloc(5));
		expect(await engine.status()).toMatchObject({ state: "ready", downloadBytes: 0 });

		writeFileSync(join(scripts, "requirements.txt"), "kokoro-onnx==0.7.0\n");
		expect(await engine.status()).toMatchObject({ state: "outdated" });
	});

	it("refuses to speak before install and fails an install cleanly without Python", async () => {
		const { root, scripts } = setup();
		const progress: string[] = [];
		const engine = createVoiceEngine({
			root,
			scriptsDir: scripts,
			files,
			findPython: async () => ({ ok: false, message: NO_PYTHON_MESSAGE }),
			onProgress: (p) => progress.push(`${p.step}:${p.error ?? ""}`),
		});
		await expect(engine.speak({ text: "hi", voice: "af_heart", speed: 1, out: join(root, "a.wav") })).rejects.toThrow(/not installed/);
		await engine.install(false);
		expect(progress.at(-1)).toBe(`error:${NO_PYTHON_MESSAGE}`);
		expect(engine.isInstalling()).toBe(false);
	});

	it("downloads a Piper voice on first use and keeps nothing when the download is wrong", async () => {
		const { root, scripts } = setup();
		const urls: string[] = [];
		const fetchImpl = (async (url: string) => {
			urls.push(url);
			return new Response(new Uint8Array(PIPER_VOICES.ur_fasih!.model.bytes));
		}) as unknown as typeof fetch;
		const engine = createVoiceEngine({ root, scriptsDir: scripts, files, fetchImpl, findPython: async () => ({ ok: false, message: "x" }) });
		writeFileSync(join(root, "env.json"), JSON.stringify({ requirementsHash: "x", python: { exe: "p", version: "3.12.4" }, installedAt: "" }));
		expect(engine.piperDownloaded("ur_fasih")).toBe(false);
		expect(engine.piperDownloaded("af_heart")).toBe(false);
		await expect(engine.speak({ text: "سلام", voice: "ur_fasih", speed: 1, out: join(root, "a.wav") })).rejects.toThrow(/Could not download this voice/);
		expect(urls).toEqual([PIPER_VOICES.ur_fasih!.model.url]);
		expect(urls[0]).toMatch(/^https:\/\/huggingface\.co\/rhasspy\/piper-voices\/resolve\/[0-9a-f]{40}\//);
		expect(existsSync(join(engine.paths.modelsDir, "piper", "ur_PK-fasih-medium.onnx"))).toBe(false);
		expect(existsSync(join(engine.paths.modelsDir, "piper", "ur_PK-fasih-medium.onnx.part"))).toBe(false);
	});
});

describe("voices", () => {
	it("offers English top picks first, then Kokoro and Piper voices by language", () => {
		const v = describeVoices(["zf_xiaobei", "am_adam", "af_heart", "hf_alpha", "bf_emma", "jf_alpha", "bm_lewis", "ef_dora"], (id) => id === "ur_aegis");
		expect(v.map((x) => x.id)).toEqual(["af_heart", "bf_emma", "am_adam", "bm_lewis", "hf_alpha", "ef_dora", "ur_aegis", "ur_fasih"]);
		expect(v[0]).toEqual({ id: "af_heart", name: "Heart", accent: "American", group: "American English", language: "en", gender: "female", recommended: true, engine: "kokoro", downloadBytes: 0 });
		expect(v.find((x) => x.id === "hf_alpha")).toMatchObject({ language: "hi", group: "Hindi", engine: "kokoro" });
		expect(v.find((x) => x.id === "ur_aegis")).toMatchObject({ language: "ur", engine: "piper", gender: "female", downloadBytes: 0 });
		expect(v.find((x) => x.id === "ur_fasih")!.downloadBytes).toBeGreaterThan(60_000_000);
		// Voice ids pass the IPC check; espeak gets the right language for each Kokoro voice.
		for (const x of v) expect(() => parseInput(voiceChannels.preview, { voice: x.id, speed: 1 })).not.toThrow();
		expect([langOf("bf_emma"), langOf("am_adam"), langOf("hf_alpha"), langOf("ef_dora"), langOf("pf_dora")]).toEqual(["en-gb", "en-us", "hi", "es", "pt-br"]);
		expect(sampleSentence({ name: "Fasih", language: "ur" })).toMatch(/میں Fasih ہوں/);
	});

	it("validates voice IPC input", () => {
		expect(() => parseInput(voiceChannels.preview, { voice: "../evil", speed: 1 })).toThrow();
		expect(() => parseInput(voiceChannels.preview, { voice: "af_heart", speed: 5 })).toThrow();
		expect(() => parseInput(voiceChannels.preview, { voice: "af_heart", speed: 1, text: "x".repeat(301) })).toThrow();
		expect(() => parseInput(voiceChannels.install, { repair: "yes" })).toThrow();
		expect(parseInput(voiceChannels.preview, { voice: "af_heart", speed: 1.25, text: "  Hello  " })).toEqual({ voice: "af_heart", speed: 1.25, text: "Hello" });
		expect(parseInput(voiceChannels.setSettings, { voice: "bm_george", speed: 0.5 })).toEqual({ voice: "bm_george", speed: 0.5 });
	});
});
