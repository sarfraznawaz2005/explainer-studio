import { PYTHON_MAX_EXCLUSIVE, PYTHON_MIN } from "@shared/ipc/voice";
import { runTool, type ToolResult } from "../security/exec";

export type PythonFound = { ok: true; exe: string; version: string };
export type PythonMissing = { ok: false; message: string };
export type Candidate = { command: string; args: string[] };
type Runner = (command: string, args: string[]) => Promise<ToolResult>;

const PROBE = "import json,struct,sys;print(json.dumps({'v':list(sys.version_info[:3]),'exe':sys.executable,'bits':struct.calcsize('P')*8}))";

const want = `${PYTHON_MIN.join(".")} to ${PYTHON_MAX_EXCLUSIVE[0]}.${PYTHON_MAX_EXCLUSIVE[1] - 1}`;

export const NO_PYTHON_MESSAGE =
	`Python is not installed, or Windows cannot find it. ` +
	`Install Python 3.12 from python.org. In the installer, tick "Add python.exe to PATH". Then press Check again.`;

/** Order of preference: the py launcher picks a specific version; plain `python` comes last. */
export function defaultCandidates(platform = process.platform): Candidate[] {
	if (platform !== "win32") return ["python3.13", "python3.12", "python3.11", "python3"].map((command) => ({ command, args: [] }));
	const versions: string[] = [];
	for (let minor = PYTHON_MAX_EXCLUSIVE[1] - 1; minor >= PYTHON_MIN[1]; minor--) versions.push(`-3.${minor}`);
	return [...versions.map((v) => ({ command: "py", args: [v] })), { command: "python", args: [] }, { command: "python3", args: [] }];
}

const inRange = (v: number[]) =>
	v[0] === PYTHON_MIN[0] && v[1]! >= PYTHON_MIN[1] && (v[0]! < PYTHON_MAX_EXCLUSIVE[0] || v[1]! < PYTHON_MAX_EXCLUSIVE[1]);

/**
 * Finds a 64-bit Python the voice packages support. Each candidate is run with a
 * tiny probe (no shell). The Microsoft Store stub and missing programs simply fail
 * the probe. Returns a friendly message instead of throwing.
 */
export async function findPython(opts: { candidates?: Candidate[]; run?: Runner; timeoutMs?: number } = {}): Promise<PythonFound | PythonMissing> {
	const run: Runner = opts.run ?? ((c, a) => runTool(c, a, { timeoutMs: opts.timeoutMs ?? 15_000, env: cleanPythonEnv() }));
	const wrong: string[] = [];
	for (const c of opts.candidates ?? defaultCandidates()) {
		let out: ToolResult;
		try {
			out = await run(c.command, [...c.args, "-I", "-c", PROBE]);
		} catch {
			continue;
		}
		let info: { v: number[]; exe: string; bits: number };
		try {
			info = JSON.parse(out.stdout.trim().split("\n").pop() ?? "");
		} catch {
			continue;
		}
		const version = info.v.join(".");
		if (info.bits !== 64) wrong.push(`${version} (32-bit)`);
		else if (!inRange(info.v)) wrong.push(version);
		else return { ok: true, exe: info.exe, version };
	}
	if (wrong.length) {
		const list = [...new Set(wrong)].join(", ");
		return {
			ok: false,
			message: `Found Python ${list}, but the voice engine needs 64-bit Python ${want}. Install Python 3.12 from python.org (keep your other Python), then press Check again.`,
		};
	}
	return { ok: false, message: NO_PYTHON_MESSAGE };
}

/** Environment for every Python the app starts: no inherited PYTHONPATH/PYTHONHOME, UTF-8 pipes. */
export function cleanPythonEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = {};
	for (const [k, v] of Object.entries(base)) if (!/^(PYTHON|PIP_|VIRTUAL_ENV|CONDA)/i.test(k)) env[k] = v;
	env.PYTHONUTF8 = "1";
	env.PYTHONIOENCODING = "utf-8";
	env.PYTHONNOUSERSITE = "1";
	return env;
}
