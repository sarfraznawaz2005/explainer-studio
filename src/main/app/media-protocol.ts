import { protocol } from "electron";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { MEDIA_SCHEME, mediaPath, mediaType, type MediaRoots } from "./media-url";
import { PREVIEW_SCHEME } from "./preview-protocol";

/**
 * es-media:// serves voice clips and library files to the preview.
 * Read-only, GET and HEAD only. The URL rules live in media-url.ts.
 */

/** Registers es-media:// and es-preview:// (see preview-protocol.ts) in one call. Must run before the app is ready. */
export function registerAppSchemes(): void {
	protocol.registerSchemesAsPrivileged([
		{ scheme: MEDIA_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
		{ scheme: PREVIEW_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
	]);
}

const HEADERS = { "Accept-Ranges": "bytes", "Cache-Control": "no-cache", "Access-Control-Allow-Origin": "*", "X-Content-Type-Options": "nosniff" };

/**
 * Serves a byte range when asked (media elements seek with Range requests).
 * An open-ended range ("bytes=N-") gets the whole rest of the file: Chromium takes a
 * shorter answer as the end of the file, so seeking past it jumped to the end.
 * The body is streamed, so a long video is never read into memory whole.
 */
async function serveFile(path: string, range: string | null, head: boolean): Promise<Response> {
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
			if (m[2]) end = Math.min(size - 1, Number(m[2]));
		} else if (m[2]) start = Math.max(0, size - Number(m[2]));
		if (start > end || start >= size) return new Response("Bad range", { status: 416, headers: { "Content-Range": `bytes */${size}` } });
	}
	const headers = { ...HEADERS, "Content-Type": mediaType(path), "Content-Length": String(end - start + 1), ...(m ? { "Content-Range": `bytes ${start}-${end}/${size}` } : {}) };
	const body = head || size === 0 ? null : (Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream<Uint8Array>);
	return new Response(body, { status: m ? 206 : 200, headers });
}

export function handleMediaProtocol(roots: () => MediaRoots): void {
	protocol.handle(MEDIA_SCHEME, async (req) => {
		if (req.method !== "GET" && req.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
		const path = mediaPath(req.url, roots());
		if (!path) return new Response("Not found", { status: 404 });
		return serveFile(path, req.headers.get("range"), req.method === "HEAD");
	});
}
