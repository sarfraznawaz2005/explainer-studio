import { protocol } from "electron";
import { open, stat } from "node:fs/promises";
import { MEDIA_SCHEME, mediaPath, mediaType, type MediaRoots } from "./media-url";

/**
 * es-media:// serves voice clips and library files to the preview.
 * Read-only, GET and HEAD only. The URL rules live in media-url.ts.
 */

/** Must run before the app is ready. */
export function registerMediaScheme(): void {
	protocol.registerSchemesAsPrivileged([{ scheme: MEDIA_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }]);
}

const HEADERS = { "Accept-Ranges": "bytes", "Cache-Control": "no-cache", "Access-Control-Allow-Origin": "*", "X-Content-Type-Options": "nosniff" };

/** Open-ended ranges ("bytes=0-") get at most this much, so a long video is never read into memory whole. */
const MAX_CHUNK = 8 * 1024 * 1024;

/** Serves a byte range when asked (media elements seek with Range requests). */
async function serveFile(path: string, range: string | null): Promise<Response> {
	let size: number;
	try {
		const s = await stat(path);
		if (!s.isFile()) return new Response("Not found", { status: 404 });
		size = s.size;
	} catch {
		return new Response("Not found", { status: 404 });
	}
	let start = 0;
	let end = size - 1;
	const m = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null;
	if (range && !m) return new Response("Bad range", { status: 416, headers: { "Content-Range": `bytes */${size}` } });
	if (m) {
		if (m[1]) {
			start = Number(m[1]);
			end = m[2] ? Math.min(size - 1, Number(m[2])) : Math.min(size - 1, start + MAX_CHUNK - 1);
		} else if (m[2]) start = Math.max(0, size - Number(m[2]));
		if (start > end || start >= size) return new Response("Bad range", { status: 416, headers: { "Content-Range": `bytes */${size}` } });
	}
	const f = await open(path, "r");
	try {
		const buf = Buffer.alloc(end - start + 1);
		await f.read(buf, 0, buf.length, start);
		const headers = { ...HEADERS, "Content-Length": String(buf.length), ...(m ? { "Content-Range": `bytes ${start}-${end}/${size}` } : {}) };
		return new Response(buf, { status: m ? 206 : 200, headers });
	} finally {
		await f.close();
	}
}

export function handleMediaProtocol(roots: () => MediaRoots): void {
	protocol.handle(MEDIA_SCHEME, async (req) => {
		if (req.method !== "GET" && req.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
		const path = mediaPath(req.url, roots());
		if (!path) return new Response("Not found", { status: 404 });
		return serveFile(path, req.headers.get("range"));
	});
}
