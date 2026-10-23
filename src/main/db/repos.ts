import type { AiUsage, Asset, BrandKit, Draft, Job, Provider, Series, Video } from "@shared/models";
import { db as appDb, type Db } from "./connection";
import { defineRepo } from "./repo";

/** All repos, bound to one database. Main uses `repos` (the app database); tests pass their own. */
export function createRepos(getDb: () => Db = appDb) {
	return {
		providers: defineRepo<Provider, "models" | "enabled" | "isDefault">(
			"providers",
			{
				id: "text",
				kind: "text",
				name: "text",
				baseUrl: "text",
				models: "json",
				secret: "blob",
				enabled: "bool",
				defaultModel: "text",
				isDefault: "bool",
				testOk: "bool",
				testError: "text",
				testedAt: "text",
				createdAt: "text",
				updatedAt: "text",
			},
			getDb,
		),
		aiUsage: defineRepo<AiUsage, "attempt" | "inputTokens" | "outputTokens" | "cacheReadTokens" | "cacheWriteTokens" | "durationMs">(
			"ai_usage",
			{
				id: "text",
				providerId: "text",
				providerKind: "text",
				providerName: "text",
				model: "text",
				slot: "text",
				purpose: "text",
				attempt: "int",
				draftId: "text",
				ok: "bool",
				error: "text",
				inputTokens: "int",
				outputTokens: "int",
				cacheReadTokens: "int",
				cacheWriteTokens: "int",
				costUsd: "real",
				billing: "text",
				durationMs: "int",
				createdAt: "text",
				updatedAt: "text",
			},
			getDb,
		),
		brandKits: defineRepo<BrandKit, "data" | "isDefault">(
			"brand_kits",
			{ id: "text", name: "text", data: "json", isDefault: "bool", createdAt: "text", updatedAt: "text" },
			getDb,
		),
		series: defineRepo<Series, "description" | "style">(
			"series",
			{ id: "text", title: "text", description: "text", style: "json", brandKitId: "text", createdAt: "text", updatedAt: "text" },
			getDb,
		),
		drafts: defineRepo<Draft, "stage" | "source">(
			"drafts",
			{
				id: "text",
				title: "text",
				level: "text",
				stage: "text",
				source: "json",
				plan: "json",
				settings: "json",
				outline: "json",
				report: "json",
				voice: "json",
				audio: "json",
				seriesId: "text",
				episode: "int",
				brandKitId: "text",
				createdAt: "text",
				updatedAt: "text",
			},
			getDb,
		),
		videos: defineRepo<Video, "durationMs" | "sizeBytes" | "youtube">(
			"videos",
			{
				id: "text",
				draftId: "text",
				seriesId: "text",
				episode: "int",
				title: "text",
				filePath: "text",
				thumbnailPath: "text",
				durationMs: "int",
				width: "int",
				height: "int",
				sizeBytes: "int",
				youtube: "json",
				createdAt: "text",
				updatedAt: "text",
			},
			getDb,
		),
		assets: defineRepo<Asset, "tags" | "bytes" | "favorite">(
			"assets",
			{
				id: "text",
				kind: "text",
				title: "text",
				filePath: "text",
				durationMs: "int",
				tags: "json",
				mood: "text",
				source: "text",
				sourceUrl: "text",
				author: "text",
				license: "text",
				licenseUrl: "text",
				attribution: "text",
				sha256: "text",
				bytes: "int",
				favorite: "bool",
				energy: "text",
				bpm: "int",
				pack: "text",
				createdAt: "text",
				updatedAt: "text",
			},
			getDb,
		),
		jobs: defineRepo<Job, "status" | "progress" | "payload">(
			"jobs",
			{
				id: "text",
				kind: "text",
				status: "text",
				draftId: "text",
				progress: "real",
				detail: "text",
				error: "text",
				payload: "json",
				result: "json",
				startedAt: "text",
				finishedAt: "text",
				createdAt: "text",
				updatedAt: "text",
			},
			getDb,
		),
		settings: settingsRepo(getDb),
	};
}

/** Key/value settings. Values are JSON. */
function settingsRepo(getDb: () => Db) {
	return {
		get<T>(key: string): T | undefined {
			const row = getDb().prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
			return row ? (JSON.parse(row.value) as T) : undefined;
		},
		set(key: string, value: unknown): void {
			getDb()
				.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
				.run(key, JSON.stringify(value ?? null), new Date().toISOString());
		},
		remove(key: string): boolean {
			return Number(getDb().prepare("DELETE FROM settings WHERE key = ?").run(key).changes) > 0;
		},
		all(): Record<string, unknown> {
			const rows = getDb().prepare("SELECT key, value FROM settings ORDER BY key").all() as { key: string; value: string }[];
			return Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value)]));
		},
	};
}

export type Repos = ReturnType<typeof createRepos>;
export const repos = createRepos();
