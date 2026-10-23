import { randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { MEDIA_SCHEME, mediaPath, mediaType, type MediaRoots } from "../app/media-url";

/**
 * The headless render browser cannot read es-media:// URLs, so the worker serves
 * the same files over HTTP while it renders. Locked down:
 *  - bound to 127.0.0.1 only, on a random port;
 *  - every URL must start with a random 48-character token made at start;
 *  - GET and HEAD only; the path is mapped by the same rules as es-media://
 *    (mediaPath), so only voice clips, library files and video files can be read.
 */
export type MediaServer = { base: string; setRoots: (r: MediaRoots) => void; close: () => Promise<void> };

export async function startMediaServer(initial: MediaRoots): Promise<MediaServer> {
	const token = randomBytes(24).toString("hex");
	let roots = initial;
	const server: Server = createServer(async (req, res) => {
		const deny = (code: number) => {
			res.writeHead(code, { "Content-Type": "text/plain" });
			res.end();
		};
		if (req.method !== "GET" && req.method !== "HEAD") return deny(405);
		const url = req.url ?? "";
		const prefix = `/${token}/`;
		if (!url.startsWith(prefix)) return deny(404);
		const path = mediaPath(`${MEDIA_SCHEME}://${url.slice(prefix.length)}`, roots);
		if (!path) return deny(404);
		try {
			const s = await stat(path);
			if (!s.isFile()) return deny(404);
			res.writeHead(200, { "Content-Type": mediaType(path), "Content-Length": String(s.size), "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
			if (req.method === "HEAD") return res.end();
			createReadStream(path).on("error", () => res.destroy()).pipe(res);
		} catch {
			deny(404);
		}
	});
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => resolve());
	});
	const { port } = server.address() as AddressInfo;
	return {
		base: `http://127.0.0.1:${port}/${token}/`,
		setRoots: (r) => {
			roots = r;
		},
		close: () => new Promise((resolve) => server.close(() => resolve())),
	};
}

/** Replaces every es-media:// URL in the props with the server URL. Other values are kept. */
export function rewriteMedia<T>(value: T, base: string): T {
	const from = `${MEDIA_SCHEME}://`;
	const walk = (v: unknown): unknown => {
		if (typeof v === "string") return v.startsWith(from) ? base + v.slice(from.length) : v;
		if (Array.isArray(v)) return v.map(walk);
		if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
		return v;
	};
	return walk(value) as T;
}

/** ffmpeg concat list. Paths are quoted; a ' inside a path is escaped the ffmpeg way ('\''). */
export const concatList = (files: string[]) => files.map((f) => `file '${f.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`).join("\n") + "\n";

/** ffmpeg arguments that join chapter files: video copied as is, the WAVs joined sample-exact and encoded to AAC once. */
export const joinArgs = (videoList: string, audioList: string, output: string) => [
	"-y",
	"-hide_banner",
	"-f",
	"concat",
	"-safe",
	"0",
	"-i",
	videoList,
	"-f",
	"concat",
	"-safe",
	"0",
	"-i",
	audioList,
	"-map",
	"0:v:0",
	"-map",
	"1:a:0",
	"-c:v",
	"copy",
	"-c:a",
	"aac",
	"-b:a",
	"320k",
	"-ar",
	"48000",
	"-movflags",
	"+faststart",
	output,
];
