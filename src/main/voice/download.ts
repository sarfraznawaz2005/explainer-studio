import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { rename, rm, stat } from "node:fs/promises";

export type Pinned = { url: string; sha256: string; bytes: number };

export class ChecksumError extends Error {
	constructor(file: string) {
		super(`The downloaded file ${file} did not match its checksum. It was deleted. Try again.`);
		this.name = "ChecksumError";
	}
}

/** SHA-256 of a file on disk, streamed. */
export async function sha256File(path: string): Promise<string> {
	const h = createHash("sha256");
	for await (const chunk of createReadStream(path)) h.update(chunk as Buffer);
	return h.digest("hex");
}

/** True when the file exists with the pinned size and hash. */
export async function isPinnedFile(path: string, pin: Pinned, checkHash = true): Promise<boolean> {
	try {
		if ((await stat(path)).size !== pin.bytes) return false;
	} catch {
		return false;
	}
	return !checkHash || (await sha256File(path)) === pin.sha256;
}

/**
 * Downloads a pinned file. Bytes go to `<dest>.part` and are hashed on the way;
 * the file is renamed into place only when size and SHA-256 match.
 */
export async function downloadPinned(
	pin: Pinned,
	dest: string,
	opts: { onBytes?: (done: number, total: number) => void; signal?: AbortSignal; fetchImpl?: typeof fetch } = {},
): Promise<void> {
	if (!pin.url.startsWith("https://") && !/^http:\/\/127\.0\.0\.1[:/]/.test(pin.url)) throw new Error("Downloads must use https");
	const part = `${dest}.part`;
	const res = await (opts.fetchImpl ?? fetch)(pin.url, { signal: opts.signal, redirect: "follow" });
	if (!res.ok || !res.body) throw new Error(`Download failed: HTTP ${res.status} for ${new URL(pin.url).pathname.split("/").pop()}`);
	const h = createHash("sha256");
	const out = createWriteStream(part);
	let done = 0;
	let lastTick = 0;
	try {
		const reader = res.body.getReader();
		for (;;) {
			const { done: end, value } = await reader.read();
			if (end) break;
			h.update(value);
			done += value.byteLength;
			if (done > pin.bytes) throw new Error("The download is larger than expected. It was stopped.");
			if (!out.write(value)) await new Promise<void>((r) => out.once("drain", () => r()));
			const now = Date.now();
			if (now - lastTick > 150) {
				lastTick = now;
				opts.onBytes?.(done, pin.bytes);
			}
		}
		await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())));
		opts.onBytes?.(done, pin.bytes);
		if (done !== pin.bytes || h.digest("hex") !== pin.sha256) throw new ChecksumError(dest.split(/[\\/]/).pop() ?? dest);
		await rename(part, dest);
	} catch (err) {
		out.destroy();
		await rm(part, { force: true });
		throw err;
	}
}
