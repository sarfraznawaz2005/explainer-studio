import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { PACKAGES_BYTES_ESTIMATE, VoiceId, type InstallProgress, type InstallStep, type VoiceState } from "@shared/ipc/voice";
import { folderSize } from "../app/folders";
import { createDocsRunner, type DocsRunner } from "../ingest/docs-runner";
import { streamTool, ToolError } from "../security/exec";
import { downloadPinned, isPinnedFile, type Pinned } from "./download";
import { cleanPythonEnv, findPython, type PythonFound, type PythonMissing } from "./python";
import { createSidecar, type ReadyInfo, type Sidecar } from "./sidecar";
import { langOf, piperVoice } from "./voices";

/** Kokoro v1.0 model files from the kokoro-onnx GitHub release. Hashes were measured once and pinned. */
export const KOKORO_FILES = {
	model: {
		file: "kokoro-v1.0.onnx",
		url: "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx",
		bytes: 325_532_387,
		sha256: "7d5df8ecf7d4b1878015a32686053fd0eebe2bc377234608764cc0ef3636a6c5",
	},
	voices: {
		file: "voices-v1.0.bin",
		url: "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin",
		bytes: 28_214_398,
		sha256: "bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d",
	},
} satisfies Record<string, Pinned & { file: string }>;


type Marker = { requirementsHash: string; python: { exe: string; version: string }; installedAt: string };
type Files = Record<keyof typeof KOKORO_FILES, Pinned & { file: string }>;

/** A message meant for the user as-is (no stack, no jargon). */
export class VoiceError extends Error {
	constructor(
		message: string,
		readonly detail?: string,
	) {
		super(message);
		this.name = "VoiceError";
	}
}

export type EngineDeps = {
	/** App-owned folder for the venv, models and marker (<userData>/python). */
	root: string;
	/** Folder with tts.py and requirements.txt. */
	scriptsDir: string;
	findPython?: () => Promise<PythonFound | PythonMissing>;
	fetchImpl?: typeof fetch;
	files?: Files;
	log?: (level: "info" | "warn" | "error", msg: string) => void;
	onProgress?: (p: InstallProgress) => void;
	idleMs?: number;
};

/** Weight of each step in the overall progress bar. */
const SPAN: Record<"python" | "venv" | "packages" | "models" | "verify", [number, number]> = {
	python: [0, 0.02],
	venv: [0.02, 0.1],
	packages: [0.1, 0.45],
	models: [0.45, 0.96],
	verify: [0.96, 1],
};

/**
 * The local Kokoro voice: an app-owned Python venv with hash-pinned packages,
 * checksummed model files, and a long-running tts.py sidecar.
 */
export function createVoiceEngine(deps: EngineDeps) {
	const log = deps.log ?? (() => {});
	const files = deps.files ?? KOKORO_FILES;
	const win = process.platform === "win32";
	const venv = join(deps.root, "venv");
	const venvPython = join(venv, win ? "Scripts/python.exe" : "bin/python");
	const modelsDir = join(deps.root, "models");
	const markerFile = join(deps.root, "env.json");
	const requirements = join(deps.scriptsDir, "requirements.txt");
	const script = join(deps.scriptsDir, "tts.py");
	const modelPath = (k: keyof Files) => join(modelsDir, files[k].file);
	/** Piper voices (Urdu) live here, downloaded on first use. */
	const piperDir = join(modelsDir, "piper");
	const piperFiles = (id: string) => {
		const p = piperVoice(id)!;
		return [
			{ pin: p.model, path: join(piperDir, `${p.key}.onnx`) },
			{ pin: p.config, path: join(piperDir, `${p.key}.onnx.json`) },
		];
	};
	const sizeIs = (path: string, bytes: number) => {
		try {
			return statSync(path).size === bytes;
		} catch {
			return false;
		}
	};
	const piperDownloaded = (id: string) => !!piperVoice(id) && piperFiles(id).every((f) => sizeIs(f.path, f.pin.bytes));
	const piperJobs = new Map<string, Promise<void>>();

	let job: { progress: InstallProgress; abort: AbortController; done: Promise<void> } | null = null;
	let last: InstallProgress | null = null;
	let sidecar: Sidecar | null = null;

	const requirementsHash = () => createHash("sha256").update(readFileSync(requirements)).digest("hex");
	const readMarker = (): Marker | null => {
		try {
			return JSON.parse(readFileSync(markerFile, "utf8")) as Marker;
		} catch {
			return null;
		}
	};

	/** The base Python a venv was made from must still exist, or the venv cannot start. */
	const venvBaseOk = (): boolean => {
		try {
			const home = /^home\s*=\s*(.+)$/m.exec(readFileSync(join(venv, "pyvenv.cfg"), "utf8"))?.[1]?.trim();
			return !!home && existsSync(join(home, win ? "python.exe" : "python3"));
		} catch {
			return false;
		}
	};

	const report = (step: InstallStep, progress: number, detail?: string, error?: string) => {
		if (!job) return;
		job.progress = { step, progress: Math.max(0, Math.min(1, progress)), detail, error, startedAt: job.progress.startedAt };
		last = job.progress;
		deps.onProgress?.(job.progress);
	};
	const at = (s: keyof typeof SPAN, f: number) => SPAN[s][0] + (SPAN[s][1] - SPAN[s][0]) * Math.max(0, Math.min(1, f));

	/** Deletes a folder, but only one inside the engine root. */
	const removeInside = async (dir: string) => {
		const rel = relative(deps.root, dir);
		if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new Error(`Refusing to delete outside the voice folder: ${dir}`);
		await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
	};

	async function missingModelBytes(): Promise<number> {
		let n = 0;
		for (const k of Object.keys(files) as (keyof Files)[]) if (!(await isPinnedFile(modelPath(k), files[k], false))) n += files[k].bytes;
		return n;
	}

	async function status(): Promise<{
		state: VoiceState;
		python: { exe: string; version: string } | null;
		pythonProblem: string | null;
		problem: string | null;
		folder: string;
		sizeBytes: number;
		installedAt: string | null;
		install: InstallProgress | null;
		downloadBytes: number;
	}> {
		const marker = readMarker();
		const sizeBytes = (await folderSize(deps.root)).bytes;
		const base = { folder: deps.root, sizeBytes, installedAt: marker?.installedAt ?? null, install: job?.progress ?? last };
		const modelsMissing = await missingModelBytes();
		const downloadBytes = modelsMissing + (marker ? 0 : PACKAGES_BYTES_ESTIMATE);
		if (job) return { ...base, state: "installing", python: marker?.python ?? null, pythonProblem: null, problem: null, downloadBytes };
		if (marker) {
			const python = marker.python;
			if (!existsSync(venvPython) || !venvBaseOk())
				return {
					...base,
					state: "broken",
					python,
					pythonProblem: null,
					problem: "The voice engine's Python was removed or moved. Press Repair to rebuild it.",
					downloadBytes,
				};
			if (modelsMissing)
				return { ...base, state: "broken", python, pythonProblem: null, problem: "Voice model files are missing. Press Repair to download them again.", downloadBytes };
			if (marker.requirementsHash !== requirementsHash())
				return {
					...base,
					state: "outdated",
					python,
					pythonProblem: null,
					problem: "This version of the app needs new packages (for reading scanned pages and figures). Press Repair to update them.",
					downloadBytes,
				};
			return { ...base, state: "ready", python, pythonProblem: null, problem: null, downloadBytes: 0 };
		}
		const py = await (deps.findPython ?? findPython)();
		if (!py.ok) return { ...base, state: "no-python", python: null, pythonProblem: py.message, problem: null, downloadBytes };
		return { ...base, state: "not-installed", python: { exe: py.exe, version: py.version }, pythonProblem: null, problem: null, downloadBytes };
	}

	async function runInstall(repair: boolean, signal: AbortSignal): Promise<void> {
		report("python", 0, "Looking for Python");
		const py = await (deps.findPython ?? findPython)();
		if (!py.ok) throw new VoiceError(py.message);
		log("info", `install start (repair=${repair}) with Python ${py.version} at ${py.exe}`);

		// A half-finished install never looks ready: the marker goes first.
		await rm(markerFile, { force: true });
		stopSidecar();
		if (repair || existsSync(venv)) {
			report("venv", at("venv", 0), repair ? "Removing the old environment" : "Cleaning up an unfinished install");
			await removeInside(venv);
		}
		if (signal.aborted) throw signal.reason;

		report("venv", at("venv", 0.1), `Creating the environment with Python ${py.version}`);
		const env = cleanPythonEnv();
		await streamTool(py.exe, ["-I", "-m", "venv", venv], { env, signal, timeoutMs: 5 * 60_000, onLine: (l) => log("info", `[venv] ${l}`) });
		if (!existsSync(venvPython)) throw new VoiceError("Python could not create the environment.", "venv python missing after python -m venv");

		const names = new Set(
			readFileSync(requirements, "utf8")
				.split(/\r?\n/)
				.map((l) => /^([A-Za-z0-9._-]+)==/.exec(l)?.[1]?.toLowerCase())
				.filter(Boolean) as string[],
		);
		const seen = new Set<string>();
		report("packages", at("packages", 0), `Downloading ${names.size} packages`);
		try {
			await streamTool(
				venvPython,
				[
					"-I",
					"-u",
					"-m",
					"pip",
					"install",
					"--isolated",
					"--no-input",
					"--disable-pip-version-check",
					"--require-hashes",
					"--only-binary",
					":all:",
					"--no-deps",
					"--progress-bar",
					"off",
					"-r",
					requirements,
				],
				{
					env,
					signal,
					timeoutMs: 30 * 60_000,
					onLine: (line) => {
						log("info", `[pip] ${line}`);
						const m = /^\s*(?:Collecting|Downloading|Using cached)\s+([A-Za-z0-9._-]+?)(?:==|-\d|\s|$)/.exec(line);
						if (m) {
							const name = m[1]!.toLowerCase().replace(/_/g, "-");
							seen.add(name);
							report("packages", at("packages", (0.85 * seen.size) / names.size), `Downloading packages (${Math.min(seen.size, names.size)} of ${names.size})`);
						} else if (/^Installing collected packages/.test(line)) report("packages", at("packages", 0.88), "Installing packages");
						else if (/^Successfully installed/.test(line)) report("packages", at("packages", 1), "Packages installed");
					},
				},
			);
		} catch (err) {
			if (signal.aborted) throw signal.reason;
			const out = err instanceof ToolError ? `${err.result?.stderr ?? ""}\n${err.result?.stdout ?? ""}` : String(err);
			const offline = /(connection|resolve|timed out|getaddrinfo|ProxyError|SSLError|Network is unreachable)/i.test(out);
			throw new VoiceError(
				offline
					? "Could not download the voice packages. Check your internet connection, then try again."
					: "The voice packages could not be installed. See the voice log for details, then try Repair.",
				out.trim().split("\n").slice(-5).join("\n"),
			);
		}

		await mkdir(modelsDir, { recursive: true });
		const keys = Object.keys(files) as (keyof Files)[];
		const total = keys.reduce((n, k) => n + files[k].bytes, 0);
		let doneBefore = 0;
		for (const k of keys) {
			const f = files[k];
			report("models", at("models", doneBefore / total), `Checking ${f.file}`);
			if (!(await isPinnedFile(modelPath(k), f))) {
				await rm(modelPath(k), { force: true });
				await downloadPinned(f, modelPath(k), {
					signal,
					fetchImpl: deps.fetchImpl,
					onBytes: (d) => report("models", at("models", (doneBefore + d) / total), `Downloading ${f.file}: ${mb(d)} of ${mb(f.bytes)}`),
				});
			}
			doneBefore += f.bytes;
		}

		report("verify", at("verify", 0), "Testing the voice");
		const test = join(deps.root, "check.wav");
		const r = await speak({ text: "The voice engine is ready.", voice: "af_heart", speed: 1, out: test }, true);
		await rm(test, { force: true });
		if (!(r.durationMs > 300)) throw new VoiceError("The voice test made no sound.", `durationMs=${r.durationMs}`);

		const marker: Marker = { requirementsHash: requirementsHash(), python: { exe: py.exe, version: py.version }, installedAt: new Date().toISOString() };
		await writeFile(markerFile, JSON.stringify(marker, null, 2));
		log("info", `install done; test sentence ${r.durationMs} ms`);
	}

	function install(repair: boolean): Promise<void> {
		if (job) throw new VoiceError("The voice engine is already being installed.");
		const abort = new AbortController();
		job = { abort, progress: { step: "python", progress: 0, startedAt: new Date().toISOString() }, done: Promise.resolve() };
		const current = job;
		current.done = runInstall(repair, abort.signal).then(
			() => {
				report("done", 1, "The voice engine is ready");
				job = null;
			},
			(err: unknown) => {
				stopSidecar();
				const cancelled = abort.signal.aborted;
				const e = err as Error;
				log(cancelled ? "info" : "error", `install ${cancelled ? "cancelled" : "failed"}: ${e?.message}${err instanceof VoiceError && err.detail ? ` | ${err.detail}` : ""}`);
				report(
					cancelled ? "cancelled" : "error",
					current.progress.progress,
					cancelled ? "Install cancelled" : undefined,
					cancelled ? undefined : err instanceof VoiceError ? err.message : `The install failed: ${e?.message ?? String(err)}`,
				);
				job = null;
			},
		);
		return current.done;
	}

	function cancel(): void {
		job?.abort.abort(new VoiceError("Install cancelled"));
	}

	function getSidecar(): Sidecar {
		if (!sidecar) {
			sidecar = createSidecar({
				command: venvPython,
				args: ["-I", "-u", script, "--model", modelPath("model"), "--voices", modelPath("voices"), "--piper-dir", piperDir],
				env: cleanPythonEnv(),
				idleMs: deps.idleMs ?? 10 * 60_000,
				log: (level, msg) => log(level, `[tts] ${msg}`),
			});
		}
		return sidecar;
	}

	function stopSidecar(): void {
		sidecar?.stop();
	}

	/** Downloads a Piper voice once (pinned size and SHA-256). Calls for the same voice share one download. */
	function ensurePiper(id: string): Promise<void> {
		if (piperDownloaded(id)) return Promise.resolve();
		let p = piperJobs.get(id);
		if (!p) {
			p = (async () => {
				await mkdir(piperDir, { recursive: true });
				log("info", `downloading Piper voice ${id}`);
				for (const f of piperFiles(id)) {
					if (await isPinnedFile(f.path, f.pin)) continue;
					await rm(f.path, { force: true });
					await downloadPinned(f.pin, f.path, { fetchImpl: deps.fetchImpl });
				}
				log("info", `Piper voice ${id} ready`);
			})()
				.catch((err: unknown) => {
					log("error", `Piper voice ${id} download failed: ${(err as Error)?.message}`);
					throw new VoiceError("Could not download this voice. Check your internet connection, then try again.", (err as Error)?.message);
				})
				.finally(() => piperJobs.delete(id));
			piperJobs.set(id, p);
		}
		return p;
	}

	/**
	 * Speaks one piece of text into a WAV file. `out` is chosen by main code, never the renderer.
	 * Returns the file path and the measured duration.
	 */
	async function speak(
		req: { text: string; voice: string; speed: number; out: string },
		duringInstall = false,
	): Promise<{ path: string; durationMs: number }> {
		if (job && !duringInstall) throw new VoiceError("The voice engine is being installed. Try again when it is done.");
		if (!duringInstall && !readMarker()) throw new VoiceError("The voice engine is not installed. Install it in Settings → Voice.");
		VoiceId.parse(req.voice);
		if (!isAbsolute(req.out) || !/\.wav$/i.test(req.out)) throw new Error("Output must be an absolute .wav path");
		const piper = piperVoice(req.voice);
		if (piper) await ensurePiper(req.voice);
		const r = await getSidecar().request<{ durationMs: number }>(
			"speak",
			piper
				? { text: req.text, piper: piper.key, speed: req.speed, out: req.out }
				: { text: req.text, voice: req.voice, speed: req.speed, lang: langOf(req.voice), out: req.out },
		);
		return { path: req.out, durationMs: r.durationMs };
	}

	async function voiceIds(): Promise<string[]> {
		if (job) throw new VoiceError("The voice engine is being installed. Try again when it is done.");
		if (!readMarker()) throw new VoiceError("The voice engine is not installed. Install it in Settings → Voice.");
		const info: ReadyInfo = await getSidecar().start();
		return info.voices;
	}

	/** Installed, up to date and not busy: the document helper can run. */
	function isReady(): boolean {
		const m = readMarker();
		return !!m && !job && existsSync(venvPython) && m.requirementsHash === requirementsHash();
	}

	/** Runs docs.py (PDF pages, figures, local OCR) in the same environment. Null when not ready. */
	function docsRunner(): DocsRunner | null {
		if (!isReady()) return null;
		return createDocsRunner({ python: venvPython, script: join(deps.scriptsDir, "docs.py"), env: cleanPythonEnv(), log: (m) => log("info", `[docs] ${m}`) });
	}

	return {
		paths: { root: deps.root, venv, venvPython, modelsDir, markerFile },
		isReady,
		docsRunner,
		status,
		install,
		cancel,
		isInstalling: () => !!job,
		speak,
		voiceIds,
		piperDownloaded,
		stop: stopSidecar,
		readWav: (path: string) => readFile(path),
	};
}

const mb = (n: number) => `${(n / 1_000_000).toFixed(0)} MB`;

export type VoiceEngine = ReturnType<typeof createVoiceEngine>;
