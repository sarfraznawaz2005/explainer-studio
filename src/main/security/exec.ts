import { execFile, spawn } from "node:child_process";
import { redact } from "./redact";

export type ToolResult = { code: number; stdout: string; stderr: string };

export class ToolError extends Error {
	constructor(
		message: string,
		readonly result?: ToolResult,
	) {
		super(redact(message));
		this.name = "ToolError";
	}
}

/**
 * Runs an external program (python, ffmpeg, ...) with an argument array.
 * Never uses a shell, so arguments are passed as-is and cannot inject commands.
 * .bat/.cmd files are refused because Windows would run them through cmd.exe.
 */
export function runTool(
	command: string,
	args: readonly string[],
	opts: { cwd?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv; maxBufferBytes?: number; signal?: AbortSignal } = {},
): Promise<ToolResult> {
	if (typeof command !== "string" || !command.trim()) return Promise.reject(new ToolError("No command given"));
	if (/\.(bat|cmd)$/i.test(command)) return Promise.reject(new ToolError("Batch files are not allowed"));
	if (!Array.isArray(args) || args.some((a) => typeof a !== "string" || a.includes("\0"))) {
		return Promise.reject(new ToolError("Arguments must be plain strings"));
	}
	return new Promise((resolvePromise, reject) => {
		execFile(
			command,
			args,
			{
				shell: false,
				windowsHide: true,
				cwd: opts.cwd,
				env: opts.env,
				timeout: opts.timeoutMs ?? 10 * 60_000,
				maxBuffer: opts.maxBufferBytes ?? 64 * 1024 * 1024,
				signal: opts.signal,
				encoding: "utf8",
			},
			(err, stdout, stderr) => {
				const result = { code: 0, stdout, stderr };
				if (!err) return resolvePromise(result);
				const e = err as NodeJS.ErrnoException & { code?: number | string; killed?: boolean };
				result.code = typeof e.code === "number" ? e.code : -1;
				if (e.code === "ENOENT") return reject(new ToolError(`Program not found: ${command}`, result));
				if (e.killed) return reject(new ToolError(`${command} was stopped (timeout or cancel)`, result));
				reject(new ToolError(`${command} failed (exit ${result.code}): ${stderr.trim().split("\n").slice(-3).join(" ")}`, result));
			},
		);
	});
}

/**
 * Like runTool, but streams output line by line (for progress) and keeps only
 * the last lines of each stream. Same rules: no shell, no batch files.
 */
export function streamTool(
	command: string,
	args: readonly string[],
	opts: { cwd?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv; signal?: AbortSignal; onLine?: (line: string, stream: "stdout" | "stderr") => void } = {},
): Promise<ToolResult> {
	if (typeof command !== "string" || !command.trim()) return Promise.reject(new ToolError("No command given"));
	if (/\.(bat|cmd)$/i.test(command)) return Promise.reject(new ToolError("Batch files are not allowed"));
	if (!Array.isArray(args) || args.some((a) => typeof a !== "string" || a.includes("\0"))) {
		return Promise.reject(new ToolError("Arguments must be plain strings"));
	}
	return new Promise((resolvePromise, reject) => {
		const child = spawn(command, args, { shell: false, windowsHide: true, cwd: opts.cwd, env: opts.env, stdio: ["ignore", "pipe", "pipe"], signal: opts.signal });
		const tails = { stdout: [] as string[], stderr: [] as string[] };
		const timer = setTimeout(() => child.kill(), opts.timeoutMs ?? 30 * 60_000);
		for (const stream of ["stdout", "stderr"] as const) {
			let buf = "";
			child[stream].setEncoding("utf8");
			child[stream].on("data", (d: string) => {
				buf += d;
				const lines = buf.split(/\r?\n|\r/);
				buf = lines.pop() ?? "";
				for (const line of lines) {
					if (!line.trim()) continue;
					tails[stream].push(line);
					if (tails[stream].length > 200) tails[stream].shift();
					opts.onLine?.(line, stream);
				}
			});
			child[stream].on("end", () => {
				if (buf.trim()) {
					tails[stream].push(buf);
					opts.onLine?.(buf, stream);
				}
			});
		}
		let failed: Error | null = null;
		child.on("error", (err: NodeJS.ErrnoException) => {
			failed = err.code === "ENOENT" ? new ToolError(`Program not found: ${command}`) : err.name === "AbortError" ? new ToolError(`${command} was cancelled`) : err;
		});
		child.on("close", (code, sig) => {
			clearTimeout(timer);
			const result = { code: code ?? -1, stdout: tails.stdout.join("\n"), stderr: tails.stderr.join("\n") };
			if (failed) return reject(failed instanceof ToolError ? new ToolError(failed.message, result) : failed);
			if (code === 0) return resolvePromise(result);
			if (sig || opts.signal?.aborted) return reject(new ToolError(`${command} was stopped (timeout or cancel)`, result));
			reject(new ToolError(`${command} failed (exit ${result.code}): ${(result.stderr || result.stdout).trim().split("\n").slice(-3).join(" ")}`, result));
		});
	});
}
