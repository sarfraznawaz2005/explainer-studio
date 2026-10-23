import type { SourceBuilder } from "./builder";
import type { ImageResolver } from "./images";

const stripInline = (s: string) =>
	s
		.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
		.replace(/(\*\*|__)(.+?)\1/g, "$2")
		.replace(/(\*|_)(.+?)\1/g, "$2")
		.replace(/`([^`]+)`/g, "$1")
		.replace(/<[^>]+>/g, "");

const splitRow = (line: string) =>
	line
		.trim()
		.replace(/^\||\|$/g, "")
		.split("|")
		.map((c) => stripInline(c.trim()));

/**
 * Markdown: ATX and Setext headings, paragraphs, lists, pipe tables, fenced code,
 * quotes and images. Enough for notes and READMEs; no HTML blocks.
 */
export async function readMarkdown(md: string, b: SourceBuilder, resolveImage: ImageResolver): Promise<void> {
	const lines = md.replace(/\r\n?/g, "\n").replace(/^---\n[\s\S]*?\n---\n/, "").split("\n");
	let para: string[] = [];
	const flush = () => {
		if (para.length) b.paragraph(stripInline(para.join(" ")));
		para = [];
	};
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]!;
		const fence = /^\s*(```|~~~)/.exec(line);
		if (fence) {
			flush();
			const code: string[] = [];
			for (i++; i < lines.length && !lines[i]!.trim().startsWith(fence[1]!); i++) code.push(lines[i]!);
			b.add({ type: "code", text: code.join("\n") });
			continue;
		}
		const h = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
		if (h) {
			flush();
			b.heading(stripInline(h[2]!), h[1]!.length);
			continue;
		}
		const next = lines[i + 1] ?? "";
		if (line.trim() && /^(=+|-+)\s*$/.test(next) && !para.length) {
			b.heading(stripInline(line), next.trim().startsWith("=") ? 1 : 2);
			i++;
			continue;
		}
		if (!line.trim()) {
			flush();
			continue;
		}
		const img = /^\s*!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"([^"]*)")?\s*\)\s*$/.exec(line);
		if (img) {
			flush();
			const f = await resolveImage(img[2]!);
			if (f) b.figure({ ...f, caption: img[3] || img[1] || null });
			continue;
		}
		if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|?\s*:?-{2,}/.test(next)) {
			flush();
			const rows = [splitRow(line)];
			for (i += 2; i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]!); i++) rows.push(splitRow(lines[i]!));
			i--;
			b.add({ type: "table", rows, caption: null });
			continue;
		}
		if (/^\s*>/.test(line)) {
			flush();
			const q: string[] = [];
			for (; i < lines.length && /^\s*>/.test(lines[i]!); i++) q.push(lines[i]!.replace(/^\s*>\s?/, ""));
			i--;
			b.add({ type: "quote", text: stripInline(q.join(" ")) });
			continue;
		}
		const li = /^\s*(?:([-*+])|(\d+)[.)])\s+(.*)$/.exec(line);
		if (li) {
			flush();
			const ordered = !!li[2];
			const items: string[] = [];
			for (; i < lines.length; i++) {
				const m = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/.exec(lines[i]!);
				if (m) items.push(stripInline(m[1]!));
				else if (lines[i]!.trim() && /^\s{2,}/.test(lines[i]!) && items.length) items[items.length - 1] += ` ${stripInline(lines[i]!.trim())}`;
				else break;
			}
			i--;
			b.add({ type: "list", ordered, items });
			continue;
		}
		para.push(line.trim());
	}
	flush();
}
