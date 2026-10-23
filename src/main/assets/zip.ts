import { crc32, inflateRawSync } from "node:zlib";

/**
 * Reads named files out of a ZIP held in memory. Only what the starter pack
 * needs: stored and deflated entries, no encryption, no ZIP64. Entry names are
 * only compared, never used as paths, so a crafted name cannot escape a folder.
 * Every entry is size-capped and CRC-checked.
 */

export class ZipError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ZipError";
	}
}

type Entry = { name: string; method: number; crc: number; compSize: number; size: number; offset: number };

function entries(zip: Buffer): Map<string, Entry> {
	// End of central directory: last 22 bytes, plus up to 64 KB of comment.
	let eocd = -1;
	for (let p = zip.length - 22; p >= Math.max(0, zip.length - 22 - 65_535); p--) {
		if (zip.readUInt32LE(p) === 0x06054b50) {
			eocd = p;
			break;
		}
	}
	if (eocd < 0) throw new ZipError("Not a ZIP file");
	const count = zip.readUInt16LE(eocd + 10);
	let p = zip.readUInt32LE(eocd + 16);
	const out = new Map<string, Entry>();
	for (let i = 0; i < count; i++) {
		if (p + 46 > zip.length || zip.readUInt32LE(p) !== 0x02014b50) throw new ZipError("Broken ZIP directory");
		const nameLen = zip.readUInt16LE(p + 28);
		const name = zip.toString("utf8", p + 46, p + 46 + nameLen);
		out.set(name, {
			name,
			method: zip.readUInt16LE(p + 10),
			crc: zip.readUInt32LE(p + 16),
			compSize: zip.readUInt32LE(p + 20),
			size: zip.readUInt32LE(p + 24),
			offset: zip.readUInt32LE(p + 42),
		});
		p += 46 + nameLen + zip.readUInt16LE(p + 30) + zip.readUInt16LE(p + 32);
	}
	return out;
}

/** Names of all entries. */
export function zipNames(zip: Buffer): string[] {
	return [...entries(zip).keys()];
}

/** The bytes of one entry. Throws when it is missing, too big, or damaged. */
export function readZipEntry(zip: Buffer, name: string, maxBytes = 50 * 1024 * 1024): Buffer {
	const e = entries(zip).get(name);
	if (!e) throw new ZipError(`${name} is missing from the ZIP`);
	if (e.size > maxBytes) throw new ZipError(`${name} is too large`);
	const p = e.offset;
	if (p + 30 > zip.length || zip.readUInt32LE(p) !== 0x04034b50) throw new ZipError(`Broken ZIP entry ${name}`);
	const start = p + 30 + zip.readUInt16LE(p + 26) + zip.readUInt16LE(p + 28);
	const raw = zip.subarray(start, start + e.compSize);
	let data: Buffer;
	if (e.method === 0) data = Buffer.from(raw);
	else if (e.method === 8) data = inflateRawSync(raw, { maxOutputLength: Math.max(1, e.size) });
	else throw new ZipError(`${name} uses an unsupported compression`);
	if (data.length !== e.size || crc32(data) >>> 0 !== e.crc >>> 0) throw new ZipError(`${name} is damaged (checksum mismatch)`);
	return data;
}
