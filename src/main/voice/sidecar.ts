import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";

export type ReadyInfo = { voices: string[]; python?: string; kokoro?: string; onnxruntime?: string; loadMs?: number };
type Pending = { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void; timer: NodeJS.Timeout };

export type SidecarOptions = {
	command: string;
	args: string[];
	env?: NodeJS.ProcessEnv;
	/** Time allowed for the model to load. */
	startTimeoutMs?: number;
	requestTimeoutMs?: number;
	/** Stop the process after this long without requests (frees ~500 MB of RAM). 0 = never. */
	idleMs?: number;
	log?: (level: "info" | "warn" | "error", msg: string) => void;
};

/**
 * A long-running helper process that speaks JSON lines. Started on first use,
 * restarted after a crash, stopped when idle. One request at a time is enough:
 * the Python side handles them in order.
 */
export function createSidecar(opts: SidecarOptions) {
	let child: ChildProcessWithoutNullStreams | null = null;
	let ready: Promise<ReadyInfo> | null = null;
	let idleTimer: NodeJS.Timeout | null = null;
	let nextId = 1;
	const pending = new Map<string, Pending>();
	const log = opts.log ?? (() => {});

	const failAll = (err: Error) => {
		for (const [id, p] of pending) {
			clearTimeout(p.timer);
			p.reject(err);
			pending.delete(id);
		}
	};

	const armIdle = () => {
		if (idleTimer) clearTimeout(idleTimer);
		if (!opts.idleMs) return;
		idleTimer = setTimeout(() => {
			if (pending.size === 0) {
				log("info", "idle, stopping");
				stop();
			} else armIdle();
		}, opts.idleMs);
		idleTimer.unref();
	};

	function start(): Promise<ReadyInfo> {
		if (ready) return ready;
		if (/\.(bat|cmd)$/i.test(opts.command)) return Promise.reject(new Error("Batch files are not allowed"));
		const p = spawn(opts.command, opts.args, { shell: false, windowsHide: true, env: opts.env, stdio: "pipe" });
		child = p;
		let stderrTail = "";
		ready = new Promise<ReadyInfo>((resolve, reject) => {
			const timer = setTimeout(() => {
				reject(new Error("The voice engine took too long to start."));
				p.kill();
			}, opts.startTimeoutMs ?? 90_000);
			p.on("error", (err) => {
				clearTimeout(timer);
				reject(new Error(`Could not start the voice engine: ${err.message}`));
			});
			p.stderr.setEncoding("utf8");
			p.stderr.on("data", (d: string) => {
				stderrTail = (stderrTail + d).slice(-2000);
				for (const line of d.split(/\r?\n/)) if (line.trim()) log("warn", line.trim().slice(0, 500));
			});
			createInterface({ input: p.stdout }).on("line", (line) => {
				let msg: Record<string, unknown>;
				try {
					msg = JSON.parse(line);
				} catch {
					log("warn", `non-protocol output: ${line.slice(0, 200)}`);
					return;
				}
				if (msg.type === "ready") {
					clearTimeout(timer);
					log("info", `ready: python ${msg.python}, kokoro ${msg.kokoro}, onnxruntime ${msg.onnxruntime}, model loaded in ${msg.loadMs} ms`);
					resolve(msg as unknown as ReadyInfo);
					return;
				}
				if (msg.type === "fatal") {
					clearTimeout(timer);
					reject(new Error(`The voice engine could not start: ${String(msg.error)}`));
					return;
				}
				const id = String(msg.id);
				const req = pending.get(id);
				if (!req) return;
				pending.delete(id);
				clearTimeout(req.timer);
				if (msg.ok) req.resolve(msg);
				else req.reject(new Error(String(msg.error ?? "The voice engine failed")));
			});
			p.on("exit", (code) => {
				clearTimeout(timer);
				const why = stderrTail.trim().split(/\r?\n/).slice(-2).join(" ");
				const err = new Error(`The voice engine stopped (code ${code}).${why ? ` ${why}` : ""}`);
				reject(err);
				failAll(err);
				if (child === p) {
					child = null;
					ready = null;
				}
			});
		});
		// A failed start must not stick: the next call tries again.
		ready.catch(() => {
			if (child === p) p.kill();
			if (child === p) child = null;
			ready = null;
		});
		armIdle();
		return ready;
	}

	async function request<T extends Record<string, unknown>>(cmd: string, payload: Record<string, unknown> = {}, timeoutMs?: number): Promise<T> {
		await start();
		const p = child;
		if (!p) throw new Error("The voice engine is not running.");
		const id = String(nextId++);
		armIdle();
		return new Promise<T>((resolve, reject) => {
			const timer = setTimeout(() => {
				pending.delete(id);
				reject(new Error("The voice engine did not answer in time."));
			}, timeoutMs ?? opts.requestTimeoutMs ?? 120_000);
			pending.set(id, { resolve: resolve as (v: Record<string, unknown>) => void, reject, timer });
			p.stdin.write(`${JSON.stringify({ ...payload, id, cmd })}\n`);
		});
	}

	function stop(): void {
		if (idleTimer) clearTimeout(idleTimer);
		const p = child;
		child = null;
		ready = null;
		if (!p) return;
		failAll(new Error("The voice engine was stopped."));
		try {
			p.stdin.write(`${JSON.stringify({ id: "quit", cmd: "quit" })}\n`);
			p.stdin.end();
		} catch {
			/* already gone */
		}
		setTimeout(() => p.kill(), 2000).unref();
	}

	return { start, request, stop, isRunning: () => !!child };
}

export type Sidecar = ReturnType<typeof createSidecar>;
