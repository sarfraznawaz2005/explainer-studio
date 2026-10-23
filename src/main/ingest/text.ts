import type { SourceBuilder } from "./builder";

/** "Chapter 3", "Unit 2: Algorithms", "2.3.1 Bubble sort" and short ALL-CAPS lines read as headings. */
export function headingLevel(line: string): number | null {
	const t = line.trim();
	if (t.length < 2 || t.length > 90 || /[.,;:]$/.test(t) && !/^(chapter|unit|part|lesson)\b/i.test(t)) return null;
	if (/^(chapter|unit|part|lesson|module)\s+[\dIVXLC]+\b/i.test(t)) return 1;
	const num = /^(\d+(?:\.\d+){0,3})\.?\s+\p{Lu}/u.exec(t);
	if (num && t.split(/\s+/).length <= 12) return Math.min(4, num[1]!.split(".").length + 1);
	if (/^[\p{Lu}\d\s&:,'’()-]+$/u.test(t) && /\p{Lu}{3}/u.test(t) && t.split(/\s+/).length <= 10) return 2;
	return null;
}

const BULLET = /^\s*(?:[-*•▪◦●○■□➢►✓]|\(?[a-z0-9]{1,3}[.)])\s+/i;

/**
 * Plain text and typed text: blank lines split paragraphs, bullet lines become
 * lists, heading-like lines start sections.
 */
export function readPlainText(text: string, b: SourceBuilder): void {
	const blocks = text.replace(/\r\n?/g, "\n").split(/\n\s*\n/);
	for (const chunk of blocks) {
		const lines = chunk.split("\n").filter((l) => l.trim());
		if (!lines.length) continue;
		if (lines.length === 1) {
			const lvl = headingLevel(lines[0]!);
			if (lvl) {
				b.heading(lines[0]!, lvl);
				continue;
			}
		}
		// A heading line on top of a paragraph.
		const firstLvl = lines.length > 1 ? headingLevel(lines[0]!) : null;
		if (firstLvl && lines[0]!.length < 70) {
			b.heading(lines.shift()!, firstLvl);
		}
		if (lines.every((l) => BULLET.test(l))) {
			b.add({ type: "list", ordered: /^\s*\(?\d/.test(lines[0]!), items: lines.map((l) => l.replace(BULLET, "")) });
		} else b.paragraph(lines.join(" "));
	}
}
