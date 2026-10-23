import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import type { Figure } from "@shared/source";

export type ResolvedImage = Omit<Figure, "id" | "input" | "caption" | "page"> & { caption?: string | null; page?: number | null };
/** Turns an image reference from a document (relative path or data: URL) into a saved figure file, or null. */
export type ImageResolver = (src: string) => Promise<(Omit<Figure, "id" | "input" | "caption"> & { caption?: string | null }) | null>;

const TYPES: Record<string, string> = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".bmp": "image/bmp",
	".svg": "image/svg+xml",
};
const EXT_OF: Record<string, string> = Object.fromEntries(Object.entries(TYPES).map(([e, t]) => [t, e]));
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

/** Width and height from a PNG, JPEG, GIF or WebP header. 0×0 when unknown. */
export function imageSize(buf: Buffer): { width: number; height: number } {
	if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
	if (buf.length > 10 && buf.toString("ascii", 0, 3) === "GIF") return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
	if (buf.length > 30 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
		const kind = buf.toString("ascii", 12, 16);
		if (kind === "VP8X") return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
		if (kind === "VP8 ") return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
		if (kind === "VP8L") {
			const b = buf.readUInt32LE(21);
			return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
		}
	}
	if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
		let i = 2;
		while (i + 9 < buf.length) {
			if (buf[i] !== 0xff) {
				i++;
				continue;
			}
			const marker = buf[i + 1]!;
			const len = buf.readUInt16BE(i + 2);
			if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
			i += 2 + len;
		}
	}
	return { width: 0, height: 0 };
}

/** A JPEG's EXIF rotation tag (1 = upright, 6 = turned right, 8 = turned left, ...). 1 when there is none. */
export function jpegOrientation(buf: Buffer): number {
	if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return 1;
	let i = 2;
	while (i + 4 < buf.length && buf[i] === 0xff) {
		const marker = buf[i + 1]!;
		const len = buf.readUInt16BE(i + 2);
		if (marker === 0xda) break;
		if (marker === 0xe1 && buf.toString("ascii", i + 4, i + 8) === "Exif") {
			const t = i + 10;
			if (t + 8 > buf.length) return 1;
			const le = buf.toString("ascii", t, t + 2) === "II";
			const u16 = (o: number) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
			const u32 = (o: number) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
			const ifd = t + u32(t + 4);
			if (ifd + 2 > buf.length) return 1;
			const n = u16(ifd);
			for (let k = 0; k < n; k++) {
				const e = ifd + 2 + k * 12;
				if (e + 10 > buf.length) return 1;
				if (u16(e) === 0x0112) {
					const v = u16(e + 8);
					return v >= 1 && v <= 8 ? v : 1;
				}
			}
			return 1;
		}
		i += 2 + len;
	}
	return 1;
}

/**
 * Saves images into `<draftDir>/source/figures`. Relative paths are resolved
 * against the document's folder and must stay inside it (no ../ escapes).
 * Remote URLs are never fetched.
 */
export function createImageSaver(opts: { draftDir: string; prefix: string; onSkip?: (why: string) => void }) {
	const figDir = join(opts.draftDir, "source", "figures");
	let n = 0;
	const seen = new Map<string, string>();

	async function saveBuffer(buf: Buffer, mediaType: string): Promise<Omit<Figure, "id" | "input" | "caption" | "page"> | null> {
		if (buf.length > MAX_IMAGE_BYTES) {
			opts.onSkip?.("An image larger than 25 MB was skipped.");
			return null;
		}
		const ext = EXT_OF[mediaType];
		if (!ext) return null;
		const hash = createHash("sha1").update(buf).digest("hex");
		let file = seen.get(hash);
		if (!file) {
			await mkdir(figDir, { recursive: true });
			file = join(figDir, `${opts.prefix}-${String(++n).padStart(3, "0")}${ext}`);
			await writeFile(file, buf);
			seen.set(hash, file);
		}
		const { width, height } = imageSize(buf);
		return { file: relative(opts.draftDir, file).replace(/\\/g, "/"), width, height, mediaType };
	}

	/** Copies an existing file (already on disk, e.g. from the PDF helper) into the figures folder. */
	async function saveFile(path: string): Promise<Omit<Figure, "id" | "input" | "caption" | "page"> | null> {
		const type = TYPES[extname(path).toLowerCase()];
		if (!type) return null;
		return saveBuffer(await readFile(path), type);
	}

	function resolverFor(docPath: string | null): ImageResolver {
		const base = docPath ? dirname(resolve(docPath)) : null;
		return async (src) => {
			const s = src.trim();
			const data = /^data:(image\/[a-z+.-]+);base64,([a-z0-9+/=\s]+)$/i.exec(s);
			if (data) {
				const f = await saveBuffer(Buffer.from(data[2]!, "base64"), data[1]!.toLowerCase());
				return f ? { ...f, page: null } : null;
			}
			if (/^[a-z][a-z0-9+.-]*:/i.test(s) || s.startsWith("//")) {
				opts.onSkip?.("Images on the web were not downloaded. Only images saved next to the file are used.");
				return null;
			}
			if (!base) return null;
			let rel: string;
			try {
				rel = decodeURIComponent(s.split(/[?#]/)[0]!);
			} catch {
				return null;
			}
			const full = resolve(base, rel);
			const r = relative(base, full);
			if (!r || r.startsWith("..") || isAbsolute(r)) {
				opts.onSkip?.("An image outside the document's folder was skipped.");
				return null;
			}
			try {
				const st = await stat(full);
				if (!st.isFile()) return null;
			} catch {
				opts.onSkip?.(`An image was not found next to the document: ${rel.slice(0, 80)}`);
				return null;
			}
			const f = await saveFile(full);
			return f ? { ...f, page: null } : null;
		};
	}

	return { figDir, saveBuffer, saveFile, resolverFor, copy: copyFile };
}

export type ImageSaver = ReturnType<typeof createImageSaver>;
