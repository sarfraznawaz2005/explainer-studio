import { classifyLicense, LicenseError, type AssetKind, type FreesoundHit, type FreesoundResults } from "@shared/assets";
import type { AssetLibrary } from "./library";

/**
 * Freesound search and import with the user's own API key (Settings → Assets).
 * Only CC0 and CC BY sounds are shown: the search asks Freesound for those two,
 * and every result is checked again here, because the server filter is not the
 * safety net. Import fetches the sound again by id (nothing the renderer sends is
 * trusted), re-checks the license, and downloads the HQ preview MP3 from
 * Freesound's own CDN. The key goes in a header, never in a URL or a log.
 */

const API = "https://freesound.org/apiv2";
const FIELDS = "id,name,username,license,duration,previews,tags,url";
const PAGE_SIZE = 20;
const MAX_DOWNLOAD = 25_000_000;
const MEDIA_HOSTS = ["freesound.org", "cdn.freesound.org"];

/** Server-side filter: CC0 and Attribution (3.0 and 4.0) only. */
export const LICENSE_FILTER = 'license:("Creative Commons 0" OR "Attribution")';
const DURATION_FILTER: Record<"music" | "sfx", string> = { sfx: "duration:[0 TO 30]", music: "duration:[20 TO 900]" };

type RawSound = { id: number; name: string; username: string; license: string; duration: number; previews?: Record<string, string>; tags?: string[]; url: string };

export class FreesoundError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "FreesoundError";
	}
}

async function api<T>(path: string, key: string, fetchImpl: typeof fetch, signal?: AbortSignal): Promise<T> {
	if (!key) throw new FreesoundError("Add your Freesound API key in Settings → Assets first.");
	let res: Response;
	try {
		res = await fetchImpl(`${API}${path}`, { headers: { Authorization: `Token ${key}`, Accept: "application/json" }, signal });
	} catch (err) {
		if ((err as Error).name === "AbortError") throw err;
		throw new FreesoundError("Freesound could not be reached. Check your internet connection.");
	}
	if (res.status === 401 || res.status === 403) throw new FreesoundError("Freesound refused the API key. Check it in Settings → Assets.");
	if (res.status === 404) throw new FreesoundError("This sound is no longer on Freesound.");
	if (res.status === 429) throw new FreesoundError("Freesound says there were too many searches. Wait a minute and try again.");
	if (!res.ok) throw new FreesoundError(`Freesound answered with an error (HTTP ${res.status}).`);
	return (await res.json()) as T;
}

function previewUrl(s: RawSound): string | null {
	const u = s.previews?.["preview-hq-mp3"] ?? s.previews?.["preview-lq-mp3"];
	if (!u) return null;
	try {
		const url = new URL(u);
		return url.protocol === "https:" && MEDIA_HOSTS.includes(url.hostname) ? url.href : null;
	} catch {
		return null;
	}
}

/** A Freesound result the app may use, or null (NC, unknown license, no safe preview). */
export function toHit(s: RawSound, imported: (url: string) => boolean): FreesoundHit | null {
	const lic = classifyLicense(s.license);
	const preview = previewUrl(s);
	if (!lic.ok || !preview || !Number.isInteger(s.id)) return null;
	return {
		id: s.id,
		name: String(s.name).slice(0, 120),
		username: String(s.username).slice(0, 60),
		license: lic.code,
		durationMs: Math.round(Number(s.duration) * 1000) || 0,
		previewUrl: preview,
		pageUrl: s.url,
		tags: (s.tags ?? []).slice(0, 8).map((t) => String(t).slice(0, 30)),
		imported: imported(s.url),
	};
}

export async function searchFreesound(
	key: string,
	q: { query: string; kind: "music" | "sfx"; page: number },
	deps: { fetchImpl?: typeof fetch; signal?: AbortSignal; imported?: (url: string) => boolean } = {},
): Promise<FreesoundResults> {
	const params = new URLSearchParams({ query: q.query, filter: `${LICENSE_FILTER} ${DURATION_FILTER[q.kind]}`, fields: FIELDS, page: String(q.page), page_size: String(PAGE_SIZE) });
	const r = await api<{ count: number; results: RawSound[] }>(`/search/text/?${params}`, key, deps.fetchImpl ?? fetch, deps.signal);
	const hits: FreesoundHit[] = [];
	let skipped = 0;
	for (const s of r.results ?? []) {
		const h = toHit(s, deps.imported ?? (() => false));
		if (h) hits.push(h);
		else skipped++;
	}
	return { count: r.count ?? 0, page: q.page, pages: Math.max(1, Math.ceil((r.count ?? 0) / PAGE_SIZE)), hits, skipped };
}

/** Checks that a key works with one tiny search. */
export async function testFreesoundKey(key: string, fetchImpl: typeof fetch = fetch): Promise<void> {
	await api(`/search/text/?${new URLSearchParams({ query: "click", page_size: "1", fields: "id" })}`, key, fetchImpl);
}

async function downloadCapped(url: string, fetchImpl: typeof fetch, signal?: AbortSignal): Promise<Buffer> {
	const res = await fetchImpl(url, { signal, redirect: "follow" });
	const final = new URL(res.url || url);
	if (final.protocol !== "https:" || !MEDIA_HOSTS.includes(final.hostname)) throw new FreesoundError("The sound file is not on Freesound's servers. It was not downloaded.");
	if (!res.ok || !res.body) throw new FreesoundError(`The sound could not be downloaded (HTTP ${res.status}).`);
	const chunks: Buffer[] = [];
	let n = 0;
	const reader = res.body.getReader();
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		n += value.byteLength;
		if (n > MAX_DOWNLOAD) {
			await reader.cancel().catch(() => undefined);
			throw new FreesoundError("The sound file is too large.");
		}
		chunks.push(Buffer.from(value));
	}
	return Buffer.concat(chunks);
}

export async function importFreesound(
	key: string,
	id: number,
	kind: Extract<AssetKind, "music" | "sfx">,
	deps: { lib: AssetLibrary; fetchImpl?: typeof fetch; signal?: AbortSignal },
) {
	const fetchImpl = deps.fetchImpl ?? fetch;
	const s = await api<RawSound>(`/sounds/${id}/?${new URLSearchParams({ fields: FIELDS })}`, key, fetchImpl, deps.signal);
	const lic = classifyLicense(s.license);
	if (!lic.ok) throw new LicenseError(lic.reason);
	const url = previewUrl(s);
	if (!url) throw new FreesoundError("This sound has no preview file the app can download.");
	const bytes = await downloadCapped(url, fetchImpl, deps.signal);
	return deps.lib.add({
		kind,
		title: s.name.replace(/\.(wav|mp3|ogg|flac|aiff?)$/i, ""),
		bytes,
		source: "freesound",
		pack: "Freesound",
		sourceUrl: s.url,
		author: s.username,
		license: lic.code,
		tags: s.tags?.slice(0, 10),
	});
}
