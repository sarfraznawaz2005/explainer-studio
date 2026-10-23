import { z } from "zod";
import type { Block, Section, Source } from "@shared/source";
import type { PlannerAi } from "./ai";

/**
 * Long sources are summarised before planning: the sections are cut into
 * chunks, each chunk becomes a list of key points (with the section ids they
 * came from), and the outline is planned from that knowledge map. Short
 * sources go to the planner as they are.
 */

/** Sources up to this size are planned from the full text. */
export const MAP_THRESHOLD_CHARS = 60_000;
export const CHUNK_CHARS = 24_000;
/** Most source text one chapter script sees. */
export const CHAPTER_SOURCE_CHARS = 30_000;

function blockText(b: Block, figures: Map<string, string | null>): string {
	switch (b.type) {
		case "paragraph":
		case "quote":
			return b.text;
		case "code":
			return "```\n" + b.text + "\n```";
		case "list":
			return b.items.map((t, i) => (b.ordered ? `${i + 1}. ${t}` : `- ${t}`)).join("\n");
		case "table":
			return (b.caption ? `Table: ${b.caption}\n` : "") + b.rows.map((r) => `| ${r.join(" | ")} |`).join("\n");
		case "figure": {
			const cap = figures.get(b.figureId);
			return `[figure ${b.figureId}${cap ? `: ${cap}` : ""}]`;
		}
	}
}

/** One section as prompt text, tagged with its id: "[s3] ## 2.3 Sorting (page 81)". */
export function sectionText(sec: Section, figures: Map<string, string | null>): string {
	const head = `[${sec.id}] ${"#".repeat(Math.min(sec.level, 4))} ${sec.heading ?? "(no heading)"}${sec.page ? ` (page ${sec.page})` : ""}`;
	return [head, ...sec.blocks.map((b) => blockText(b, figures))].join("\n");
}

const figureMap = (s: Pick<Source, "figures">) => new Map(s.figures.map((f) => [f.id, f.caption]));

/** The whole source, or only some sections, as prompt text. Cut at `maxChars` with a note. */
export function sourceForPrompt(s: Pick<Source, "sections" | "figures">, opts: { sections?: string[]; maxChars?: number } = {}): string {
	const figs = figureMap(s);
	const want = opts.sections?.length ? new Set(opts.sections) : null;
	const parts = s.sections.filter((x) => !want || want.has(x.id)).map((x) => sectionText(x, figs));
	const text = parts.join("\n\n");
	const max = opts.maxChars ?? Infinity;
	return text.length > max ? `${text.slice(0, max)}\n\n[... the rest of this material was cut to fit]` : text;
}

/** Groups sections into chunks of at most `max` characters. A section longer than `max` is split by blocks. */
export function chunkSections(s: Pick<Source, "sections" | "figures">, max = CHUNK_CHARS): string[] {
	const figs = figureMap(s);
	const chunks: string[] = [];
	let cur = "";
	const push = (t: string) => {
		if (cur && cur.length + t.length + 2 > max) {
			chunks.push(cur);
			cur = "";
		}
		cur = cur ? `${cur}\n\n${t}` : t;
	};
	for (const sec of s.sections) {
		const t = sectionText(sec, figs);
		if (t.length <= max) push(t);
		else for (let i = 0; i < t.length; i += max) push((i ? `[${sec.id}] (continued)\n` : "") + t.slice(i, i + max));
	}
	if (cur) chunks.push(cur);
	return chunks;
}

export const needsMap = (s: Pick<Source, "stats">) => s.stats.chars > MAP_THRESHOLD_CHARS;

export const KnowledgeChunk = z.object({
	points: z
		.array(z.object({ section: z.string().max(16), text: z.string().trim().min(1).max(400) }))
		.min(1)
		.max(60),
	terms: z.array(z.object({ term: z.string().trim().min(1).max(80), meaning: z.string().trim().max(300) })).max(30).default([]),
	examples: z.array(z.string().trim().max(400)).max(15).default([]),
	formulas: z.array(z.string().trim().max(300)).max(15).default([]),
});
export type KnowledgeChunk = z.infer<typeof KnowledgeChunk>;

export const MAP_SYSTEM = [
	"You read one part of a piece of learning material and write its knowledge map: the facts, ideas, terms, examples and formulas it teaches.",
	"Rules:",
	"- Keep every idea that a lesson on this material should teach. Leave out page furniture, exercises' answers and repetition.",
	"- Each point is one short, complete statement, true to the text. Do not add knowledge that is not in the text.",
	"- Each point names the id of the section it comes from, as written in square brackets, like s3.",
	"- Keep the order of the material.",
].join("\n");

/** Knowledge map of a long source: one cheap-model call per chunk. */
export async function buildKnowledgeMap(
	s: Pick<Source, "sections" | "figures" | "title">,
	ai: PlannerAi,
	onChunk?: (done: number, total: number) => void,
): Promise<KnowledgeChunk[]> {
	const chunks = chunkSections(s);
	const out: KnowledgeChunk[] = [];
	onChunk?.(0, chunks.length);
	for (const [i, chunk] of chunks.entries()) {
		out.push(
			await ai.structured(
				{ schema: KnowledgeChunk, system: MAP_SYSTEM, prompt: `Material: "${s.title}", part ${i + 1} of ${chunks.length}.\n\n${chunk}` },
				{ slot: "cheap", purpose: "plan.map", maxOutputTokens: 6000 },
			),
		);
		onChunk?.(i + 1, chunks.length);
	}
	return out;
}

/** The knowledge map as prompt text, with section ids kept. */
export function mapForPrompt(map: KnowledgeChunk[]): string {
	const lines: string[] = [];
	for (const c of map) {
		for (const p of c.points) lines.push(`[${p.section}] ${p.text}`);
		if (c.terms.length) lines.push(`Terms: ${c.terms.map((t) => `${t.term} (${t.meaning})`).join("; ")}`);
		if (c.examples.length) lines.push(`Examples: ${c.examples.join(" | ")}`);
		if (c.formulas.length) lines.push(`Formulas: ${c.formulas.join(" | ")}`);
	}
	return lines.join("\n");
}
