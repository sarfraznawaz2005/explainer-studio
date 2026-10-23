import { crc32, deflateSync } from "node:zlib";
import JSZip from "jszip";

/** A solid-colour PNG with a darker stripe, w×h pixels. */
export function makePng(w: number, h: number, rgb: [number, number, number] = [40, 120, 200]): Buffer {
	const raw = Buffer.alloc((w * 3 + 1) * h);
	for (let y = 0; y < h; y++) {
		raw[y * (w * 3 + 1)] = 0;
		for (let x = 0; x < w; x++) {
			const o = y * (w * 3 + 1) + 1 + x * 3;
			const k = y > h / 3 && y < h / 2 ? 0.5 : 1;
			raw[o] = rgb[0] * k;
			raw[o + 1] = rgb[1] * k;
			raw[o + 2] = rgb[2] * k;
		}
	}
	const chunk = (type: string, data: Buffer) => {
		const len = Buffer.alloc(4);
		len.writeUInt32BE(data.length);
		const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
		const crc = Buffer.alloc(4);
		crc.writeUInt32BE(crc32(td) >>> 0);
		return Buffer.concat([len, td, crc]);
	};
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(w, 0);
	ihdr.writeUInt32BE(h, 4);
	ihdr[8] = 8;
	ihdr[9] = 2;
	return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

export type PdfLine = { text: string; size: number; y: number; x?: number };
export type PdfPage = { lines: PdfLine[]; image?: { x: number; y: number; w: number; h: number; px: [number, number]; rgb?: [number, number, number] } };

/** A small, valid PDF with Helvetica text and optional raw RGB images (612×792 pt pages). */
export function makePdf(pages: PdfPage[]): Buffer {
	const objs: (string | Buffer)[] = [];
	const add = (o: string | Buffer) => (objs.push(o), objs.length);
	const esc = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`);
	const catalog = add("");
	const pagesObj = add("");
	const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
	const kids: number[] = [];
	for (const p of pages) {
		let img: number | null = null;
		if (p.image) {
			const [pw, ph] = p.image.px;
			const data = Buffer.alloc(pw * ph * 3);
			const [r, g, b] = p.image.rgb ?? [200, 60, 60];
			for (let i = 0; i < pw * ph; i++) {
				data[i * 3] = r;
				data[i * 3 + 1] = (g + (i % pw)) % 256;
				data[i * 3 + 2] = b;
			}
			img = add(Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${pw} /Height ${ph} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length ${data.length} >>\nstream\n`), data, Buffer.from("\nendstream")]));
		}
		let content = p.lines.map((l) => `BT /F1 ${l.size} Tf ${l.x ?? 72} ${l.y} Td (${esc(l.text)}) Tj ET`).join("\n");
		if (p.image) content += `\nq ${p.image.w} 0 0 ${p.image.h} ${p.image.x} ${p.image.y} cm /Im1 Do Q`;
		const stream = add(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);
		const xobj = img ? ` /XObject << /Im1 ${img} 0 R >>` : "";
		kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >>${xobj} >> /Contents ${stream} 0 R >>`));
	}
	objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
	objs[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;
	const parts: Buffer[] = [Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n", "latin1")];
	const offsets: number[] = [];
	let pos = parts[0]!.length;
	objs.forEach((o, i) => {
		const body = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), typeof o === "string" ? Buffer.from(o, "latin1") : o, Buffer.from("\nendobj\n")]);
		offsets.push(pos);
		parts.push(body);
		pos += body.length;
	});
	const xref = [`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`, ...offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`)].join("");
	parts.push(Buffer.from(`${xref}trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${pos}\n%%EOF\n`));
	return Buffer.concat(parts);
}

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';

export type DocxPara = { style?: "Heading1" | "Heading2" | "Caption" | "ListParagraph"; text?: string; image?: boolean };

/** A minimal .docx with headings, paragraphs, an optional picture and a caption. */
export async function makeDocx(paras: DocxPara[], png?: Buffer): Promise<Buffer> {
	const zip = new JSZip();
	zip.file(
		"[Content_Types].xml",
		`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`,
	);
	zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
	zip.file(
		"word/_rels/document.xml.rels",
		`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/></Relationships>`,
	);
	const style = (id: string, name: string) => `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/></w:style>`;
	zip.file(
		"word/styles.xml",
		`<?xml version="1.0" encoding="UTF-8"?><w:styles ${W}>${style("Normal", "Normal")}${style("Heading1", "heading 1")}${style("Heading2", "heading 2")}${style("Caption", "caption")}${style("ListParagraph", "List Paragraph")}</w:styles>`,
	);
	if (png) zip.file("word/media/image1.png", png);
	const drawing = `<w:drawing><wp:inline><wp:extent cx="1905000" cy="1143000"/><wp:docPr id="1" name="Picture 1" descr="A test picture"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="image1.png" descr="A test picture"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId5"/></pic:blipFill><pic:spPr/></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>`;
	const body = paras
		.map((p) => {
			const ppr = p.style ? `<w:pPr><w:pStyle w:val="${p.style}"/></w:pPr>` : "";
			const run = p.image ? `<w:r>${drawing}</w:r>` : `<w:r><w:t xml:space="preserve">${(p.text ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")}</w:t></w:r>`;
			return `<w:p>${ppr}${run}</w:p>`;
		})
		.join("");
	zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8"?><w:document ${W}><w:body>${body}</w:body></w:document>`);
	return zip.generateAsync({ type: "nodebuffer" });
}
