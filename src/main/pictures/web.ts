import { attributionFor, classifyLicense, type LicenseCode } from "@shared/assets";
import type { PictureCredit } from "@shared/source";
import { imageSize } from "../ingest/images";

/**
 * Free pictures on the web, without API keys:
 *  - Wikidata: the main picture of a named person, place or thing (P18), with its
 *    license read from Wikimedia (commons.wikimedia.org, or en.wikipedia.org when
 *    Commons cannot be reached; both serve the same file data).
 *  - Openverse: a search over openly licensed pictures (Wikimedia, Flickr, museums).
 *  - NASA: space and earth pictures, US government public domain.
 * Only CC0, public domain and CC BY are kept (classifyLicense): ShareAlike,
 * NonCommercial, NoDerivatives and anything unclear are dropped. Downloads are
 * https only, size-capped, and must really be PNG, JPEG, WebP or GIF.
 */

export const USER_AGENT = "ExplainerStudio/1.0 (desktop video app; picture search)";
const MAX_BYTES = 25 * 1024 * 1024;
const TIMEOUT_MS = 30_000;

export type Candidate = {
	/** Stable key for "already used / already rejected" checks. */
	key: string;
	title: string;
	/** Small picture for the vision check (about 500 px). */
	preview: string;
	/** The picture to save (at most about 1920 px wide when the source offers sizes). */
	full: string;
	width: number;
	height: number;
	credit: PictureCredit;
	/** Wikidata's own picture of the named subject: trusted without a vision check. */
	canonical: boolean;
};

export type WebDeps = { fetchImpl?: typeof fetch; signal?: AbortSignal };

const stripHtml = (s: unknown) =>
	String(s ?? "")
		.replace(/<[^>]*>/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/&quot;/g, '"')
		.replace(/&#0?39;/g, "'")
		.replace(/&nbsp;/g, " ")
		.replace(/\s+/g, " ")
		.trim();

/**
 * fetch that waits and tries once more when a site says "too many requests" (429)
 * or "busy" (503), as Wikimedia and Openverse ask. The wait follows Retry-After, 1 to 5 seconds.
 */
async function politeFetch(url: string, init: RequestInit, deps: WebDeps): Promise<Response> {
	const go = () => (deps.fetchImpl ?? fetch)(url, init);
	const r = await go();
	if (r.status !== 429 && r.status !== 503) return r;
	const after = Number(r.headers.get("retry-after"));
	const ms = Math.min(5000, Math.max(1000, Number.isFinite(after) && after > 0 ? after * 1000 : 1500));
	await new Promise<void>((resolve, reject) => {
		const t = setTimeout(resolve, ms);
		init.signal?.addEventListener("abort", () => {
			clearTimeout(t);
			reject(init.signal!.reason);
		});
	});
	return go();
}

async function getJson(url: string, deps: WebDeps): Promise<unknown> {
	const signal = deps.signal ? AbortSignal.any([deps.signal, AbortSignal.timeout(TIMEOUT_MS)]) : AbortSignal.timeout(TIMEOUT_MS);
	const r = await politeFetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" }, signal }, deps);
	if (!r.ok) throw new Error(`HTTP ${r.status} from ${new URL(url).host}`);
	return r.json();
}

/** The credit for a found picture, or null when its license is not allowed. */
export function creditFor(p: { title: string; creator: string | null; license: string; pageUrl: string; provider: string }): PictureCredit | null {
	const v = classifyLicense(p.license);
	if (!v.ok || v.code === "OWNED") return null;
	if (!/^https:\/\//.test(p.pageUrl)) return null;
	const title = p.title.trim().slice(0, 300) || "Untitled";
	const creator = p.creator?.trim().slice(0, 200) || null;
	const line = attributionFor({ title, author: creator, license: v.code, sourceUrl: p.pageUrl });
	return { title, creator, license: v.code as LicenseCode, pageUrl: p.pageUrl, provider: p.provider, line: line ? line.slice(0, 600) : null };
}

/* ---------- Wikimedia files ---------- */

const UPLOAD = /^https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\/([0-9a-f])\/([0-9a-f]{2})\/([^/?#]+)$/;

/** A Wikimedia thumbnail of the original at a standard width (500, 960, 1280, 1920), or null for other files. */
export function wikimediaThumb(original: string, width: 500 | 960 | 1280 | 1920): string | null {
	const m = UPLOAD.exec(original.split("?")[0]!);
	if (!m || !/\.(jpe?g|png|webp)$/i.test(m[3]!)) return null;
	return `https://upload.wikimedia.org/wikipedia/commons/thumb/${m[1]}/${m[2]}/${m[3]}/${width}px-${m[3]}`;
}

type ImageInfo = { url: string; width: number; height: number; descriptionurl?: string; extmetadata?: Record<string, { value?: unknown }> };

/** File page data for a Commons file name ("Foo.jpg"). Tries Commons, then English Wikipedia. */
async function commonsFile(name: string, deps: WebDeps): Promise<ImageInfo | null> {
	const q = new URLSearchParams({
		action: "query",
		format: "json",
		prop: "imageinfo",
		iiprop: "url|size|extmetadata",
		iiextmetadatafilter: "LicenseShortName|LicenseUrl|Artist|ObjectName",
		titles: `File:${name}`,
	});
	for (const host of ["commons.wikimedia.org", "en.wikipedia.org"]) {
		try {
			const d = (await getJson(`https://${host}/w/api.php?${q}`, deps)) as { query?: { pages?: Record<string, { imageinfo?: ImageInfo[] }> } };
			const info = Object.values(d.query?.pages ?? {})[0]?.imageinfo?.[0];
			if (info) return info;
		} catch (err) {
			if (deps.signal?.aborted) throw err;
		}
	}
	return null;
}

function fromCommonsInfo(name: string, info: ImageInfo, canonical: boolean): Candidate | null {
	const meta = info.extmetadata ?? {};
	const license = stripHtml(meta.LicenseShortName?.value) || stripHtml(meta.LicenseUrl?.value);
	const pageUrl = info.descriptionurl ?? `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(name.replace(/ /g, "_"))}`;
	const credit = creditFor({ title: stripHtml(meta.ObjectName?.value) || name.replace(/\.[a-z]+$/i, ""), creator: stripHtml(meta.Artist?.value) || null, license, pageUrl, provider: "wikimedia" });
	if (!credit) return null;
	const preview = wikimediaThumb(info.url, 500) ?? (info.width <= 2000 ? info.url : null);
	const full = info.width > 1920 ? wikimediaThumb(info.url, 1920) : info.url;
	if (!preview || !full) return null;
	const scale = info.width > 1920 ? 1920 / info.width : 1;
	return { key: `wikimedia:${name}`, title: credit.title, preview, full, width: Math.round(info.width * scale), height: Math.round(info.height * scale), credit, canonical };
}

/* ---------- Wikidata ---------- */

export type Entity = { id: string; label: string; description: string | null };

/** The best Wikidata match for a name, with its main pictures (P18). */
export async function wikidataPictures(name: string, deps: WebDeps): Promise<{ entity: Entity | null; candidates: Candidate[] }> {
	const s = (await getJson(`https://www.wikidata.org/w/api.php?${new URLSearchParams({ action: "wbsearchentities", search: name, language: "en", uselang: "en", type: "item", limit: "1", format: "json" })}`, deps)) as {
		search?: { id: string; label?: string; description?: string }[];
	};
	const hit = s.search?.[0];
	if (!hit || !/^Q\d+$/.test(hit.id)) return { entity: null, candidates: [] };
	const entity = { id: hit.id, label: hit.label ?? name, description: hit.description ?? null };
	const c = (await getJson(`https://www.wikidata.org/w/api.php?${new URLSearchParams({ action: "wbgetclaims", entity: hit.id, property: "P18", format: "json" })}`, deps)) as {
		claims?: { P18?: { mainsnak?: { datavalue?: { value?: unknown } } }[] };
	};
	const files = (c.claims?.P18 ?? []).map((x) => x.mainsnak?.datavalue?.value).filter((v): v is string => typeof v === "string").slice(0, 2);
	const out: Candidate[] = [];
	for (const f of files) {
		const info = await commonsFile(f, deps);
		const cand = info && fromCommonsInfo(f, info, true);
		if (cand) out.push(cand);
	}
	return { entity, candidates: out };
}

/* ---------- Openverse ---------- */

type OvResult = { id: string; title?: string; creator?: string; license?: string; license_version?: string; url?: string; thumbnail?: string; foreign_landing_url?: string; width?: number; height?: number; provider?: string; source?: string; mature?: boolean };

const ovLicense = (l?: string, v?: string) => (l === "cc0" ? "CC0" : l === "pdm" ? "Public domain" : l === "by" ? `CC BY ${v ?? ""}`.trim() : (l ?? ""));

export async function openverseSearch(query: string, deps: WebDeps, opts: { count?: number; aspect?: "wide" | "tall" | "square" } = {}): Promise<Candidate[]> {
	const q = new URLSearchParams({ q: query, license: "cc0,pdm,by", page_size: String(opts.count ?? 12), mature: "false" });
	if (opts.aspect) q.set("aspect_ratio", opts.aspect);
	const d = (await getJson(`https://api.openverse.org/v1/images/?${q}`, deps)) as { results?: OvResult[] };
	const out: Candidate[] = [];
	for (const r of d.results ?? []) {
		if (r.mature || !r.url || !/^https:\/\//.test(r.url)) continue;
		const credit = creditFor({ title: r.title ?? query, creator: r.creator ?? null, license: ovLicense(r.license, r.license_version), pageUrl: r.foreign_landing_url ?? "", provider: r.source ?? r.provider ?? "openverse" });
		if (!credit) continue;
		const w = r.width ?? 0;
		const h = r.height ?? 0;
		const wm = wikimediaThumb(r.url, 500);
		const preview = wm ?? (r.thumbnail && /^https:\/\//.test(r.thumbnail) ? r.thumbnail : null);
		if (!preview) continue;
		const full = w > 1920 ? (wikimediaThumb(r.url, 1920) ?? r.url) : r.url;
		const scale = w > 1920 && full !== r.url ? 1920 / w : 1;
		const key = r.url.startsWith("https://upload.wikimedia.org/") ? `wikimedia:${decodeURIComponent(r.url.split("/").pop() ?? "").replace(/_/g, " ")}` : `openverse:${r.id}`;
		out.push({ key, title: credit.title, preview, full, width: Math.round(w * scale), height: Math.round(h * scale), credit, canonical: false });
	}
	return out;
}

/* ---------- NASA ---------- */

type NasaItem = { data?: { nasa_id?: string; title?: string; center?: string; photographer?: string }[]; links?: { href?: string; render?: string }[] };

export async function nasaSearch(query: string, deps: WebDeps, opts: { count?: number } = {}): Promise<Candidate[]> {
	const d = (await getJson(`https://images-api.nasa.gov/search?${new URLSearchParams({ q: query, media_type: "image", page_size: String(opts.count ?? 8) })}`, deps)) as { collection?: { items?: NasaItem[] } };
	const out: Candidate[] = [];
	for (const it of d.collection?.items ?? []) {
		const meta = it.data?.[0];
		const preview = it.links?.find((l) => l.render === "image")?.href;
		if (!meta?.nasa_id || !preview || !/^https:\/\//.test(preview) || !/^[\w.-]{1,80}$/.test(meta.nasa_id)) continue;
		const pageUrl = `https://images.nasa.gov/details/${encodeURIComponent(meta.nasa_id)}`;
		const credit = creditFor({ title: meta.title ?? query, creator: meta.photographer || (meta.center ? `NASA ${meta.center}` : "NASA"), license: "Public domain", pageUrl, provider: "nasa" });
		if (!credit) continue;
		// "~thumb" → "~large": NASA's own large rendition (about 1920 px).
		const full = preview.replace(/~(thumb|small|medium)\.(jpe?g|png)$/i, "~large.$2");
		out.push({ key: `nasa:${meta.nasa_id}`, title: credit.title, preview, full, width: 0, height: 0, credit, canonical: false });
	}
	return out;
}

/* ---------- Download ---------- */

const MEDIA: [string, (b: Buffer) => boolean][] = [
	["image/png", (b) => b.length > 8 && b.readUInt32BE(0) === 0x89504e47],
	["image/jpeg", (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
	["image/webp", (b) => b.length > 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP"],
	["image/gif", (b) => b.length > 6 && b.toString("ascii", 0, 3) === "GIF"],
];

/** Downloads a picture over https. Throws unless it is a real PNG, JPEG, WebP or GIF under 25 MB. */
export async function downloadImage(url: string, deps: WebDeps): Promise<{ data: Buffer; mediaType: string; width: number; height: number }> {
	if (!/^https:\/\//.test(url)) throw new Error("Pictures are only downloaded over https.");
	const signal = deps.signal ? AbortSignal.any([deps.signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000);
	const r = await politeFetch(url, { headers: { "User-Agent": USER_AGENT }, signal, redirect: "follow" }, deps);
	if (!r.ok || !r.body) throw new Error(`HTTP ${r.status} from ${new URL(url).host}`);
	if (r.url && !/^https:\/\//.test(r.url)) throw new Error("The picture was redirected away from https.");
	if (Number(r.headers.get("content-length") ?? 0) > MAX_BYTES) throw new Error("The picture is larger than 25 MB.");
	const chunks: Buffer[] = [];
	let n = 0;
	const reader = r.body.getReader();
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		n += value.byteLength;
		if (n > MAX_BYTES) {
			await reader.cancel();
			throw new Error("The picture is larger than 25 MB.");
		}
		chunks.push(Buffer.from(value));
	}
	const data = Buffer.concat(chunks);
	const mediaType = MEDIA.find(([, test]) => test(data))?.[0];
	if (!mediaType) throw new Error("The download is not a PNG, JPEG, WebP or GIF picture.");
	return { data, mediaType, ...imageSize(data) };
}
