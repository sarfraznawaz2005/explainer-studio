import { countWords, sourceText, type Block, type Figure, type Section, type Source, type SourceInput } from "@shared/source";

/**
 * Collects sections, blocks and figures from any reader into one Source.
 * Readers call heading() when a new heading starts and add blocks in reading order.
 */
export class SourceBuilder {
	readonly inputs: SourceInput[] = [];
	readonly sections: Section[] = [];
	readonly figures: Figure[] = [];
	readonly warnings: string[] = [];
	private input = -1;
	private current: Section | null = null;
	private nextSection = 1;
	private nextFigure = 1;

	/** Starts a new input file. Later blocks belong to it. */
	beginInput(input: SourceInput): number {
		this.inputs.push(input);
		this.input = this.inputs.length - 1;
		this.current = null;
		return this.input;
	}

	get inputIndex(): number {
		return this.input;
	}

	heading(text: string, level: number, page: number | null = null): void {
		const t = clean(text);
		if (!t) return;
		this.current = { id: `s${this.nextSection++}`, heading: t.slice(0, 300), level: Math.max(1, Math.min(6, Math.round(level))), page, input: this.input, blocks: [] };
		this.sections.push(this.current);
	}

	private section(page: number | null): Section {
		if (!this.current) {
			this.current = { id: `s${this.nextSection++}`, heading: null, level: 1, page, input: this.input, blocks: [] };
			this.sections.push(this.current);
		}
		return this.current;
	}

	add(block: Block, page: number | null = null): void {
		const b = normalise(block);
		if (!b) return;
		const sec = this.section(page);
		const last = sec.blocks.at(-1);
		// A paragraph cut by a page break continues on the next page.
		if (b.type === "paragraph" && last?.type === "paragraph" && /[a-z,;]$/.test(last.text) && /^[a-z]/.test(b.text)) {
			last.text = `${last.text} ${b.text}`;
			return;
		}
		sec.blocks.push(b);
	}

	paragraph(text: string, page: number | null = null): void {
		this.add({ type: "paragraph", text }, page);
	}

	/** Registers a figure file and places it in the text. Returns its id. */
	figure(f: Omit<Figure, "id" | "input">, page: number | null = null): string {
		const id = `f${this.nextFigure++}`;
		this.figures.push({ ...f, id, input: this.input, caption: f.caption ? clean(f.caption).slice(0, 500) || null : null });
		this.section(page).blocks.push({ type: "figure", figureId: id });
		return id;
	}

	warn(message: string): void {
		if (!this.warnings.includes(message)) this.warnings.push(message);
	}

	build(fallbackTitle: string): Source {
		const sections = this.sections.filter((s) => s.blocks.length || s.heading);
		const text = sourceText({ sections });
		const firstHeading = sections.find((s) => s.heading && s.level === 1)?.heading ?? sections.find((s) => s.heading)?.heading;
		return {
			version: 1,
			title: (firstHeading ?? fallbackTitle).slice(0, 200),
			inputs: this.inputs,
			sections,
			figures: this.figures,
			stats: { words: countWords(text), chars: text.length },
			warnings: this.warnings,
		};
	}
}

/** Collapses whitespace and strips control characters. */
export function clean(text: string): string {
	return text
		.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f­]/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

function normalise(b: Block): Block | null {
	switch (b.type) {
		case "paragraph":
		case "quote": {
			const text = clean(b.text);
			return text ? { ...b, text } : null;
		}
		case "code": {
			const text = b.text.replace(/\r\n?/g, "\n").replace(/^\n+|\s+$/g, "");
			return text ? { ...b, text } : null;
		}
		case "list": {
			const items = b.items.map(clean).filter(Boolean);
			return items.length ? { ...b, items } : null;
		}
		case "table": {
			const rows = b.rows.map((r) => r.map(clean)).filter((r) => r.some(Boolean));
			return rows.length ? { ...b, rows, caption: b.caption ? clean(b.caption) || null : null } : null;
		}
		default:
			return b;
	}
}
