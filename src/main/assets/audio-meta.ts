/**
 * Audio length and file type from the bytes, with no extra packages.
 * Handles the formats the library accepts: MP3, OGG (Vorbis, Opus), WAV and FLAC.
 * Returns null when the bytes are not a file of that type, so a renamed or
 * broken file is refused instead of imported.
 */

export type AudioExt = "mp3" | "ogg" | "wav" | "flac";
export type ImageExt = "png" | "jpg" | "webp";
export type FontExt = "ttf" | "otf" | "woff" | "woff2";
export type FileExt = AudioExt | ImageExt | FontExt;

const ascii = (b: Buffer, at: number, len: number) => b.toString("latin1", at, at + len);

/** The real file type from its first bytes. */
export function sniff(b: Buffer): FileExt | null {
	if (b.length < 12) return null;
	if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WAVE") return "wav";
	if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") return "webp";
	if (ascii(b, 0, 4) === "OggS") return "ogg";
	if (ascii(b, 0, 4) === "fLaC") return "flac";
	if (ascii(b, 0, 3) === "ID3" || (b[0] === 0xff && (b[1]! & 0xe0) === 0xe0)) return "mp3";
	if (b.readUInt32BE(0) === 0x89504e47) return "png";
	if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
	if (ascii(b, 0, 4) === "wOF2") return "woff2";
	if (ascii(b, 0, 4) === "wOFF") return "woff";
	if (ascii(b, 0, 4) === "OTTO") return "otf";
	if (b.readUInt32BE(0) === 0x00010000 || ascii(b, 0, 4) === "true") return "ttf";
	return null;
}

function wavMs(b: Buffer): number | null {
	let p = 12;
	let byteRate = 0;
	while (p + 8 <= b.length) {
		const id = ascii(b, p, 4);
		const size = b.readUInt32LE(p + 4);
		if (id === "fmt ") byteRate = b.readUInt32LE(p + 16);
		if (id === "data") return byteRate ? Math.round((Math.min(size, b.length - p - 8) / byteRate) * 1000) : null;
		p += 8 + size + (size & 1);
	}
	return null;
}

function oggMs(b: Buffer): number | null {
	// First page holds the codec header packet.
	const segs = b[26]!;
	const head = 27 + segs;
	let rate = 0;
	let preSkip = 0;
	if (b[head] === 1 && ascii(b, head + 1, 6) === "vorbis") rate = b.readUInt32LE(head + 12);
	else if (ascii(b, head, 8) === "OpusHead") {
		rate = 48000;
		preSkip = b.readUInt16LE(head + 10);
	}
	if (!rate) return null;
	// Last page holds the final granule position (samples).
	for (let p = b.length - 27; p >= 0; p--) {
		if (b[p] === 0x4f && ascii(b, p, 4) === "OggS") {
			const granule = Number(b.readBigUInt64LE(p + 6));
			return granule > preSkip ? Math.round(((granule - preSkip) / rate) * 1000) : null;
		}
	}
	return null;
}

function flacMs(b: Buffer): number | null {
	// STREAMINFO is always the first metadata block.
	const d = 8;
	if (b.length < d + 18) return null;
	const rate = (b[d + 10]! << 12) | (b[d + 11]! << 4) | (b[d + 12]! >> 4);
	const total = (b[d + 13]! & 0x0f) * 2 ** 32 + b.readUInt32BE(d + 14);
	return rate && total ? Math.round((total / rate) * 1000) : null;
}

const MP3_BITRATES: Record<string, number[]> = {
	"1-1": [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
	"1-2": [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
	"1-3": [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
	"2-1": [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
	"2-2": [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const MP3_RATES: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

type Mp3Frame = { size: number; samples: number; rate: number; mono: boolean; v1: boolean };

function mp3Frame(b: Buffer, p: number): Mp3Frame | null {
	if (p + 4 > b.length || b[p] !== 0xff || (b[p + 1]! & 0xe0) !== 0xe0) return null;
	const ver = (b[p + 1]! >> 3) & 3; // 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5
	const layerBits = (b[p + 1]! >> 1) & 3;
	if (ver === 1 || layerBits === 0) return null;
	const layer = 4 - layerBits;
	const brIdx = b[p + 2]! >> 4;
	const srIdx = (b[p + 2]! >> 2) & 3;
	if (brIdx === 0 || brIdx === 15 || srIdx === 3) return null;
	const v1 = ver === 3;
	const kbps = MP3_BITRATES[v1 ? `1-${layer}` : layer === 1 ? "2-1" : "2-2"]![brIdx]!;
	const rate = MP3_RATES[ver]![srIdx]!;
	const pad = (b[p + 2]! >> 1) & 1;
	const samples = layer === 1 ? 384 : layer === 3 && !v1 ? 576 : 1152;
	const size = layer === 1 ? (Math.floor((12 * kbps * 1000) / rate) + pad) * 4 : Math.floor(((samples / 8) * kbps * 1000) / rate) + pad;
	return size > 4 ? { size, samples, rate, mono: (b[p + 3]! >> 6) === 3, v1 } : null;
}

function mp3Ms(b: Buffer): number | null {
	let p = 0;
	if (ascii(b, 0, 3) === "ID3") {
		const size = ((b[6]! & 0x7f) << 21) | ((b[7]! & 0x7f) << 14) | ((b[8]! & 0x7f) << 7) | (b[9]! & 0x7f);
		p = 10 + size + (b[5]! & 0x10 ? 10 : 0);
	}
	// Find the first frame that is followed by another frame (avoids false syncs in junk).
	let first: Mp3Frame | null = null;
	for (const end = Math.min(b.length, p + 64 * 1024); p < end; p++) {
		const f = mp3Frame(b, p);
		if (f && mp3Frame(b, p + f.size)) {
			first = f;
			break;
		}
	}
	if (!first) return null;
	// Xing/Info (VBR and LAME CBR) or VBRI headers give the frame count directly.
	const side = first.v1 ? (first.mono ? 17 : 32) : first.mono ? 9 : 17;
	const x = p + 4 + side;
	const tag = ascii(b, x, 4);
	if ((tag === "Xing" || tag === "Info") && b.readUInt32BE(x + 4) & 1) {
		const frames = b.readUInt32BE(x + 8);
		if (frames) return Math.round(((frames * first.samples) / first.rate) * 1000);
	}
	if (ascii(b, p + 36, 4) === "VBRI") {
		const frames = b.readUInt32BE(p + 36 + 14);
		if (frames) return Math.round(((frames * first.samples) / first.rate) * 1000);
	}
	// No header: walk every frame.
	let samples = 0;
	let q = p;
	for (;;) {
		const f = mp3Frame(b, q);
		if (!f) break;
		samples += f.samples;
		q += f.size;
	}
	return samples ? Math.round((samples / first.rate) * 1000) : null;
}

/** Length of an audio file in ms, or null when the bytes are not valid audio of a known type. */
export function audioDurationMs(b: Buffer): { ext: AudioExt; durationMs: number } | null {
	const ext = sniff(b);
	let ms: number | null = null;
	try {
		if (ext === "wav") ms = wavMs(b);
		else if (ext === "ogg") ms = oggMs(b);
		else if (ext === "flac") ms = flacMs(b);
		else if (ext === "mp3") ms = mp3Ms(b);
	} catch {
		ms = null;
	}
	return ext && ms && ms > 0 ? { ext: ext as AudioExt, durationMs: ms } : null;
}
