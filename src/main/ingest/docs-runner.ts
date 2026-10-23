import { streamTool, ToolError } from "../security/exec";

export type DocsMessage = Record<string, unknown> & { type: string };
/** Runs one docs.py command; each JSON line it prints goes to onMessage. */
export type DocsRunner = (args: string[], onMessage: (m: DocsMessage) => void, signal?: AbortSignal) => Promise<void>;

export function createDocsRunner(opts: { python: string; script: string; env: NodeJS.ProcessEnv; log?: (msg: string) => void }): DocsRunner {
	return async (args, onMessage, signal) => {
		let fatal: string | null = null;
		try {
			await streamTool(opts.python, ["-I", "-u", opts.script, ...args], {
				env: opts.env,
				signal,
				timeoutMs: 60 * 60_000,
				onLine: (line, stream) => {
					if (stream === "stderr") {
						opts.log?.(line.slice(0, 400));
						return;
					}
					let m: DocsMessage;
					try {
						m = JSON.parse(line);
					} catch {
						opts.log?.(`non-protocol output: ${line.slice(0, 200)}`);
						return;
					}
					if (m.type === "fatal") fatal = String(m.error);
					else onMessage(m);
				},
			});
		} catch (err) {
			if (signal?.aborted) throw signal.reason ?? err;
			throw new Error(fatal ? `The document helper failed: ${fatal}` : err instanceof ToolError ? `The document helper failed: ${err.message}` : String(err));
		}
		if (fatal) throw new Error(`The document helper failed: ${fatal}`);
	};
}
