import { app, net, protocol } from "electron";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { PREVIEW_PAGE, PREVIEW_SCHEME } from "@shared/code-preview";

export { PREVIEW_ORIGIN, PREVIEW_PAGE, PREVIEW_SCHEME } from "@shared/code-preview";

/**
 * es-preview://app/ serves the sandbox page that runs AI video code (the
 * "AI free-form" style): the Studio preview iframe and the hidden check window.
 *
 * It is its own origin, so the page cannot touch the app window, and it has no
 * preload, so it cannot reach the app's IPC. Every response carries a strict
 * Content-Security-Policy: scripts only from this scheme, no network, no
 * frames, no workers. It allows 'unsafe-eval' because the AI code is compiled
 * at run time; the app window's own policy stays without it.
 *
 * Release builds serve only code-preview.html and its assets from the built
 * renderer folder. Development builds pass requests to the Vite dev server.
 */

const TYPES: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".woff2": "font/woff2",
	".woff": "font/woff",
	".ttf": "font/ttf",
	".svg": "image/svg+xml",
	".png": "image/png",
};

/** The page's policy. Development adds what the Vite dev client needs (inline preamble, hot-reload socket). */
export function previewPolicy(dev: boolean): string {
	return [
		"default-src 'none'",
		`script-src ${PREVIEW_SCHEME}: 'unsafe-eval'${dev ? " 'unsafe-inline'" : ""}`,
		`style-src ${PREVIEW_SCHEME}: 'unsafe-inline'`,
		`img-src ${PREVIEW_SCHEME}: es-media: data: blob:`,
		"media-src es-media: data: blob:",
		`font-src ${PREVIEW_SCHEME}: es-media: data:`,
		`connect-src ${PREVIEW_SCHEME}: es-media:${dev ? " ws://localhost:* http://localhost:*" : ""}`,
		"frame-src 'none'",
		"worker-src 'none'",
		"object-src 'none'",
		"base-uri 'none'",
		"form-action 'none'",
	].join("; ");
}

/** The file a release-build URL path points to, or null when it is not the page or one of its assets. */
export function previewFile(root: string, pathname: string): string | null {
	let path: string;
	try {
		path = decodeURIComponent(pathname);
	} catch {
		return null;
	}
	if (path !== PREVIEW_PAGE && !/^\/assets\/[\w.-]+$/.test(path)) return null;
	const file = normalize(join(root, path));
	return file.startsWith(normalize(root) + sep) ? file : null;
}

const headers = (type: string, dev: boolean) => ({ "Content-Type": type, "Content-Security-Policy": previewPolicy(dev), "X-Content-Type-Options": "nosniff", "Cache-Control": "no-cache" });

export function handlePreviewProtocol(): void {
	const devServer = !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined;
	const root = join(__dirname, "../renderer");
	protocol.handle(PREVIEW_SCHEME, async (req) => {
		if (req.method !== "GET") return new Response("Method not allowed", { status: 405 });
		const u = new URL(req.url);
		if (u.host !== "app" || u.username || u.password) return new Response("Not found", { status: 404 });
		if (devServer) {
			// Only the preview page: the app's own page (index.html) has no business in the sandbox.
			if ((u.pathname === "/" || /\.html$/i.test(u.pathname)) && u.pathname !== PREVIEW_PAGE) return new Response("Not found", { status: 404 });
			const upstream = await net.fetch(`${devServer.replace(/\/$/, "")}${u.pathname}${u.search}`);
			return new Response(upstream.body, { status: upstream.status, headers: headers(upstream.headers.get("content-type") ?? "application/octet-stream", true) });
		}
		const file = previewFile(root, u.pathname);
		if (!file) return new Response("Not found", { status: 404 });
		try {
			return new Response(await readFile(file), { headers: headers(TYPES[extname(file).toLowerCase()] ?? "application/octet-stream", false) });
		} catch {
			return new Response("Not found", { status: 404 });
		}
	});
}
