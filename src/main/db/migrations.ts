/**
 * Schema migrations. Append only: never edit a migration that has shipped.
 * `version` must count up from 1; it is stored in PRAGMA user_version.
 * Timestamps are ISO-8601 text. JSON columns hold text checked with json_valid.
 */
export type Migration = { version: number; name: string; sql: string };

export const MIGRATIONS: Migration[] = [
	{
		version: 1,
		name: "init",
		sql: `
CREATE TABLE settings (
	key        TEXT PRIMARY KEY,
	value      TEXT NOT NULL CHECK (json_valid(value)),
	updated_at TEXT NOT NULL
);

CREATE TABLE providers (
	id         TEXT PRIMARY KEY,
	kind       TEXT NOT NULL,
	name       TEXT NOT NULL,
	base_url   TEXT,
	models     TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(models)),
	secret     BLOB,
	enabled    INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);

CREATE TABLE brand_kits (
	id         TEXT PRIMARY KEY,
	name       TEXT NOT NULL,
	data       TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(data)),
	is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);

CREATE TABLE series (
	id           TEXT PRIMARY KEY,
	title        TEXT NOT NULL,
	description  TEXT NOT NULL DEFAULT '',
	style        TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(style)),
	brand_kit_id TEXT REFERENCES brand_kits(id) ON DELETE SET NULL,
	created_at   TEXT NOT NULL,
	updated_at   TEXT NOT NULL
);

CREATE TABLE drafts (
	id           TEXT PRIMARY KEY,
	title        TEXT NOT NULL,
	level        TEXT NOT NULL,
	stage        TEXT NOT NULL DEFAULT 'source',
	source       TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(source)),
	plan         TEXT CHECK (plan IS NULL OR json_valid(plan)),
	series_id    TEXT REFERENCES series(id) ON DELETE SET NULL,
	brand_kit_id TEXT REFERENCES brand_kits(id) ON DELETE SET NULL,
	created_at   TEXT NOT NULL,
	updated_at   TEXT NOT NULL
);
CREATE INDEX drafts_updated ON drafts(updated_at DESC);

CREATE TABLE videos (
	id             TEXT PRIMARY KEY,
	draft_id       TEXT REFERENCES drafts(id) ON DELETE SET NULL,
	series_id      TEXT REFERENCES series(id) ON DELETE SET NULL,
	episode        INTEGER,
	title          TEXT NOT NULL,
	file_path      TEXT NOT NULL,
	thumbnail_path TEXT,
	duration_ms    INTEGER NOT NULL DEFAULT 0,
	width          INTEGER NOT NULL,
	height         INTEGER NOT NULL,
	size_bytes     INTEGER NOT NULL DEFAULT 0,
	youtube        TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(youtube)),
	created_at     TEXT NOT NULL,
	updated_at     TEXT NOT NULL
);
CREATE INDEX videos_created ON videos(created_at DESC);

CREATE TABLE assets (
	id          TEXT PRIMARY KEY,
	kind        TEXT NOT NULL CHECK (kind IN ('music', 'sfx', 'image', 'font')),
	title       TEXT NOT NULL,
	file_path   TEXT NOT NULL,
	duration_ms INTEGER,
	tags        TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tags)),
	mood        TEXT,
	source      TEXT NOT NULL,
	source_url  TEXT,
	author      TEXT,
	license     TEXT NOT NULL,
	license_url TEXT,
	attribution TEXT,
	sha256      TEXT,
	bytes       INTEGER NOT NULL DEFAULT 0,
	created_at  TEXT NOT NULL,
	updated_at  TEXT NOT NULL
);
CREATE INDEX assets_kind ON assets(kind);
CREATE UNIQUE INDEX assets_sha ON assets(sha256) WHERE sha256 IS NOT NULL;

CREATE TABLE jobs (
	id          TEXT PRIMARY KEY,
	kind        TEXT NOT NULL,
	status      TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'cancelled', 'error')),
	draft_id    TEXT REFERENCES drafts(id) ON DELETE CASCADE,
	progress    REAL NOT NULL DEFAULT 0,
	detail      TEXT,
	error       TEXT,
	payload     TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(payload)),
	result      TEXT CHECK (result IS NULL OR json_valid(result)),
	started_at  TEXT,
	finished_at TEXT,
	created_at  TEXT NOT NULL,
	updated_at  TEXT NOT NULL
);
CREATE INDEX jobs_status ON jobs(status, created_at);
`,
	},
	{
		version: 2,
		name: "ai-providers",
		sql: `
ALTER TABLE providers ADD COLUMN default_model TEXT;
ALTER TABLE providers ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1));
ALTER TABLE providers ADD COLUMN test_ok INTEGER CHECK (test_ok IS NULL OR test_ok IN (0, 1));
ALTER TABLE providers ADD COLUMN test_error TEXT;
ALTER TABLE providers ADD COLUMN tested_at TEXT;

CREATE TABLE ai_usage (
	id                 TEXT PRIMARY KEY,
	provider_id        TEXT REFERENCES providers(id) ON DELETE SET NULL,
	provider_kind      TEXT NOT NULL,
	provider_name      TEXT NOT NULL,
	model              TEXT NOT NULL,
	slot               TEXT,
	purpose            TEXT NOT NULL,
	attempt            INTEGER NOT NULL DEFAULT 1,
	draft_id           TEXT REFERENCES drafts(id) ON DELETE SET NULL,
	ok                 INTEGER NOT NULL CHECK (ok IN (0, 1)),
	error              TEXT,
	input_tokens       INTEGER NOT NULL DEFAULT 0,
	output_tokens      INTEGER NOT NULL DEFAULT 0,
	cache_read_tokens  INTEGER NOT NULL DEFAULT 0,
	cache_write_tokens INTEGER NOT NULL DEFAULT 0,
	cost_usd           REAL,
	billing            TEXT NOT NULL CHECK (billing IN ('api', 'free', 'subscription', 'unknown')),
	duration_ms        INTEGER NOT NULL DEFAULT 0,
	created_at         TEXT NOT NULL,
	updated_at         TEXT NOT NULL
);
CREATE INDEX ai_usage_created ON ai_usage(created_at DESC);
`,
	},
	{
		version: 3,
		name: "planner",
		sql: `
ALTER TABLE drafts ADD COLUMN settings TEXT CHECK (settings IS NULL OR json_valid(settings));
ALTER TABLE drafts ADD COLUMN outline TEXT CHECK (outline IS NULL OR json_valid(outline));
ALTER TABLE drafts ADD COLUMN report TEXT CHECK (report IS NULL OR json_valid(report));
`,
	},
	{
		version: 4,
		name: "voice",
		sql: `
ALTER TABLE drafts ADD COLUMN voice TEXT CHECK (voice IS NULL OR json_valid(voice));
`,
	},
	{
		version: 5,
		name: "assets",
		sql: `
ALTER TABLE assets ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1));
ALTER TABLE assets ADD COLUMN energy TEXT;
ALTER TABLE assets ADD COLUMN bpm INTEGER;
ALTER TABLE assets ADD COLUMN pack TEXT;
ALTER TABLE drafts ADD COLUMN audio TEXT CHECK (audio IS NULL OR json_valid(audio));
`,
	},
	{
		version: 6,
		name: "series-episodes",
		sql: `
ALTER TABLE drafts ADD COLUMN episode INTEGER CHECK (episode IS NULL OR episode >= 1);
CREATE INDEX drafts_series ON drafts(series_id, episode);
CREATE INDEX videos_series ON videos(series_id, episode);
`,
	},
];

/** Every table the current schema must have. Used by tests and the boot check. */
export const TABLES = ["settings", "providers", "brand_kits", "series", "drafts", "videos", "assets", "jobs", "ai_usage"] as const;
