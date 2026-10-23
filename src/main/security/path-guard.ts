import { existsSync, realpathSync } from "node:fs";
import { basename, isAbsolute, relative, resolve, win32 } from "node:path";

/**
 * Decides which file paths main may touch on behalf of the renderer.
 * A path is allowed when it sits inside one of the app's own folders, or when
 * the user picked exactly that file or folder in an OS dialog.
 */
export class PathDeniedError extends Error {
	constructor(reason: string) {
		super(`Path not allowed: ${reason}`);
		this.name = "PathDeniedError";
	}
}

const isWin = process.platform === "win32";
const DEVICE_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

const same = (a: string) => (isWin ? a.toLowerCase() : a);

function inside(root: string, p: string): boolean {
	const rel = relative(same(root), same(p));
	return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/** Follows links and junctions for paths that exist, so a link cannot point out of a root. */
function real(p: string): string {
	try {
		return existsSync(p) ? realpathSync.native(p) : p;
	} catch {
		return p;
	}
}

/** Shape checks that do not depend on the roots. Returns the normalised absolute path. */
export function normalisePath(input: unknown): string {
	if (typeof input !== "string" || input.length === 0) throw new PathDeniedError("empty");
	if (input.length > 4096) throw new PathDeniedError("too long");
	if (input.includes("\0")) throw new PathDeniedError("contains a null byte");
	if (isWin) {
		// Device and UNC paths (\\?\, \\.\, \\server\share) are never needed by the app.
		if (/^[\\/]{2}/.test(input)) throw new PathDeniedError("network or device path");
		if (!win32.isAbsolute(input) || !/^[a-zA-Z]:[\\/]/.test(input)) throw new PathDeniedError("not an absolute drive path");
		// A colon after the drive letter means an alternate data stream.
		if (input.indexOf(":", 2) !== -1) throw new PathDeniedError("alternate data stream");
	} else if (!isAbsolute(input)) throw new PathDeniedError("not absolute");
	const p = resolve(input);
	if (isWin && DEVICE_NAMES.test(basename(p))) throw new PathDeniedError("reserved device name");
	return p;
}

export function createPathGuard(roots: string[]) {
	const rootList = roots.map((r) => resolve(r));
	const picked = new Set<string>();

	return {
		/** Record a path the user chose in an open/save dialog. */
		allowPicked(p: string): void {
			picked.add(same(resolve(p)));
		},
		isPicked(p: string): boolean {
			return picked.has(same(resolve(p)));
		},
		/**
		 * Returns the safe absolute path or throws PathDeniedError.
		 * `allowPicked`: also accept files the user chose in a dialog (and files inside chosen folders).
		 */
		check(input: unknown, opts: { allowPicked?: boolean } = {}): string {
			const p = normalisePath(input);
			const r = real(p);
			const okRoot = rootList.some((root) => inside(root, p) && inside(real(root), r));
			if (okRoot) return p;
			if (opts.allowPicked) {
				for (const pick of picked) {
					if (inside(pick, same(p)) && inside(real(pick), r)) return p;
				}
			}
			throw new PathDeniedError("outside the app folders");
		},
	};
}

export type PathGuard = ReturnType<typeof createPathGuard>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A folder the app owns: <root>/<uuid>, a direct child of the root. Anything else
 * (a path outside, a name that is not a uuid) is refused, so a delete can never
 * reach files the app did not make.
 */
export function ownedDir(root: string, id: string): string {
	if (!UUID.test(id)) throw new PathDeniedError("Invalid id");
	const dir = resolve(root, id.toLowerCase());
	if (relative(resolve(root), dir) !== id.toLowerCase()) throw new PathDeniedError("Invalid folder");
	return dir;
}
