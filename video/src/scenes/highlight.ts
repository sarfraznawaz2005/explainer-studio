/**
 * Tiny syntax highlighter for the code walkthrough scene. Line based and
 * regex driven: good enough for teaching snippets, no dependency, and fully
 * synchronous (Remotion renders frames without waiting on async work).
 */
export type TokenKind = "keyword" | "string" | "comment" | "number" | "fn" | "text";
export type Token = { text: string; kind: TokenKind };

const KEYWORDS: Record<string, string[]> = {
	python: "and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield print len range self".split(" "),
	javascript: "async await break case catch class const continue default delete do else export extends false finally for from function if import in instanceof let new null of return static super switch this throw true try typeof undefined var void while yield".split(" "),
	java: "abstract boolean break byte case catch char class continue default do double else enum extends false final finally float for if implements import instanceof int interface long new null package private protected public return short static super switch this throw throws true try void while String System".split(" "),
	c: "auto break case char const continue default do double else enum extern float for goto if include int long return short signed sizeof static struct switch typedef union unsigned void while printf NULL".split(" "),
	csharp: "abstract as bool break case catch class const continue decimal default do double else enum false finally float for foreach if in int interface internal is long namespace new null object out override private protected public readonly return static string struct switch this throw true try using var virtual void while Console".split(" "),
	sql: "select from where and or not insert into values update set delete create table primary key foreign references join left right inner outer on group by order having limit as distinct count sum avg min max null is in like between".split(" "),
};
KEYWORDS.typescript = [...KEYWORDS.javascript!, ..."interface type enum implements private public readonly as number string boolean any unknown never".split(" ")];
KEYWORDS.cpp = [...KEYWORDS.c!, ..."bool class namespace new delete public private protected template this using std cout cin endl true false nullptr".split(" ")];

const LINE_COMMENT: Record<string, string> = { python: "#", sql: "--" };

export function highlight(code: string, language: string): Token[][] {
	const words = new Set(KEYWORDS[language] ?? []);
	const caseless = language === "sql";
	const comment = LINE_COMMENT[language] ?? (language === "text" ? null : "//");
	const pattern = new RegExp(
		[
			comment ? `(${comment.replace(/[/-]/g, "\\$&")}.*$)` : "($^)",
			`("(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*'|\`(?:[^\`\\\\]|\\\\.)*\`)`,
			"(\\b\\d+(?:\\.\\d+)?\\b)",
			"([A-Za-z_][A-Za-z0-9_]*)(?=\\s*\\()",
			"([A-Za-z_][A-Za-z0-9_]*)",
		].join("|"),
		"g",
	);
	return code.replace(/\t/g, "    ").split("\n").map((line) => {
		if (language === "text") return [{ text: line, kind: "text" as const }];
		const out: Token[] = [];
		let last = 0;
		for (const m of line.matchAll(pattern)) {
			if (m.index > last) out.push({ text: line.slice(last, m.index), kind: "text" });
			const [all, c, s, n, fn, word] = m;
			const isKw = (w: string) => words.has(caseless ? w.toLowerCase() : w);
			let kind: TokenKind = "text";
			if (c) kind = "comment";
			else if (s) kind = "string";
			else if (n) kind = "number";
			else if (fn) kind = isKw(fn) ? "keyword" : "fn";
			else if (word && isKw(word)) kind = "keyword";
			out.push({ text: all, kind });
			last = m.index + all.length;
		}
		if (last < line.length) out.push({ text: line.slice(last), kind: "text" });
		return out;
	});
}
