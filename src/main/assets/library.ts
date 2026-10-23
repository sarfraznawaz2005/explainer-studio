import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AssetView, LICENSES, LicenseError, Mood, Energy, attributionFor, requireLicense, type AssetKind, type AssetPatch } from "@shared/assets";
import type { Asset } from "@shared/models";
import type { LibraryItem } from "@shared/plan/soundtrack";
import type { Repos } from "../db/repos";
import { audioDurationMs, sniff, type FileExt } from "./audio-meta";

/**
 * The shared asset library. Files live once in <assets>/library, named by their
 * SHA-256, so the same file imported twice (or used by ten drafts) is stored
 * once. Drafts point at asset ids, never at copies.
 * Every add goes through the license gate: NC and other unsafe licenses throw.
 */

export const ASSET_FILE = /^[0-9a-f]{32}\.(mp3|ogg|wav|flac|png|jpg|webp|ttf|otf|woff|woff2)$/;

const KIND_EXTS: Record<AssetKind, FileExt[]> = {
	music: ["mp3", "ogg", "wav", "flac"],
	sfx: ["mp3", "ogg", "wav", "flac"],
	image: ["png", "jpg", "webp"],
	font: ["ttf", "otf", "woff", "woff2"],
};
const MAX_BYTES: Record<AssetKind, number> = { music: 60_000_000, sfx: 15_000_000, image: 20_000_000, font: 10_000_000 };
/** Short sounds only for effects, so a song is not filed as a "pop". */
const SFX_MAX_MS = 30_000;

export type AddAsset = {
	kind: AssetKind;
	title: string;
	bytes: Buffer;
	source: "starter" | "freesound" | "import";
	license: string;
	pack?: string | null;
	sourceUrl?: string | null;
	author?: string | null;
	mood?: string | null;
	energy?: string | null;
	bpm?: number | null;
	tags?: string[];
};

export class AssetError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "AssetError";
	}
}

export function createAssetLibrary(deps: { repos: Repos; root: () => string; mediaBase?: string }) {
	const { repos } = deps;
	const base = deps.mediaBase ?? "es-media://asset/";
	const dir = () => join(deps.root(), "library");
	const fileOf = (a: Asset) => join(dir(), a.filePath);

	const view = (a: Asset): AssetView =>
		AssetView.parse({
			id: a.id,
			kind: a.kind,
			title: a.title,
			url: `${base}${a.filePath}`,
			durationMs: a.durationMs,
			tags: a.tags,
			mood: Mood.safeParse(a.mood).success ? a.mood : null,
			energy: Energy.safeParse(a.energy).success ? a.energy : null,
			bpm: a.bpm,
			favorite: a.favorite,
			source: a.source,
			pack: a.pack,
			sourceUrl: a.sourceUrl,
			author: a.author,
			license: a.license,
			licenseUrl: a.licenseUrl,
			attribution: a.attribution,
			bytes: a.bytes,
			createdAt: a.createdAt,
		});

	const bySha = (sha: string): Asset | null => repos.assets.list({ where: { sha256: sha }, limit: 1 })[0] ?? null;

	const lib = {
		dir,
		filePath: fileOf,
		view,
		bySha,

		/** Adds a file. Same bytes twice gives back the existing asset (existed: true). */
		async add(input: AddAsset): Promise<{ asset: Asset; existed: boolean }> {
			const license = requireLicense(input.license);
			const author = input.author?.trim() || null;
			if (LICENSES[license].credit && !author) throw new LicenseError("CC BY needs the author's name, so the video can credit them.");
			const title = input.title.trim().slice(0, 120) || "Untitled";
			if (input.bytes.length > MAX_BYTES[input.kind]) throw new AssetError(`The file is too large for ${input.kind} (limit ${Math.round(MAX_BYTES[input.kind] / 1e6)} MB).`);
			const real = sniff(input.bytes);
			if (!real || !KIND_EXTS[input.kind].includes(real)) throw new AssetError(`This file is not a supported ${input.kind === "sfx" ? "sound" : input.kind} file (${KIND_EXTS[input.kind].join(", ")}).`);
			let durationMs: number | null = null;
			if (input.kind === "music" || input.kind === "sfx") {
				const meta = audioDurationMs(input.bytes);
				if (!meta) throw new AssetError("This audio file could not be read. It may be damaged.");
				durationMs = meta.durationMs;
				if (input.kind === "sfx" && durationMs > SFX_MAX_MS) throw new AssetError("Sound effects must be shorter than 30 seconds. Import long files as music.");
			}
			const sha = createHash("sha256").update(input.bytes).digest("hex");
			const existing = bySha(sha);
			if (existing) return { asset: existing, existed: true };

			const name = `${sha.slice(0, 32)}.${real}`;
			await mkdir(dir(), { recursive: true });
			const dest = join(dir(), name);
			if (!existsSync(dest)) {
				const tmp = `${dest}.part`;
				await writeFile(tmp, input.bytes);
				await rename(tmp, dest);
			}
			const sourceUrl = input.sourceUrl ?? null;
			const asset = repos.assets.create({
				kind: input.kind,
				title,
				filePath: name,
				durationMs,
				tags: [...new Set((input.tags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 20),
				mood: Mood.safeParse(input.mood).success ? input.mood! : null,
				energy: Energy.safeParse(input.energy).success ? input.energy! : null,
				bpm: input.bpm ?? null,
				source: input.source,
				pack: input.pack ?? null,
				sourceUrl,
				author,
				license,
				licenseUrl: LICENSES[license].url,
				attribution: attributionFor({ title, author, license, sourceUrl }),
				sha256: sha,
				bytes: input.bytes.length,
			});
			return { asset, existed: false };
		},

		async addFile(path: string, meta: Omit<AddAsset, "bytes">): Promise<{ asset: Asset; existed: boolean }> {
			const s = await stat(path);
			if (!s.isFile()) throw new AssetError("This is not a file.");
			if (s.size > MAX_BYTES[meta.kind]) throw new AssetError(`The file is too large for ${meta.kind} (limit ${Math.round(MAX_BYTES[meta.kind] / 1e6)} MB).`);
			return lib.add({ ...meta, bytes: await readFile(path) });
		},

		get: (id: string) => repos.assets.get(id),

		list(kind?: AssetKind): Asset[] {
			return repos.assets.list({ where: kind ? { kind } : {}, orderBy: "title", desc: false });
		},

		update(id: string, patch: AssetPatch): Asset {
			const a = repos.assets.get(id);
			if (!a) throw new AssetError("This asset was not found.");
			const title = patch.title ?? a.title;
			const next = repos.assets.update(id, {
				...patch,
				title,
				tags: patch.tags ? [...new Set(patch.tags.map((t) => t.trim().toLowerCase()))] : undefined,
				attribution: attributionFor({ title, author: a.author, license: a.license, sourceUrl: a.sourceUrl }),
			});
			return next!;
		},

		/** Titles of drafts whose plan or sound setup names this asset. */
		usage(id: string): string[] {
			return repos.drafts
				.list()
				.filter((d) => JSON.stringify(d.audio ?? null).includes(`"${id}"`) || JSON.stringify(d.plan ?? null).includes(`"${id}"`))
				.map((d) => d.title);
		},

		/** Deletes the row and its file. Drafts that used it fall back to the automatic pick. */
		async remove(id: string): Promise<boolean> {
			const a = repos.assets.get(id);
			if (!a) return false;
			repos.assets.remove(id);
			if (ASSET_FILE.test(a.filePath) && !repos.assets.count({ filePath: a.filePath })) await rm(fileOf(a), { force: true });
			return true;
		},

		/** Music and effects for the mixer. */
		items(): LibraryItem[] {
			return repos.assets
				.list({ orderBy: "title", desc: false })
				.filter((a) => a.kind === "music" || a.kind === "sfx")
				.map((a) => ({ id: a.id, kind: a.kind, url: `${base}${a.filePath}`, mood: a.mood, durationMs: a.durationMs }));
		},
	};
	return lib;
}

export type AssetLibrary = ReturnType<typeof createAssetLibrary>;
