import type { Db } from "./connection";
import { inTransaction } from "./connection";
import type { Migration } from "./migrations";

export function schemaVersion(d: Db): number {
	return (d.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
}

function hasUserTables(d: Db): boolean {
	const row = d.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").get() as { n: number };
	return row.n > 0;
}

/**
 * Applies pending migrations, each in its own transaction.
 * If the database already holds data, `backup` runs first. When the backup
 * fails nothing is migrated and the error propagates.
 */
export async function runMigrations(
	d: Db,
	migrations: Migration[],
	backup?: () => Promise<unknown>,
): Promise<{ from: number; to: number; applied: string[] }> {
	const from = schemaVersion(d);
	const latest = migrations.at(-1)?.version ?? 0;
	if (from > latest) throw new Error(`Database schema v${from} is newer than this app (v${latest}). Update the app.`);
	const pending = migrations.filter((m) => m.version > from);
	if (!pending.length) return { from, to: from, applied: [] };
	if (backup && hasUserTables(d)) await backup();
	for (const m of pending) {
		inTransaction(() => {
			d.exec(m.sql);
			// PRAGMA does not accept bound parameters; version is a number from our own list.
			d.exec(`PRAGMA user_version = ${Math.trunc(m.version)}`);
		}, d);
	}
	return { from, to: schemaVersion(d), applied: pending.map((m) => `${m.version}_${m.name}`) };
}
