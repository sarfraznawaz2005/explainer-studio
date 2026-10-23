import { SCENE_PROPS, type Scene, type SceneType } from "./schema";

/**
 * Swap a scene to another type without the AI: the words on screen (heading,
 * items, numbers) are carried over and the new type gets sensible defaults for
 * what it needs extra (coordinates, formulas, a drawing). The narration is kept;
 * cues are cleared because item numbers change. The result is always valid.
 */

type Item = { label: string; detail?: string };
export type SceneContent = { heading?: string; items: Item[]; numbers: { label: string; value: number }[] };

/** Types a scene can be swapped to. Title and chapter cards come from the outline; figures need a source picture. */
export const SWAP_TYPES: SceneType[] = (Object.keys(SCENE_PROPS) as SceneType[]).filter((t) => t !== "title" && t !== "chapter" && t !== "figure");

const cut = (t: string, max: number) => {
	const s = t.replace(/\s+/g, " ").trim();
	return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
};
const it = (label: string | undefined, detail?: string): Item | null => (label && label.trim() ? { label: label.trim(), detail: detail?.trim() || undefined } : null);
const items = (...xs: (Item | null)[]) => xs.filter((x): x is Item => !!x);

/** The words of a scene, whatever its type. */
export function extractContent(scene: Scene): SceneContent {
	const p = scene.props as { heading?: string };
	const heading = p.heading?.trim() || undefined;
	const none = { heading, items: [] as Item[], numbers: [] as SceneContent["numbers"] };
	switch (scene.type) {
		case "title":
			return { ...none, heading: scene.props.title, items: items(it(scene.props.subtitle)) };
		case "chapter":
			return { ...none, heading: scene.props.title, items: items(it(scene.props.goal)) };
		case "kinetic":
			return { ...none, items: items(...scene.props.lines.map((l) => it(l))) };
		case "bullets":
		case "summary":
			return { ...none, items: items(...scene.props.items.map((l) => it(l))) };
		case "definition":
			return { ...none, heading: scene.props.term, items: items(it(scene.props.definition), it(scene.props.example)) };
		case "quote":
			return { ...none, heading: scene.props.author, items: items(it(scene.props.text, scene.props.source)) };
		case "glossary":
			return { ...none, items: items(...scene.props.terms.map((t) => it(t.term, t.meaning))) };
		case "flow":
		case "cycle":
			return { ...none, items: items(...scene.props.steps.map((s) => it(s.label, s.detail))) };
		case "tree":
			return { ...none, heading: heading ?? scene.props.nodes[0]!.label, items: items(...scene.props.nodes.slice(heading ? 0 : 1).map((n) => it(n.label))) };
		case "mindmap":
			return { ...none, heading: scene.props.center, items: items(...scene.props.branches.map((b) => it(b.label, b.children.join(", ")))) };
		case "diagram":
			return { ...none, items: items(...scene.props.labels.map((l) => it(l.text, l.detail))) };
		case "venn":
			return { ...none, items: items(...scene.props.sets.map((s) => it(s.label, s.items.join(", "))), it(scene.props.overlapLabel ?? (scene.props.overlap.length ? "Both" : undefined), scene.props.overlap.join(", "))) };
		case "compare":
			return { ...none, items: items(it(scene.props.left.title, scene.props.left.points.join("; ")), it(scene.props.right.title, scene.props.right.points.join("; "))) };
		case "proscons":
			return { ...none, items: items(...scene.props.pros.map((x) => it(x, "pro")), ...scene.props.cons.map((x) => it(x, "con"))) };
		case "chart":
			return { ...none, items: items(...scene.props.data.map((d) => it(d.label, `${d.value}${scene.props.unit ?? ""}`))), numbers: scene.props.data.map((d) => ({ label: d.label, value: d.value })) };
		case "counter":
			return { ...none, items: items(...scene.props.counters.map((c) => it(c.label))), numbers: scene.props.counters.map((c) => ({ label: c.label, value: c.value })) };
		case "equation":
			return { ...none, items: items(...scene.props.steps.map((s) => it(s.note ?? s.tex))) };
		case "graph":
			return { ...none, items: items(...scene.props.functions.map((f) => it(f.label ?? `y = ${f.expr}`))) };
		case "code":
			return { ...none, items: items(...scene.props.steps.map((s) => it(s.note ?? `Lines ${s.lines[0]}–${s.lines[1]}`))) };
		case "trace":
			return { ...none, items: items(...scene.props.steps.map((s, i) => it(s.note ?? `Step ${i + 1}`))), numbers: scene.props.array.filter((v): v is number => typeof v === "number").map((v, i) => ({ label: String(i), value: v })) };
		case "table":
			return { ...none, heading: heading ?? scene.props.columns.join(" · "), items: items(...scene.props.rows.map((r) => it(r[0], r.slice(1).filter(Boolean).join(", ")))) };
		case "timeline":
			return { ...none, items: items(...scene.props.events.map((e) => it(`${e.date}: ${e.label}`, e.detail))) };
		case "map":
			return { ...none, items: items(...scene.props.pins.map((x) => it(x.label, x.detail))) };
		case "analogy":
			return { ...none, heading: heading ?? `${scene.props.idea} is like ${scene.props.like}`, items: items(...scene.props.pairs.map((x) => it(x.idea, x.like))) };
		case "dialogue":
			return { ...none, heading: scene.props.setting, items: items(...scene.props.lines.map((l) => it(l.text))) };
		case "figure":
			return { ...none, heading: scene.props.caption, items: items(...scene.props.callouts.map((c) => it(c.text))) };
		case "pause":
			return { ...none, heading: scene.props.question, items: items(it(scene.props.question), it(scene.props.answer)) };
		case "quiz":
			return { ...none, items: items(...scene.props.questions.map((q) => it(q.question, q.options[q.answer]))) };
		case "svg":
			return { ...none, heading: heading ?? scene.props.caption, items: [] };
	}
}

const texText = (t: string) => `\\text{${t.replace(/[\\{}$&#^_%~]/g, " ").slice(0, 120)}}`;
const xmlText = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Props for `type` built from the words of another scene. */
export function buildProps(type: SceneType, c: SceneContent): Record<string, unknown> {
	const h = c.heading ? cut(c.heading, 120) : undefined;
	const list = c.items.length ? c.items : [{ label: h ?? "New item" }];
	const take = (min: number, max: number) => {
		const out = list.slice(0, max);
		while (out.length < min) out.push({ label: `Item ${out.length + 1}` });
		return out;
	};
	const L = (i: Item, max: number) => cut(i.label, max);
	const D = (i: Item, max: number) => (i.detail ? cut(i.detail, max) : undefined);
	const nums = c.numbers.length ? c.numbers : list.map((x, i) => ({ label: x.label, value: i + 1 }));
	switch (type) {
		case "kinetic":
			return { lines: take(1, 6).map((x) => L(x, 80)), emphasis: [], mode: "stack" };
		case "bullets":
			return { heading: h, items: take(1, 8).map((x) => L(x, 200)) };
		case "summary":
			return { heading: h, items: take(1, 8).map((x) => L(x, 140)) };
		case "definition":
			return { term: cut(h ?? list[0]!.label, 80), definition: cut(h ? list[0]!.label : (list[0]!.detail ?? list[0]!.label), 400), example: list[1] ? L(list[1], 300) : undefined };
		case "quote":
			return { text: L(list[0]!, 320), author: h ? cut(h, 80) : undefined };
		case "glossary":
			return { heading: h, terms: take(1, 6).map((x) => ({ term: L(x, 60), meaning: cut(x.detail ?? x.label, 200) })) };
		case "flow":
			return { heading: h, direction: "horizontal", steps: take(2, 7).map((x) => ({ label: L(x, 60), detail: D(x, 140) })) };
		case "cycle":
			return { heading: h, steps: take(3, 8).map((x) => ({ label: L(x, 40), detail: D(x, 100) })) };
		case "tree": {
			const kids = take(1, 14);
			return { heading: undefined, nodes: [{ label: cut(h ?? "Topic", 40) }, ...kids.map((x) => ({ label: L(x, 40), parent: 0 }))] };
		}
		case "mindmap":
			return { center: cut(h ?? "Topic", 60), branches: take(2, 8).map((x) => ({ label: L(x, 40), children: x.detail ? x.detail.split(/[,;]\s*/).filter(Boolean).slice(0, 4).map((d) => cut(d, 40)) : [] })) };
		case "diagram": {
			const labels = take(1, 8);
			return {
				heading: h,
				svg: '<svg viewBox="0 0 600 400"><rect x="40" y="40" width="520" height="320" rx="24" fill="paper" stroke="line" stroke-width="4"/></svg>',
				labels: labels.map((x, i) => ({ text: L(x, 60), detail: D(x, 120), x: i % 2 ? 75 : 25, y: 15 + ((i >> 1) * 70) / Math.max(1, Math.ceil(labels.length / 2) - 1 || 1) })),
			};
		}
		case "venn": {
			const sets = take(2, 3);
			return { heading: h, sets: sets.map((x) => ({ label: L(x, 40), items: x.detail ? x.detail.split(/[,;]\s*/).filter(Boolean).slice(0, 4).map((d) => cut(d, 40)) : [] })), overlap: [] };
		}
		case "compare": {
			const [a, b] = take(2, 2);
			const pts = (x: Item) => (x.detail ? x.detail.split(/;\s*/).filter(Boolean).slice(0, 6).map((d) => cut(d, 200)) : [L(x, 200)]);
			return { heading: h, left: { title: L(a!, 60), points: pts(a!) }, right: { title: L(b!, 60), points: pts(b!) } };
		}
		case "proscons": {
			const pros = list.filter((x) => x.detail !== "con");
			const cons = list.filter((x) => x.detail === "con");
			const half = Math.ceil(list.length / 2);
			const p = (cons.length ? pros : list.slice(0, half)).slice(0, 6);
			const q = (cons.length ? cons : list.slice(half)).slice(0, 6);
			return { heading: h, pros: (p.length ? p : [{ label: "Pro" }]).map((x) => L(x, 120)), cons: (q.length ? q : [{ label: "Con" }]).map((x) => L(x, 120)) };
		}
		case "chart": {
			const data = nums.slice(0, 12);
			while (data.length < 2) data.push({ label: `Item ${data.length + 1}`, value: data.length + 1 });
			return { heading: h, kind: "bar", data: data.map((d) => ({ label: cut(d.label, 30), value: d.value })) };
		}
		case "counter":
			return { heading: h, counters: nums.slice(0, 4).map((d) => ({ value: d.value, from: 0, label: cut(d.label, 80), decimals: Number.isInteger(d.value) ? 0 : 1 })) };
		case "equation":
			return { heading: h, steps: take(1, 8).map((x) => ({ tex: texText(x.label), note: D(x, 140) })) };
		case "graph":
			return { heading: h, functions: [{ expr: "x", label: cut(list[0]!.label, 40) }], x: [-5, 5], points: [], tracer: true };
		case "code":
			return { heading: h, language: "text", code: take(1, 12).map((x) => `# ${x.label}`).join("\n").slice(0, 4000), steps: take(1, 12).map((x, i) => ({ lines: [i + 1, i + 1], note: D(x, 200) })) };
		case "trace": {
			const arr = (c.numbers.length ? c.numbers.map((n) => n.value) : [3, 1, 4, 1, 5]).slice(0, 12);
			while (arr.length < 2) arr.push(arr.length);
			return { heading: h, array: arr, steps: take(1, 24).map((x, i) => ({ pointers: [{ name: "i", index: Math.min(i, arr.length - 1) }], done: [], note: L(x, 140) })) };
		}
		case "table":
			return { heading: h, columns: ["Item", "Details"], rows: take(1, 8).map((x) => [cut(x.label, 60), x.detail ? cut(x.detail, 60) : ""]) };
		case "timeline":
			return {
				heading: h,
				events: take(2, 8).map((x, i) => {
					const m = /^(.{1,30}?):\s*(.+)$/.exec(x.label);
					return m ? { date: m[1]!, label: cut(m[2]!, 60), detail: D(x, 140) } : { date: `Step ${i + 1}`, label: L(x, 60), detail: D(x, 140) };
				}),
			};
		case "map":
			// No coordinates to carry over: the pins start on the equator, spread out, to be moved in the editor.
			return { heading: h, view: "world", route: false, pins: take(1, 8).map((x, i, all) => ({ label: L(x, 40), detail: D(x, 100), lat: 0, lon: Math.round(-150 + (300 * (i + 0.5)) / all.length) })) };
		case "analogy": {
			const m = h ? /^(.{1,40}?) is like (.{1,40})$/i.exec(h) : null;
			return { heading: m ? undefined : h, idea: cut(m?.[1] ?? "The idea", 40), like: cut(m?.[2] ?? "Everyday thing", 40), pairs: take(1, 5).map((x) => ({ idea: L(x, 80), like: cut(x.detail ?? "…", 80) })) };
		}
		case "dialogue":
			return { setting: h ? cut(h, 60) : undefined, characters: [{ name: "Sam", look: "kid" }, { name: "Teacher", look: "teacher" }], lines: take(1, 10).map((x, i) => ({ who: i % 2, text: L(x, 140) })) };
		case "pause": {
			const q = c.heading ?? list[0]!.label;
			const a = list.find((x) => x.label !== q) ?? list[0]!;
			return { question: cut(q, 200), answer: cut(a.detail ?? a.label, 300), seconds: 5 };
		}
		case "quiz":
			return { heading: h, seconds: 4, questions: take(1, 4).map((x) => ({ question: L(x, 160), options: [cut(x.detail ?? "Yes", 80), "No"], answer: 0 })) };
		case "svg": {
			const words = xmlText(cut(h ?? list[0]!.label, 60));
			return { heading: h, svg: `<svg viewBox="0 0 800 400"><rect id="card" x="40" y="40" width="720" height="320" rx="28" fill="paper" stroke="accent" stroke-width="6"/><text id="words" x="400" y="215" text-anchor="middle" font-size="44" fill="ink">${words}</text></svg>`, animations: [{ target: "card", at: 0, from: { opacity: 0, scale: 0.8 }, to: { opacity: 1, scale: 1 }, ease: "spring" }] };
		}
		case "title":
			return { title: cut(h ?? list[0]!.label, 120), subtitle: list[0] && h ? L(list[0], 200) : undefined };
		case "chapter":
			return { number: 1, title: cut(h ?? list[0]!.label, 120) };
		case "figure":
			throw new Error("A figure scene needs a picture from the source.");
	}
}

/** The scene as another type: same id, narration and transition; new props; no cues. */
export function convertScene(scene: Scene, type: SceneType): Scene {
	if (type === scene.type) return scene;
	const raw = buildProps(type, extractContent(scene));
	const props = SCENE_PROPS[type].parse(JSON.parse(JSON.stringify(raw)));
	return { ...scene, type, props, cues: [] } as Scene;
}
