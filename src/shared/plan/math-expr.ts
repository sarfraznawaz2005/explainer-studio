/**
 * Safe formula reader for the graph scene: "2x^2 - 3x + 1", "sin(x) / x".
 * A small recursive-descent parser that builds a function from a fixed set of
 * operators and named functions. Nothing is ever passed to eval or new Function.
 */

export type MathFn = (x: number) => number;
export type ParseResult = { ok: true; fn: MathFn } | { ok: false; problem: string };

export const MATH_MAX_CHARS = 120;

const FUNCS: Record<string, (v: number) => number> = {
	sin: Math.sin,
	cos: Math.cos,
	tan: Math.tan,
	asin: Math.asin,
	acos: Math.acos,
	atan: Math.atan,
	sinh: Math.sinh,
	cosh: Math.cosh,
	tanh: Math.tanh,
	sqrt: Math.sqrt,
	abs: Math.abs,
	ln: Math.log,
	log: Math.log10,
	exp: Math.exp,
	floor: Math.floor,
	ceil: Math.ceil,
	round: Math.round,
	sign: Math.sign,
};
const CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E, tau: Math.PI * 2 };

type Tok = { k: "num"; v: number } | { k: "id"; v: string } | { k: "op"; v: string };

function lex(src: string): Tok[] {
	const out: Tok[] = [];
	let i = 0;
	while (i < src.length) {
		const c = src[i]!;
		if (/\s/.test(c)) {
			i++;
			continue;
		}
		const num = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(src.slice(i));
		if (num) {
			out.push({ k: "num", v: parseFloat(num[0]) });
			i += num[0].length;
			continue;
		}
		const id = /^[a-z]+/i.exec(src.slice(i));
		if (id) {
			out.push({ k: "id", v: id[0].toLowerCase() });
			i += id[0].length;
			continue;
		}
		if ("+-*/^()·×÷−".includes(c)) {
			out.push({ k: "op", v: c === "·" || c === "×" ? "*" : c === "÷" ? "/" : c === "−" ? "-" : c });
			i++;
			continue;
		}
		throw new Error(`unexpected "${c}"`);
	}
	return out;
}

type Node = (x: number) => number;

export function parseMath(src: string): ParseResult {
	if (!src.trim()) return { ok: false, problem: "the formula is empty" };
	if (src.length > MATH_MAX_CHARS) return { ok: false, problem: `the formula is longer than ${MATH_MAX_CHARS} characters` };
	let toks: Tok[];
	try {
		toks = lex(src.replace(/^\s*(y|f\s*\(\s*x\s*\))\s*=/i, ""));
	} catch (err) {
		return { ok: false, problem: (err as Error).message };
	}
	let p = 0;
	const peek = () => toks[p];
	const isOp = (v: string) => peek()?.k === "op" && peek()!.v === v;
	// Starts a factor, so "2x", "2(x+1)", "x sin(x)" multiply without a sign.
	const startsFactor = () => {
		const t = peek();
		return !!t && (t.k === "num" || t.k === "id" || (t.k === "op" && t.v === "("));
	};

	function expr(): Node {
		let left = term();
		while (isOp("+") || isOp("-")) {
			const op = toks[p++]!.v;
			const a = left;
			const b = term();
			left = op === "+" ? (x) => a(x) + b(x) : (x) => a(x) - b(x);
		}
		return left;
	}
	function term(): Node {
		let left = unary();
		for (;;) {
			if (isOp("*") || isOp("/")) {
				const op = toks[p++]!.v;
				const a = left;
				const b = unary();
				left = op === "*" ? (x) => a(x) * b(x) : (x) => a(x) / b(x);
			} else if (startsFactor()) {
				const a = left;
				const b = power();
				left = (x) => a(x) * b(x);
			} else return left;
		}
	}
	function unary(): Node {
		if (isOp("-")) {
			p++;
			const a = unary();
			return (x) => -a(x);
		}
		if (isOp("+")) {
			p++;
			return unary();
		}
		return power();
	}
	function power(): Node {
		const base = atom();
		if (isOp("^")) {
			p++;
			const e = unary();
			return (x) => Math.pow(base(x), e(x));
		}
		return base;
	}
	function atom(): Node {
		const t = toks[p++];
		if (!t) throw new Error("the formula ends too early");
		if (t.k === "num") return () => t.v;
		if (t.k === "op" && t.v === "(") {
			const inner = expr();
			if (!isOp(")")) throw new Error("a ( is not closed");
			p++;
			return inner;
		}
		if (t.k === "id") {
			if (t.v === "x") return (x) => x;
			// Own keys only: names such as "constructor" must not reach the object prototype.
			if (Object.hasOwn(CONSTS, t.v)) {
				const c = CONSTS[t.v]!;
				return () => c;
			}
			const f = Object.hasOwn(FUNCS, t.v) ? FUNCS[t.v] : undefined;
			if (f) {
				if (!isOp("(")) throw new Error(`${t.v} needs brackets: ${t.v}(x)`);
				p++;
				const arg = expr();
				if (!isOp(")")) throw new Error(`${t.v}( is not closed`);
				p++;
				return (x) => f(arg(x));
			}
			throw new Error(`unknown name "${t.v}" (use x, numbers, pi, e and ${Object.keys(FUNCS).join(", ")})`);
		}
		throw new Error(`unexpected "${t.v}"`);
	}
	try {
		const fn = expr();
		if (p < toks.length) throw new Error(`unexpected "${String(toks[p]!.v)}"`);
		return { ok: true, fn };
	} catch (err) {
		return { ok: false, problem: (err as Error).message };
	}
}
