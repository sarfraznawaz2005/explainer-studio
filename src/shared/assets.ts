import { z } from "zod";

/**
 * Asset library rules shared by main and the renderer: kinds, moods and, most
 * important, licenses. Only licenses that allow monetised YouTube videos get in:
 * CC0, public domain, CC BY (with credit) and files the user owns.
 * NonCommercial, NoDerivatives, ShareAlike and Sampling+ are always refused.
 * See PLAN.md section 10.
 */

export const AssetKind = z.enum(["music", "sfx", "image", "font"]);
export type AssetKind = z.infer<typeof AssetKind>;

export const MOODS = ["calm", "upbeat", "curious", "dramatic", "playful", "ambient"] as const;
export const Mood = z.enum(MOODS);
export type Mood = z.infer<typeof Mood>;

export const Energy = z.enum(["low", "medium", "high"]);
export type Energy = z.infer<typeof Energy>;

/** Sound roles the mixer fills automatically. */
export const SFX_ROLES = ["reveal", "transition", "correct"] as const;
export const SfxRole = z.enum(SFX_ROLES);
export type SfxRole = z.infer<typeof SfxRole>;

/* ---------- Licenses ---------- */

export const LicenseCode = z.enum(["CC0-1.0", "PD", "CC-BY-4.0", "CC-BY-3.0", "CC-BY-2.5", "CC-BY-2.0", "OWNED"]);
export type LicenseCode = z.infer<typeof LicenseCode>;

export const LICENSES: Record<LicenseCode, { label: string; short: string; url: string | null; credit: boolean }> = {
	"CC0-1.0": { label: "CC0 1.0 (public domain dedication)", short: "CC0", url: "https://creativecommons.org/publicdomain/zero/1.0/", credit: false },
	PD: { label: "Public domain", short: "Public domain", url: "https://creativecommons.org/publicdomain/mark/1.0/", credit: false },
	"CC-BY-4.0": { label: "CC BY 4.0 (credit required)", short: "CC BY 4.0", url: "https://creativecommons.org/licenses/by/4.0/", credit: true },
	"CC-BY-3.0": { label: "CC BY 3.0 (credit required)", short: "CC BY 3.0", url: "https://creativecommons.org/licenses/by/3.0/", credit: true },
	"CC-BY-2.5": { label: "CC BY 2.5 (credit required)", short: "CC BY 2.5", url: "https://creativecommons.org/licenses/by/2.5/", credit: true },
	"CC-BY-2.0": { label: "CC BY 2.0 (credit required)", short: "CC BY 2.0", url: "https://creativecommons.org/licenses/by/2.0/", credit: true },
	OWNED: { label: "My own work, or I have a license for it", short: "Own / licensed", url: null, credit: false },
};

export class LicenseError extends Error {
	constructor(reason: string) {
		super(reason);
		this.name = "LicenseError";
	}
}

export type LicenseVerdict = { ok: true; code: LicenseCode } | { ok: false; reason: string };

const NC_REASON = "NonCommercial (NC) licenses are not allowed: they break YouTube monetisation.";

/**
 * Reads a license name or URL (Freesound, Creative Commons, free text) and says
 * whether the app may use it. Anything unclear is refused.
 */
export function classifyLicense(raw: string | null | undefined): LicenseVerdict {
	const text = (raw ?? "").trim();
	if (!text) return { ok: false, reason: "The license is unknown." };
	if ((LicenseCode.options as string[]).includes(text)) return { ok: true, code: text as LicenseCode };
	const s = text.toLowerCase();
	// Refusals first, so "Attribution NonCommercial" never matches "Attribution".
	if (/(^|[^a-z])nc([^a-z]|$)|non-?commercial|noncommercial/.test(s)) return { ok: false, reason: NC_REASON };
	if (/(^|[^a-z])nd([^a-z]|$)|no-?deriv/.test(s)) return { ok: false, reason: "NoDerivatives (ND) licenses are not allowed: a video is a derivative work." };
	if (/(^|[^a-z])sa([^a-z]|$)|share-?alike/.test(s)) return { ok: false, reason: "ShareAlike (SA) licenses are not allowed: the whole video would have to use the same license." };
	if (/sampling/.test(s)) return { ok: false, reason: "Sampling+ licenses are not allowed." };
	if (/publicdomain\/zero|creative commons 0|^cc0|cc0 ?1\.0|^cc-?zero/.test(s)) return { ok: true, code: "CC0-1.0" };
	if (/publicdomain\/mark|^public domain$|^pd$/.test(s)) return { ok: true, code: "PD" };
	const by = /creativecommons\.org\/licenses\/by\/(\d\.\d)\/?$/.exec(s) ?? /^(?:cc[ -]?by|attribution)(?:[ -](\d\.\d))?$/.exec(s);
	if (by) return { ok: true, code: by[1] === "3.0" ? "CC-BY-3.0" : by[1] === "2.5" ? "CC-BY-2.5" : by[1] === "2.0" ? "CC-BY-2.0" : "CC-BY-4.0" };
	return { ok: false, reason: `The license "${text.slice(0, 60)}" is not one the app can use. Only CC0, public domain and CC BY are allowed.` };
}

/** Throws LicenseError unless the license is allowed. */
export function requireLicense(raw: string | null | undefined): LicenseCode {
	const v = classifyLicense(raw);
	if (!v.ok) throw new LicenseError(v.reason);
	return v.code;
}

/** Credit line for the YouTube description. Null when the license does not need one. */
export function attributionFor(a: { title: string; author: string | null; license: string; sourceUrl: string | null }): string | null {
	const v = classifyLicense(a.license);
	if (!v.ok || !LICENSES[v.code].credit) return null;
	const by = a.author ? ` by ${a.author}` : "";
	const src = a.sourceUrl ? ` (${a.sourceUrl})` : "";
	return `"${a.title}"${by}${src}, licensed under ${LICENSES[v.code].short}: ${LICENSES[v.code].url}`;
}

/* ---------- Library rows as the renderer sees them ---------- */

export const AssetView = z.object({
	id: z.string(),
	kind: AssetKind,
	title: z.string(),
	/** es-media URL for playback in the app. */
	url: z.string(),
	durationMs: z.number().nullable(),
	tags: z.array(z.string()),
	mood: Mood.nullable(),
	energy: Energy.nullable(),
	bpm: z.number().nullable(),
	favorite: z.boolean(),
	/** "starter", "freesound" or "import". */
	source: z.string(),
	pack: z.string().nullable(),
	sourceUrl: z.string().nullable(),
	author: z.string().nullable(),
	license: LicenseCode,
	licenseUrl: z.string().nullable(),
	attribution: z.string().nullable(),
	bytes: z.number(),
	createdAt: z.string(),
});
export type AssetView = z.infer<typeof AssetView>;

const Tag = z.string().trim().min(1).max(30);

export const AssetPatch = z.object({
	title: z.string().trim().min(1).max(120).optional(),
	tags: z.array(Tag).max(20).optional(),
	mood: Mood.nullable().optional(),
	energy: Energy.nullable().optional(),
	bpm: z.number().int().min(20).max(300).nullable().optional(),
	favorite: z.boolean().optional(),
});
export type AssetPatch = z.infer<typeof AssetPatch>;

/** What the user declares when importing their own files. */
export const ImportLicense = z.object({
	license: LicenseCode,
	author: z.string().trim().max(120).optional(),
	sourceUrl: z.url({ protocol: /^https?$/ }).max(500).optional(),
});
export type ImportLicense = z.infer<typeof ImportLicense>;

/* ---------- Starter pack ---------- */

export const StarterState = z.enum(["none", "installing", "installed", "partial", "failed", "cancelled"]);
export const StarterStatus = z.object({
	state: StarterState,
	done: z.number(),
	total: z.number(),
	bytesDone: z.number(),
	bytesTotal: z.number(),
	detail: z.string().optional(),
	error: z.string().optional(),
});
export type StarterStatus = z.infer<typeof StarterStatus>;

/* ---------- Freesound ---------- */

export const FreesoundHit = z.object({
	id: z.number().int().positive(),
	name: z.string(),
	username: z.string(),
	license: LicenseCode,
	durationMs: z.number(),
	previewUrl: z.string(),
	pageUrl: z.string(),
	tags: z.array(z.string()),
	/** Already in the library. */
	imported: z.boolean(),
});
export type FreesoundHit = z.infer<typeof FreesoundHit>;

export const FreesoundResults = z.object({ count: z.number(), page: z.number(), pages: z.number(), hits: z.array(FreesoundHit), skipped: z.number() });
export type FreesoundResults = z.infer<typeof FreesoundResults>;

/* ---------- Draft sound setup ---------- */

/** Per-draft music and sound effect choices. Asset ids point into the shared library. */
export const SoundSetup = z.object({
	music: z
		.object({
			enabled: z.boolean().default(true),
			volume: z.number().min(0).max(1).default(0.22),
			duck: z.boolean().default(true),
			/** Chapter id → asset id, or "none" for silence. Missing chapters use the automatic pick. */
			picks: z.record(z.string().max(64), z.string().max(64)).default({}),
		})
		.prefault({}),
	sfx: z
		.object({
			enabled: z.boolean().default(true),
			volume: z.number().min(0).max(1).default(0.35),
			/** Role → asset id. Missing roles use the starter pack default. */
			roles: z.partialRecord(SfxRole, z.string().max(64)).default({}),
		})
		.prefault({}),
});
export type SoundSetup = z.infer<typeof SoundSetup>;
export type SoundSetupInput = z.input<typeof SoundSetup>;
