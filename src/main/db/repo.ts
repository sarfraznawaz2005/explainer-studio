import { randomUUID } from "node:crypto";
import type { SQLInputValue } from "node:sqlite";
import { db as appDb, type Db } from "./connection";

/** How a field is stored. Column names are the snake_case form of the field name. */
export type Col = "text" | "int" | "real" | "bool" | "json" | "blob";

type Row = { id: string; createdAt: string; updatedAt: string };
type Managed = "id" | "createdAt" | "updatedAt";

/** Fields that the database fills when they are left out. */
type Optional<T> = { [K in keyof T]-?: null extends T[K] ? K : never }[keyof T];
export type NewRow<T extends Row, D extends keyof T = never> = Omit<T, Managed | Optional<T> | D> &
	Partial<Pick<T, Optional<T> | D>> & { id?: string };
export type Patch<T extends Row> = Partial<Omit<T, Managed>>;

export type ListOptions<T> = {
	where?: Partial<T>;
	orderBy?: keyof T & string;
	desc?: boolean;
	limit?: number;
	offset?: number;
};

const snake = (k: string) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

/**
 * Small typed table helper. Every value is bound as a parameter. Column and
 * table names come only from the static `cols` map; unknown keys throw.
 * `D` lists fields with a database default that callers may leave out.
 */
export function defineRepo<T extends Row, D extends keyof T = never>(table: string, cols: { [K in keyof T]-?: Col }, getDb: () => Db = appDb) {
	const keys = Object.keys(cols) as (keyof T & string)[];
	const column = (k: string) => {
		if (!(k in cols)) throw new Error(`${table}: unknown field "${k}"`);
		return snake(k);
	};

	const encode = (k: keyof T, v: unknown): SQLInputValue => {
		if (v === null || v === undefined) return null;
		switch (cols[k]) {
			case "json":
				return JSON.stringify(v);
			case "bool":
				return v ? 1 : 0;
			default:
				return v as SQLInputValue;
		}
	};

	const decode = (raw: Record<string, unknown>): T => {
		const out: Record<string, unknown> = {};
		for (const k of keys) {
			const v = raw[snake(k)];
			if (v === null || v === undefined) out[k] = null;
			else if (cols[k] === "json") out[k] = JSON.parse(v as string);
			else if (cols[k] === "bool") out[k] = v === 1;
			else out[k] = v;
		}
		return out as T;
	};

	const whereSql = (where: Partial<T> | undefined): { sql: string; params: SQLInputValue[] } => {
		const entries = Object.entries(where ?? {}).filter(([, v]) => v !== undefined);
		if (!entries.length) return { sql: "", params: [] };
		const parts = entries.map(([k, v]) => (v === null ? `${column(k)} IS NULL` : `${column(k)} = ?`));
		return { sql: ` WHERE ${parts.join(" AND ")}`, params: entries.filter(([, v]) => v !== null).map(([k, v]) => encode(k as keyof T, v)) };
	};

	const repo = {
		table,
		create(input: NewRow<T, D>): T {
			const now = new Date().toISOString();
			const values: Record<string, unknown> = { ...input, id: input.id ?? randomUUID(), createdAt: now, updatedAt: now };
			const fields = Object.keys(values).filter((k) => values[k] !== undefined);
			const sql = `INSERT INTO ${table} (${fields.map(column).join(", ")}) VALUES (${fields.map(() => "?").join(", ")})`;
			getDb()
				.prepare(sql)
				.run(...fields.map((k) => encode(k as keyof T, values[k])));
			return repo.get(values.id as string)!;
		},
		get(id: string): T | null {
			const raw = getDb().prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
			return raw ? decode(raw as Record<string, unknown>) : null;
		},
		list(opts: ListOptions<T> = {}): T[] {
			const w = whereSql(opts.where);
			let sql = `SELECT * FROM ${table}${w.sql} ORDER BY ${column(opts.orderBy ?? "createdAt")} ${opts.desc === false ? "ASC" : "DESC"}`;
			const params = [...w.params];
			if (opts.limit !== undefined) {
				sql += " LIMIT ? OFFSET ?";
				params.push(Math.trunc(opts.limit), Math.trunc(opts.offset ?? 0));
			}
			return getDb()
				.prepare(sql)
				.all(...params)
				.map((r) => decode(r as Record<string, unknown>));
		},
		count(where?: Partial<T>): number {
			const w = whereSql(where);
			return (getDb().prepare(`SELECT count(*) AS n FROM ${table}${w.sql}`).get(...w.params) as { n: number }).n;
		},
		update(id: string, patch: Patch<T>): T | null {
			const values: Record<string, unknown> = { ...patch, updatedAt: new Date().toISOString() };
			for (const k of ["id", "createdAt"]) delete values[k];
			const fields = Object.keys(values).filter((k) => values[k] !== undefined);
			const sql = `UPDATE ${table} SET ${fields.map((k) => `${column(k)} = ?`).join(", ")} WHERE id = ?`;
			const r = getDb()
				.prepare(sql)
				.run(...fields.map((k) => encode(k as keyof T, values[k])), id);
			return Number(r.changes) ? repo.get(id) : null;
		},
		remove(id: string): boolean {
			return Number(getDb().prepare(`DELETE FROM ${table} WHERE id = ?`).run(id).changes) > 0;
		},
	};
	return repo;
}
