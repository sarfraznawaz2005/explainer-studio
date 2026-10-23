import { existsSync } from "node:fs";
import { mkdir, readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { runTool } from "../security/exec";
import type { SourceBuilder } from "./builder";
import { readHtml } from "./html";
import type { ImageSaver } from "./images";

/** Shown when an old .doc file arrives and LibreOffice is not installed. */
export const DOC_NEEDS_LIBREOFFICE =
	"Old Word files (.doc) need LibreOffice to be read. Open the file in Word and choose File → Save As → Word Document (.docx), then add the .docx. Or install LibreOffice (free) from libreoffice.org and try again.";

export class IngestUserError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "IngestUserError";
	}
}

/** Word → HTML with mammoth. Pictures are saved as figures; "Caption" paragraphs become their captions. */
export async function readDocx(file: string, b: SourceBuilder, images: ImageSaver): Promise<void> {
	const mammoth = await import("mammoth");
	const result = await mammoth.convertToHtml(
		{ path: file },
		{
			styleMap: ["p[style-name='Caption'] => p.caption:fresh", "p[style-name='caption'] => p.caption:fresh", "p[style-name='Title'] => h1:fresh", "p[style-name='Subtitle'] => h2:fresh"],
			convertImage: mammoth.images.imgElement(async (image) => {
				const buf = Buffer.from(await image.readAsBase64String(), "base64");
				const saved = await images.saveBuffer(buf, image.contentType);
				// The saved path is resolved back by the resolver below; unsupported formats (EMF/WMF) are dropped.
				return { src: saved ? `figure:${saved.file}|${saved.width}|${saved.height}|${saved.mediaType}` : "" };
			}),
		},
	);
	if (result.messages.some((m) => m.type === "error")) b.warn(`Parts of ${basename(file)} could not be read.`);
	await readHtml(result.value, b, async (src) => {
		const m = /^figure:([^|]+)\|(\d+)\|(\d+)\|(.+)$/.exec(src);
		return m ? { file: m[1]!, width: Number(m[2]), height: Number(m[3]), mediaType: m[4]!, page: null } : null;
	});
}

/** soffice.exe on PATH or in the usual install folders. Dev builds can override with EXPLAINER_SOFFICE. */
export function findSoffice(env: NodeJS.ProcessEnv = process.env, platform = process.platform): string | null {
	if (env.EXPLAINER_SOFFICE !== undefined) return env.EXPLAINER_SOFFICE && existsSync(env.EXPLAINER_SOFFICE) ? env.EXPLAINER_SOFFICE : null;
	const candidates =
		platform === "win32"
			? [
					join(env.ProgramFiles ?? "C:\\Program Files", "LibreOffice", "program", "soffice.exe"),
					join(env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "LibreOffice", "program", "soffice.exe"),
				]
			: ["/usr/bin/soffice", "/usr/local/bin/soffice", "/Applications/LibreOffice.app/Contents/MacOS/soffice", "/snap/bin/libreoffice"];
	for (const dir of (env.PATH ?? env.Path ?? "").split(platform === "win32" ? ";" : ":")) {
		if (dir) candidates.push(join(dir, platform === "win32" ? "soffice.exe" : "soffice"));
	}
	return candidates.find((c) => existsSync(c)) ?? null;
}

/** Converts .doc to .docx with LibreOffice (headless, its own temp profile), then reads it. */
export async function readDoc(file: string, b: SourceBuilder, images: ImageSaver, tmpDir: string, signal?: AbortSignal, soffice = findSoffice()): Promise<void> {
	if (!soffice) throw new IngestUserError(DOC_NEEDS_LIBREOFFICE);
	const out = join(tmpDir, "doc-convert");
	await mkdir(out, { recursive: true });
	const profile = `file:///${join(tmpDir, "lo-profile").replace(/\\/g, "/")}`;
	await runTool(soffice, [`-env:UserInstallation=${profile}`, "--headless", "--norestore", "--convert-to", "docx", "--outdir", out, file], { timeoutMs: 3 * 60_000, signal });
	const docx = (await readdir(out)).find((n) => n.toLowerCase().endsWith(".docx"));
	if (!docx) throw new IngestUserError(`LibreOffice could not convert ${basename(file)}. Save it as .docx in Word and try again.`);
	await readDocx(join(out, docx), b, images);
}
