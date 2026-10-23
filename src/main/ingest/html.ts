import { load, type CheerioAPI } from "cheerio";
import type { AnyNode, Element } from "domhandler";
import { clean, type SourceBuilder } from "./builder";
import type { ImageResolver } from "./images";

/** Page furniture that is never learning content. */
const DROP = "script, style, noscript, template, iframe, object, embed, nav, header, footer, aside, form, button, input, select, textarea, svg, canvas, [hidden], [aria-hidden=true], .sr-only";

const BLOCKS = new Set(["p", "div", "section", "article", "main", "ul", "ol", "table", "pre", "blockquote", "figure", "img", "h1", "h2", "h3", "h4", "h5", "h6", "dl", "hr", "body"]);

/**
 * HTML (and Word documents, which mammoth turns into HTML): headings start
 * sections; paragraphs, lists, tables, code, quotes and images become blocks.
 * Navigation, scripts and forms are dropped. The main/article element is used
 * when the page has one.
 */
export async function readHtml(html: string, b: SourceBuilder, resolveImage: ImageResolver, opts: { captionClass?: string } = {}): Promise<{ title: string | null }> {
	const $ = load(html);
	const title = clean($("title").first().text()) || null;
	$(DROP).remove();
	const root: { children: AnyNode[] } = $("main").get(0) ?? $("article").get(0) ?? $("body").get(0) ?? $.root().get(0)!;
	await walk($, root.children, b, resolveImage, opts.captionClass ?? "caption");
	return { title };
}

const textOf = ($: CheerioAPI, el: AnyNode) => clean($(el).text());

async function addImage($: CheerioAPI, img: Element, b: SourceBuilder, resolveImage: ImageResolver, caption: string | null) {
	const src = $(img).attr("src");
	if (!src) return;
	const f = await resolveImage(src);
	if (f) b.figure({ ...f, caption: caption ?? (clean($(img).attr("alt") ?? "") || null) });
}

async function walk($: CheerioAPI, nodes: AnyNode[], b: SourceBuilder, resolveImage: ImageResolver, captionClass: string): Promise<void> {
	let inline: string[] = [];
	const flush = () => {
		const t = clean(inline.join(" "));
		if (t) b.paragraph(t);
		inline = [];
	};
	for (let i = 0; i < nodes.length; i++) {
		const node = nodes[i]!;
		if (node.type === "text") {
			inline.push((node as unknown as { data: string }).data);
			continue;
		}
		if (node.type !== "tag") continue;
		const el = node as Element;
		const tag = el.name.toLowerCase();
		if (!BLOCKS.has(tag) && !$(el).find([...BLOCKS].join(",")).length) {
			inline.push($(el).text());
			continue;
		}
		flush();
		const h = /^h([1-6])$/.exec(tag);
		if (h) {
			b.heading(textOf($, el), Number(h[1]));
			continue;
		}
		switch (tag) {
			case "p": {
				const imgs = $(el).find("img").toArray();
				for (const img of imgs) {
					// Word puts a picture in its own paragraph with the caption right after it.
					const next = nodes.slice(i + 1).find((n) => n.type === "tag") as Element | undefined;
					const cap = next && next.name === "p" && $(next).hasClass(captionClass) ? textOf($, next) : null;
					await addImage($, img, b, resolveImage, cap);
				}
				if ($(el).hasClass(captionClass) && imgs.length === 0) {
					// Already used as the caption of the picture above.
					const prev = nodes.slice(0, i).reverse().find((n) => n.type === "tag") as Element | undefined;
					if (prev && $(prev).find("img").length) continue;
				}
				const t = textOf($, el);
				if (t) b.paragraph(t);
				break;
			}
			case "ul":
			case "ol": {
				const items = $(el)
					.children("li")
					.toArray()
					.map((li) => {
						const c = $(li).clone();
						c.find("ul, ol").remove();
						const nested = $(li)
							.find("li")
							.toArray()
							.map((n) => textOf($, n));
						return [clean(c.text()), ...nested.map((n) => `– ${n}`)].join(" ");
					});
				b.add({ type: "list", ordered: tag === "ol", items });
				break;
			}
			case "dl": {
				const items = $(el)
					.children("dt")
					.toArray()
					.map((dt) => `${textOf($, dt)}: ${clean($(dt).nextUntil("dt", "dd").text())}`);
				b.add({ type: "list", ordered: false, items });
				break;
			}
			case "table": {
				const rows = $(el)
					.find("tr")
					.toArray()
					.map((tr) =>
						$(tr)
							.children("th, td")
							.toArray()
							.map((c) => textOf($, c)),
					);
				b.add({ type: "table", rows, caption: clean($(el).find("caption").first().text()) || null });
				break;
			}
			case "pre":
				b.add({ type: "code", text: $(el).text() });
				break;
			case "blockquote":
				b.add({ type: "quote", text: textOf($, el) });
				break;
			case "figure": {
				const cap = clean($(el).find("figcaption").first().text()) || null;
				const imgs = $(el).find("img").toArray();
				for (const img of imgs) await addImage($, img, b, resolveImage, cap);
				if (!imgs.length) {
					const t = textOf($, el);
					if (t) b.paragraph(t);
				}
				break;
			}
			case "img":
				await addImage($, el, b, resolveImage, null);
				break;
			case "hr":
				break;
			default:
				await walk($, el.children as AnyNode[], b, resolveImage, captionClass);
		}
	}
	flush();
}
