import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { BrandKitData, brandStamp, defaultBrandKit, type BrandKitView, type BrandStamp } from "@shared/brand";
import type { BrandKit, Draft } from "@shared/models";
import { appFolders } from "../app/folders";
import { brandLogoUrl } from "../app/media-url";
import { repos } from "../db/repos";
import { ownedDir } from "../security/path-guard";

/** Logos bigger than this are refused (a logo never needs more). */
export const LOGO_MAX_BYTES = 5 * 1024 * 1024;

const brandRoot = () => join(appFolders().assets, "brand");
const kitDir = (kitId: string) => ownedDir(brandRoot(), kitId);

/** The image type from the first bytes, or null when the file is not a PNG, JPEG or WebP. SVG is never accepted. */
export function logoType(head: Uint8Array): "png" | "jpg" | "webp" | null {
	const b = Buffer.from(head);
	if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
	if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
	if (b.length >= 12 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP") return "webp";
	return null;
}

function dataOf(k: BrandKit) {
	const r = BrandKitData.safeParse(k.data);
	return r.success ? r.data : defaultBrandKit(k.name);
}

export function kitView(k: BrandKit): BrandKitView {
	const data = dataOf(k);
	return { id: k.id, name: k.name, isDefault: k.isDefault, data, logoUrl: data.logo ? brandLogoUrl(k.id, data.logo) : null, updatedAt: k.updatedAt };
}

function mustKit(id: string): BrandKit {
	const k = repos.brandKits.get(id);
	if (!k) throw new Error("This brand kit was not found. It may have been deleted.");
	return k;
}

function save(id: string, patch: Partial<Pick<BrandKit, "name" | "data" | "isDefault">>): BrandKitView {
	repos.brandKits.update(id, patch);
	return kitView(mustKit(id));
}

export function listKits(): BrandKitView[] {
	return repos.brandKits
		.list({ orderBy: "createdAt" })
		.reverse()
		.sort((a, b) => Number(b.isDefault) - Number(a.isDefault))
		.map(kitView);
}

/** Makes one kit the default (the one every new render uses). */
export function setDefaultKit(id: string): BrandKitView {
	mustKit(id);
	for (const k of repos.brandKits.list()) if (k.isDefault !== (k.id === id)) repos.brandKits.update(k.id, { isDefault: k.id === id });
	return kitView(mustKit(id));
}

export function createKit(name: string, data: BrandKitData): BrandKitView {
	const first = repos.brandKits.list().length === 0;
	const k = repos.brandKits.create({ name, data: { ...data, logo: null }, isDefault: first });
	return kitView(k);
}

/** Saves the form. The logo is changed only by setLogo/clearLogo, never by the form. */
export function updateKit(id: string, name: string, data: BrandKitData): BrandKitView {
	const k = mustKit(id);
	const logo = dataOf(k).logo;
	return save(id, { name, data: { ...data, logo } });
}

export async function removeKit(id: string): Promise<void> {
	const k = mustKit(id);
	repos.brandKits.remove(id);
	await rm(kitDir(id), { recursive: true, force: true });
	// Another kit becomes the default, so renders keep their branding.
	if (k.isDefault) {
		const next = repos.brandKits.list({ orderBy: "createdAt" })[0];
		if (next) repos.brandKits.update(next.id, { isDefault: true });
	}
}

/** Copies a picked image into the kit folder as logo-<hash>.<ext>. Only PNG, JPEG and WebP up to 5 MB. */
export async function setLogo(id: string, path: string): Promise<BrandKitView> {
	const k = mustKit(id);
	const s = await stat(path);
	if (!s.isFile()) throw new Error("Pick an image file.");
	if (s.size > LOGO_MAX_BYTES) throw new Error("This image is bigger than 5 MB. Use a smaller logo.");
	const bytes = await readFile(path);
	const type = logoType(bytes.subarray(0, 16));
	if (!type) throw new Error(`"${extname(path) || "this file"}" is not a PNG, JPEG or WebP image.`);
	const name = `logo-${createHash("sha256").update(bytes).digest("hex").slice(0, 8)}.${type}`;
	const dir = kitDir(id);
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, name), bytes);
	// Old logos go; only the new one stays.
	for (const f of await readdir(dir)) if (f !== name) await rm(join(dir, f), { force: true });
	return save(id, { data: { ...dataOf(k), logo: name } });
}

export async function clearLogo(id: string): Promise<BrandKitView> {
	const k = mustKit(id);
	await rm(kitDir(id), { recursive: true, force: true });
	return save(id, { data: { ...dataOf(k), logo: null } });
}

/** The kit a draft uses: its own, else its series', else the default kit. */
export function kitForDraft(d: Draft): BrandKit | null {
	const own = d.brandKitId ? repos.brandKits.get(d.brandKitId) : null;
	if (own) return own;
	const series = d.seriesId ? repos.series.get(d.seriesId) : null;
	const fromSeries = series?.brandKitId ? repos.brandKits.get(series.brandKitId) : null;
	if (fromSeries) return fromSeries;
	return repos.brandKits.list().find((k) => k.isDefault) ?? null;
}

/** What a render of this draft puts in plan.meta.brand, or null when there is no kit. */
export function stampForDraft(d: Draft): BrandStamp | null {
	const k = kitForDraft(d);
	if (!k) return null;
	const data = dataOf(k);
	const logo = data.logo && existsSync(join(kitDir(k.id), data.logo)) ? brandLogoUrl(k.id, data.logo) : null;
	const series = d.seriesId ? repos.series.get(d.seriesId) : null;
	return brandStamp(data, logo, series && d.episode ? { title: series.title, episode: d.episode } : null);
}
