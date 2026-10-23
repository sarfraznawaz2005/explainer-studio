import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { SCENE_PROPS, type SceneType } from "@shared/plan/schema";
import { Button } from "@renderer/components/ui/button";
import { Input, Textarea } from "@renderer/components/ui/primitives";
import { Select } from "@renderer/components/ui/select";
import { Switch } from "@renderer/components/ui/switch";
import { cn } from "@renderer/lib/utils";

/**
 * Editor for the props of any scene type, built from the type's zod schema
 * (as JSON Schema), so every type gets a form without one written by hand.
 * Edits are checked with the same schema the renderer uses; only a valid value
 * is committed (each commit is one undo step). Typing commits after a short
 * pause or when the field loses focus.
 */

type JSchema = {
	type?: string | string[];
	properties?: Record<string, JSchema>;
	required?: string[];
	items?: JSchema;
	prefixItems?: JSchema[];
	enum?: (string | number)[];
	anyOf?: JSchema[];
	maxLength?: number;
	minItems?: number;
	maxItems?: number;
	minimum?: number;
	maximum?: number;
	default?: unknown;
};
type Json = unknown;

const schemaCache = new Map<SceneType, JSchema>();
function jsonSchemaOf(type: SceneType): JSchema {
	let s = schemaCache.get(type);
	if (!s) {
		s = z.toJSONSchema(SCENE_PROPS[type], { unrepresentable: "any", io: "output" }) as JSchema;
		schemaCache.set(type, s);
	}
	return s;
}

const words = (key: string) => {
	const w = key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[-_]/g, " ").toLowerCase();
	return w.charAt(0).toUpperCase() + w.slice(1);
};
const LABELS: Record<string, string> = { tex: "Formula (KaTeX)", expr: "Formula y =", svg: "Drawing (SVG)", x: "x", y: "y", lat: "Latitude", lon: "Longitude", who: "Speaker", ms: "ms" };
const labelOf = (key: string) => LABELS[key] ?? words(key);
const typeOf = (s: JSchema) => (Array.isArray(s.type) ? s.type.find((t) => t !== "null") : s.type);

/** A starting value for a new list item. */
function blank(s: JSchema, hint = "New"): Json {
	if (s.default !== undefined) return structuredClone(s.default);
	if (s.enum) return s.enum[0];
	if (s.anyOf) return blank(s.anyOf[0]!, hint);
	switch (typeOf(s)) {
		case "string":
			return hint;
		case "number":
		case "integer":
			return s.minimum !== undefined && s.minimum > 0 ? s.minimum : 0;
		case "boolean":
			return false;
		case "array":
			if (s.prefixItems) return s.prefixItems.map((p) => blank(p));
			return Array.from({ length: s.minItems ?? 0 }, () => blank(s.items ?? {}, hint));
		case "object": {
			const o: Record<string, Json> = {};
			for (const k of s.required ?? []) o[k] = blank(s.properties?.[k] ?? {}, k === "label" || k === "text" || k === "term" ? hint : "…");
			return o;
		}
	}
	return null;
}

/** The draft's pictures, so a figure field is a picture picker instead of a file name box. */
export type PictureChoice = { file: string; url: string; caption: string | null; origin: "source" | "mine" | "web" };
export const PictureChoices = createContext<PictureChoice[] | null>(null);

function PicturePicker({ value, onChange, label, disabled, required }: { value: Json; onChange: (v: Json, commit?: boolean) => void; label: string; disabled?: boolean; required: boolean }) {
	const choices = useContext(PictureChoices)!;
	const NONE = "__none__";
	const current = choices.find((c) => c.file === value);
	const opts = choices.map((c) => ({ value: c.file, label: c.caption ? (c.caption.length > 48 ? `${c.caption.slice(0, 47)}…` : c.caption) : c.file, hint: c.origin === "mine" ? "Yours" : c.origin === "web" ? "Web" : "Material" }));
	return (
		<div className="space-y-1.5">
			<Select
				ariaLabel={label}
				value={typeof value === "string" ? value : required ? undefined : NONE}
				disabled={disabled}
				onChange={(v) => onChange(v === NONE ? undefined : v, true)}
				options={required ? opts : [{ value: NONE, label: "—" }, ...opts]}
			/>
			{current ? <img src={current.url} alt="" className="max-h-28 rounded-md border object-contain" /> : null}
		</div>
	);
}

type Issue = { path: (string | number)[]; message: string };
const pathKey = (p: (string | number)[]) => p.join(".");

type FieldProps = { schema: JSchema; value: Json; onChange: (v: Json, commit?: boolean) => void; path: (string | number)[]; label: string; required: boolean; issues: Map<string, string>; disabled?: boolean };

function Field(props: FieldProps) {
	const { schema, label, path, issues } = props;
	const err = issues.get(pathKey(path));
	const t = typeOf(schema);
	const id = `f-${pathKey(path)}`;
	const body = <FieldBody {...props} id={id} />;
	if (t === "object" || (t === "array" && !schema.prefixItems)) {
		return (
			<fieldset className="space-y-2">
				<legend className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</legend>
				{body}
				{err ? <p className="text-[11px] text-danger">{err}</p> : null}
			</fieldset>
		);
	}
	return (
		<div className="space-y-1">
			<label htmlFor={id} className="block text-[12px] font-medium text-muted-foreground">
				{label}
				{props.required ? null : <span className="font-normal"> (optional)</span>}
			</label>
			{body}
			{err ? <p className="text-[11px] text-danger">{err}</p> : null}
		</div>
	);
}

function FieldBody({ schema, value, onChange, path, label, required, issues, disabled, id }: FieldProps & { id: string }) {
	const t = typeOf(schema);
	const key = String(path.at(-1) ?? "");
	const pictures = useContext(PictureChoices);
	if (key === "figure" && pictures?.length && !schema.enum) return <PicturePicker value={value} onChange={onChange} label={label} disabled={disabled} required={required} />;
	if (schema.enum) {
		// Radix Select cannot hold an empty value, so "not set" has its own key.
		const NONE = "__none__";
		const opts = schema.enum.map((e) => ({ value: String(e), label: String(e) }));
		return (
			<Select
				ariaLabel={label}
				value={value === undefined ? (required ? undefined : NONE) : String(value)}
				disabled={disabled}
				onChange={(v) => onChange(v === NONE ? undefined : typeof schema.enum![0] === "number" ? Number(v) : v, true)}
				options={required ? opts : [{ value: NONE, label: "—" }, ...opts]}
			/>
		);
	}
	if (schema.anyOf) {
		// Number-or-text cells (algorithm trace): a number when it reads as one.
		return <Input id={id} aria-label={label} value={value === undefined || value === null ? "" : String(value)} disabled={disabled} onChange={(e) => onChange(e.target.value.trim() !== "" && !Number.isNaN(Number(e.target.value)) ? Number(e.target.value) : e.target.value)} />;
	}
	if (t === "boolean") return <Switch ariaLabel={label} checked={!!value} disabled={disabled} onChange={(v) => onChange(v, true)} />;
	if (t === "number" || t === "integer") {
		return (
			<Input
				id={id}
				type="number"
				aria-label={label}
				disabled={disabled}
				value={value === undefined || value === null ? "" : String(value)}
				min={schema.minimum}
				max={schema.maximum}
				step={t === "integer" ? 1 : "any"}
				onChange={(e) => onChange(e.target.value === "" ? (required ? 0 : undefined) : Number(e.target.value))}
				className="tabular-nums"
			/>
		);
	}
	if (t === "string") {
		const long = key === "svg" || key === "code" || (schema.maxLength ?? 0) > 200;
		const mono = key === "svg" || key === "code" || key === "tex" || key === "expr";
		const v = typeof value === "string" ? value : "";
		const set = (s: string) => onChange(s === "" && !required ? undefined : s);
		return long ? (
			<Textarea id={id} aria-label={label} value={v} disabled={disabled} maxLength={schema.maxLength} spellCheck={!mono} onChange={(e) => set(e.target.value)} className={cn("text-[12.5px] leading-snug", mono ? "min-h-40 font-mono text-[11.5px]" : "min-h-16")} />
		) : (
			<Input id={id} aria-label={label} value={v} disabled={disabled} maxLength={schema.maxLength} spellCheck={!mono} onChange={(e) => set(e.target.value)} className={mono ? "font-mono text-[12px]" : undefined} />
		);
	}
	if (t === "array" && schema.prefixItems) {
		const arr = Array.isArray(value) ? value : [];
		return (
			<div className="flex gap-2">
				{schema.prefixItems.map((s, i) => (
					<div key={i} className="min-w-0 flex-1">
						<FieldBody schema={s} value={arr[i]} path={[...path, i]} label={`${label} ${i + 1}`} required issues={issues} disabled={disabled} id={`${id}-${i}`} onChange={(v, c) => onChange(Object.assign([...arr], { [i]: v }), c)} />
					</div>
				))}
			</div>
		);
	}
	if (t === "array") {
		const arr = Array.isArray(value) ? value : [];
		const item = schema.items ?? {};
		const max = schema.maxItems ?? 99;
		const min = schema.minItems ?? 0;
		const objectItems = typeOf(item) === "object";
		const move = (i: number, d: number) => {
			const next = [...arr];
			[next[i], next[i + d]] = [next[i + d], next[i]];
			onChange(next, true);
		};
		return (
			<div className="space-y-1.5">
				{arr.map((v, i) => (
					<div key={i} className={cn("group flex items-start gap-1.5", objectItems && "rounded-lg border bg-subtle/50 p-2")}>
						<span className="mt-2 w-4 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">{i + 1}</span>
						<div className="min-w-0 flex-1">
							{objectItems ? (
								<ObjectFields schema={item} value={v} path={[...path, i]} issues={issues} disabled={disabled} onChange={(nv, c) => onChange(Object.assign([...arr], { [i]: nv }), c)} />
							) : (
								<FieldBody schema={item} value={v} path={[...path, i]} label={`${label} ${i + 1}`} required issues={issues} disabled={disabled} id={`${id}-${i}`} onChange={(nv, c) => onChange(Object.assign([...arr], { [i]: nv }), c)} />
							)}
							{issues.get(pathKey([...path, i])) ? <p className="mt-0.5 text-[11px] text-danger">{issues.get(pathKey([...path, i]))}</p> : null}
						</div>
						<div className="flex shrink-0 flex-col opacity-60 transition-opacity group-hover:opacity-100">
							<button type="button" aria-label={`Move ${label} ${i + 1} up`} disabled={disabled || i === 0} onClick={() => move(i, -1)} className="rounded p-0.5 hover:bg-accent disabled:opacity-30">
								<ArrowUp className="size-3" />
							</button>
							<button type="button" aria-label={`Move ${label} ${i + 1} down`} disabled={disabled || i === arr.length - 1} onClick={() => move(i, 1)} className="rounded p-0.5 hover:bg-accent disabled:opacity-30">
								<ArrowDown className="size-3" />
							</button>
							<button type="button" aria-label={`Remove ${label} ${i + 1}`} disabled={disabled || arr.length <= min} onClick={() => onChange(arr.filter((_, k) => k !== i), true)} className="rounded p-0.5 hover:bg-danger-soft hover:text-danger disabled:opacity-30">
								<Trash2 className="size-3" />
							</button>
						</div>
					</div>
				))}
				<Button type="button" variant="ghost" size="sm" disabled={disabled || arr.length >= max} onClick={() => onChange([...arr, blank(item, `New ${label.toLowerCase().replace(/s$/, "")}`)], true)}>
					<Plus />
					Add
				</Button>
			</div>
		);
	}
	if (t === "object") return <ObjectFields schema={schema} value={value} path={path} issues={issues} disabled={disabled} onChange={onChange} />;
	return <p className="text-[11px] text-muted-foreground">Not editable here.</p>;
}

function ObjectFields({ schema, value, onChange, path, issues, disabled }: { schema: JSchema; value: Json; onChange: (v: Json, commit?: boolean) => void; path: (string | number)[]; issues: Map<string, string>; disabled?: boolean }) {
	const obj = (value && typeof value === "object" ? value : {}) as Record<string, Json>;
	const req = new Set(schema.required ?? []);
	return (
		<div className="space-y-2.5">
			{Object.entries(schema.properties ?? {}).map(([k, s]) => (
				<Field
					key={k}
					schema={s}
					value={obj[k]}
					path={[...path, k]}
					label={labelOf(k)}
					required={req.has(k)}
					issues={issues}
					disabled={disabled}
					onChange={(v, c) => {
						const next = { ...obj };
						if (v === undefined) delete next[k];
						else next[k] = v;
						onChange(next, c);
					}}
				/>
			))}
		</div>
	);
}

/** The props form for one scene. `onCommit` gets only values that pass the scene type's schema. */
export function PropsForm({ type, props, onCommit, disabled }: { type: SceneType; props: Record<string, unknown>; onCommit: (props: Record<string, unknown>) => void; disabled?: boolean }) {
	const schema = useMemo(() => jsonSchemaOf(type), [type]);
	const [draft, setDraft] = useState<Json>(props);
	const [issues, setIssues] = useState<Issue[]>([]);
	const committed = useRef(JSON.stringify(props));
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const latest = useRef<Json>(props);

	// Undo, redo or an AI rewrite changed the scene: show the new value.
	useEffect(() => {
		const json = JSON.stringify(props);
		if (json !== committed.current) {
			committed.current = json;
			latest.current = props;
			setDraft(props);
			setIssues([]);
		}
	}, [props]);

	const commit = () => {
		if (timer.current) clearTimeout(timer.current);
		timer.current = null;
		const r = SCENE_PROPS[type].safeParse(latest.current);
		if (!r.success) {
			setIssues(r.error.issues.map((i) => ({ path: i.path as (string | number)[], message: i.message })));
			return;
		}
		setIssues([]);
		const json = JSON.stringify(r.data);
		if (json === committed.current) return;
		committed.current = json;
		onCommit(r.data as Record<string, unknown>);
	};
	useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

	const change = (v: Json, now?: boolean) => {
		latest.current = v;
		setDraft(v);
		if (timer.current) clearTimeout(timer.current);
		if (now) commit();
		else timer.current = setTimeout(commit, 900);
	};
	const issueMap = useMemo(() => new Map(issues.map((i) => [pathKey(i.path), i.message])), [issues]);
	const rootIssues = issues.filter((i) => !i.path.length);
	return (
		<form
			aria-label="Scene content"
			data-testid="props-form"
			onSubmit={(e) => e.preventDefault()}
			onBlur={(e) => {
				if (!e.currentTarget.contains(e.relatedTarget as Node | null)) commit();
			}}
			className="space-y-3"
		>
			<ObjectFields schema={schema} value={draft} path={[]} issues={issueMap} disabled={disabled} onChange={change} />
			{issues.length ? (
				<p role="alert" className="rounded-md bg-danger-soft px-2.5 py-1.5 text-[11.5px] text-danger">
					{rootIssues[0]?.message ?? `Not saved yet: ${issues.length === 1 ? "one field needs" : `${issues.length} fields need`} a fix.`}
				</p>
			) : null}
		</form>
	);
}
