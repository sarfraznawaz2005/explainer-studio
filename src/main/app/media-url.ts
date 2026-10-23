import { join } from "node:path";

/**
 * es-media:// URLs for the preview. Pure Node, so it can be unit tested.
 *  - es-media://voice/<draft id>/<clip>.wav: a draft's voice clips (<drafts>/<id>/voice).
 *  - es-media://asset/<file>: a library file (<assets>/library), named by its hash.
 *  - es-media://video/<video id>/<file>: a finished video, its thumbnails (<videos>/<id>).
 *  - es-media://figure/<draft id>/<file>: a figure saved from the source (<drafts>/<id>/source/figures).
 *  - es-media://brand/<kit id>/<file>: a brand kit logo (<assets>/brand/<kit id>).
 * Only names that match the exact patterns are served: no path from the URL is
 * ever used as-is.
 */
export const MEDIA_SCHEME = "es-media";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CLIP = /^[0-9a-f]{32}\.wav$/;
const ASSET = /^[0-9a-f]{32}\.(mp3|ogg|wav|flac|png|jpg|webp|ttf|otf|woff|woff2)$/;
const VIDEO_FILE = /^(video\.mp4|thumbnail(-[bc])?\.png)$/;
/** Same pattern as FigureFile in the plan schema (ingest names figures "<prefix>-NNN.ext"). */
const FIGURE_FILE = /^[a-z0-9]{1,12}-\d{3,4}\.(png|jpe?g|webp|gif)$/;
/** Same pattern as LogoFile in the brand schema. */
const LOGO_FILE = /^logo-[0-9a-f]{8}\.(png|jpg|webp)$/;

export type MediaRoots = { drafts: string; assets: string; videos?: string };

/** The file a media URL points to, or null when the URL is not an allowed file. */
export function mediaPath(url: string, roots: MediaRoots): string | null {
	let u: URL;
	try {
		u = new URL(url);
	} catch {
		return null;
	}
	if (u.protocol !== `${MEDIA_SCHEME}:` || u.search || u.hash || u.username || u.password) return null;
	const parts = u.pathname.split("/").filter(Boolean);
	if (u.host === "voice") {
		if (parts.length !== 2) return null;
		const [draftId, clip] = parts as [string, string];
		if (!UUID.test(draftId) || !CLIP.test(clip)) return null;
		return join(roots.drafts, draftId.toLowerCase(), "voice", clip);
	}
	if (u.host === "asset") {
		if (parts.length !== 1 || !ASSET.test(parts[0]!)) return null;
		return join(roots.assets, "library", parts[0]!);
	}
	if (u.host === "figure") {
		if (parts.length !== 2) return null;
		const [draftId, file] = parts as [string, string];
		if (!UUID.test(draftId) || !FIGURE_FILE.test(file)) return null;
		return join(roots.drafts, draftId.toLowerCase(), "source", "figures", file);
	}
	if (u.host === "brand") {
		if (parts.length !== 2) return null;
		const [kitId, file] = parts as [string, string];
		if (!UUID.test(kitId) || !LOGO_FILE.test(file)) return null;
		return join(roots.assets, "brand", kitId.toLowerCase(), file);
	}
	if (u.host === "video" && roots.videos) {
		if (parts.length !== 2) return null;
		const [videoId, file] = parts as [string, string];
		if (!UUID.test(videoId) || !VIDEO_FILE.test(file)) return null;
		return join(roots.videos, videoId.toLowerCase(), file);
	}
	return null;
}

const TYPES: Record<string, string> = {
	mp4: "video/mp4",
	wav: "audio/wav",
	mp3: "audio/mpeg",
	ogg: "audio/ogg",
	flac: "audio/flac",
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
	ttf: "font/ttf",
	otf: "font/otf",
	woff: "font/woff",
	woff2: "font/woff2",
};

export const mediaType = (path: string) => TYPES[path.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";

export const audioBaseFor = (draftId: string) => `${MEDIA_SCHEME}://voice/${draftId}/`;
export const figureBaseFor = (draftId: string) => `${MEDIA_SCHEME}://figure/${draftId}/`;
export const brandLogoUrl = (kitId: string, file: string) => `${MEDIA_SCHEME}://brand/${kitId}/${file}`;
export const videoUrlFor = (videoId: string, file: string) => `${MEDIA_SCHEME}://video/${videoId}/${file}`;
