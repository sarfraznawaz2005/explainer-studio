import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { LICENSES, type StarterStatus } from "@shared/assets";
import { ChecksumError, downloadPinned, type Pinned } from "../voice/download";
import type { AssetLibrary } from "./library";
import { FREEPD, STARTER_MUSIC, STARTER_ZIPS, type StarterMusic, type StarterZip } from "./starter-manifest";
import { readZipEntry } from "./zip";

/**
 * Installs the starter pack into the library. Safe to run again: files already in
 * the library (same hash) are skipped, so a failed or stopped install resumes.
 * A license file per pack goes to <assets>/licenses.
 */

export type StarterDeps = {
	lib: AssetLibrary;
	/** Folder for downloads in progress. */
	tmp: string;
	/** <assets>/licenses */
	licenses: string;
	signal?: AbortSignal;
	fetchImpl?: typeof fetch;
	/** Waits between download retries (tests pass short ones). */
	retryDelays?: number[];
	onProgress?: (s: StarterStatus) => void;
	/** Tests pass a small pack; the app uses the real one. */
	pack?: StarterPack;
};

export type StarterPack = { music: StarterMusic[]; zips: StarterZip[] };
const REAL: StarterPack = { music: STARTER_MUSIC, zips: STARTER_ZIPS };
const sizes = (p: StarterPack) => ({
	files: p.music.length + p.zips.reduce((n, z) => n + z.files.length, 0),
	bytes: p.music.reduce((n, m) => n + m.bytes, 0) + p.zips.reduce((n, z) => n + z.bytes, 0),
});

const RETRIES = [2000, 6000, 15000];

/**
 * Download with retries. Archive and CDN servers sometimes answer 5xx or drop
 * the connection; those are tried again. A checksum mismatch, a 4xx answer or a
 * cancel is final.
 */
export async function downloadWithRetry(pin: Pinned, dest: string, opts: Parameters<typeof downloadPinned>[2] & { delays?: number[] } = {}): Promise<void> {
	const delays = opts.delays ?? RETRIES;
	for (let attempt = 0; ; attempt++) {
		try {
			return await downloadPinned(pin, dest, opts);
		} catch (err) {
			const e = err as Error;
			const final = opts.signal?.aborted || e instanceof ChecksumError || /HTTP 4\d\d/.test(e.message) || attempt >= delays.length;
			if (final) throw err;
			await new Promise<void>((resolve, reject) => {
				const t = setTimeout(resolve, delays[attempt]);
				opts.signal?.addEventListener("abort", () => {
					clearTimeout(t);
					reject(opts.signal!.reason);
				}, { once: true });
			});
		}
	}
}

/** How many starter files are already in the library. */
export function starterInstalled(lib: AssetLibrary, pack: StarterPack = REAL): number {
	const have = (sha: string) => !!lib.bySha(sha);
	return pack.music.filter((m) => have(m.sha256)).length + pack.zips.reduce((n, z) => n + z.files.filter((f) => have(f.sha256)).length, 0);
}

function freepdLicenseText(music: StarterMusic[]): string {
	const lines = music.map((m) => `- "${m.title}" by ${m.author}  (${decodeURIComponent(m.url)})  sha256 ${m.sha256}`);
	return [
		"FreePD.com music, as included in the Explainer Studio starter pack",
		"",
		"License: Public domain (CC0). No attribution is required.",
		LICENSES.PD.url,
		"",
		FREEPD.note,
		"",
		"Tracks:",
		...lines,
		"",
	].join("\n");
}

export async function installStarter(deps: StarterDeps): Promise<StarterStatus> {
	const { lib, signal } = deps;
	const pack = deps.pack ?? REAL;
	const { files: total, bytes: bytesTotal } = sizes(pack);
	await mkdir(deps.tmp, { recursive: true });
	await mkdir(deps.licenses, { recursive: true });
	let done = starterInstalled(lib, pack);
	let bytesDone = 0;
	const status = (detail?: string): StarterStatus => ({ state: "installing", done, total, bytesDone, bytesTotal, detail });
	deps.onProgress?.(status("Starting"));

	await writeFile(join(deps.licenses, "freepd.txt"), freepdLicenseText(pack.music));
	for (const m of pack.music) {
		signal?.throwIfAborted();
		if (lib.bySha(m.sha256)) {
			bytesDone += m.bytes;
			continue;
		}
		const tmp = join(deps.tmp, `${m.sha256.slice(0, 16)}.mp3`);
		const before = bytesDone;
		await downloadWithRetry(m, tmp, { signal, fetchImpl: deps.fetchImpl, delays: deps.retryDelays, onBytes: (d) => deps.onProgress?.({ ...status(`Music: ${m.title}`), bytesDone: before + d }) });
		try {
			await lib.add({ kind: "music", title: m.title, bytes: await readFile(tmp), source: "starter", pack: FREEPD.title, sourceUrl: FREEPD.pageUrl, author: m.author, license: FREEPD.license, mood: m.mood, energy: m.energy, tags: m.tags });
		} finally {
			await rm(tmp, { force: true });
		}
		bytesDone += m.bytes;
		done++;
		deps.onProgress?.(status(`Music: ${m.title}`));
	}

	for (const z of pack.zips) {
		signal?.throwIfAborted();
		const missing = z.files.filter((f) => !lib.bySha(f.sha256));
		if (!missing.length) {
			bytesDone += z.bytes;
			continue;
		}
		const tmp = join(deps.tmp, `${z.id}.zip`);
		const before = bytesDone;
		await downloadWithRetry(z, tmp, { signal, fetchImpl: deps.fetchImpl, delays: deps.retryDelays, onBytes: (d) => deps.onProgress?.({ ...status(`Sound effects: ${z.title}`), bytesDone: before + d }) });
		try {
			const zip = await readFile(tmp);
			await writeLicense(z, zip, deps.licenses);
			for (const f of missing) {
				signal?.throwIfAborted();
				const data = readZipEntry(zip, f.entry, 5_000_000);
				const sha = createHash("sha256").update(data).digest("hex");
				if (data.length !== f.bytes || sha !== f.sha256) throw new Error(`${f.entry} in ${z.title} did not match its checksum.`);
				await lib.add({ kind: "sfx", title: f.title, bytes: data, source: "starter", pack: `Kenney ${z.title}`, sourceUrl: z.pageUrl, author: z.author, license: z.license, tags: f.tags });
				done++;
			}
		} finally {
			await rm(tmp, { force: true });
		}
		bytesDone += z.bytes;
		deps.onProgress?.(status(`Sound effects: ${z.title}`));
	}
	return { state: "installed", done, total, bytesDone: bytesTotal, bytesTotal };
}

/** The pack's own License.txt when it has one, plus where it came from. */
async function writeLicense(z: StarterZip, zip: Buffer, dir: string): Promise<void> {
	let text = "";
	try {
		text = readZipEntry(zip, "License.txt", 64_000).toString("utf8");
	} catch {
		text = `License: ${LICENSES[z.license].label}\n${LICENSES[z.license].url ?? ""}\n`;
	}
	const head = `${z.title} by ${z.author}\nSource: ${z.pageUrl}\nDownload: ${z.url} (sha256 ${z.sha256})\n\n`;
	await writeFile(join(dir, `${z.id}.txt`), head + text.replace(/\r\n/g, "\n"));
}
