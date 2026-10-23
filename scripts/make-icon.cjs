/**
 * Draws the app icon from the same mark as the title bar logo
 * (src/renderer/src/components/layout/logo.tsx) and writes:
 *   build/icon.ico      exe, installer, uninstaller, shortcuts (16-256 px)
 *   build/icon.png      512 px source
 *   resources/icon.png  window and taskbar icon at run time (256 px)
 * Run with: npm run icon   (uses Electron to draw the SVG; no extra packages)
 */
const { app, BrowserWindow } = require("electron");
const { mkdirSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");

const root = resolve(__dirname, "..");
const SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256];

// Small sizes drop the spark and use a slightly bigger play shape, so they stay sharp.
const svg = (small) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="oklch(0.62 0.21 285)"/><stop offset="1" stop-color="oklch(0.5 0.22 262)"/>
</linearGradient></defs>
<rect width="32" height="32" rx="8" fill="url(#g)"/>
${
	small
		? `<path d="M11.5 8.6c0-1 1.1-1.7 2-1.1l10 6.2c.9.5.9 1.8 0 2.4l-10 6.2c-.9.6-2-.1-2-1.1V8.6z" fill="#fff"/>`
		: `<path d="M12.5 9.8c0-.9 1-1.5 1.8-1l8.6 5.2c.8.5.8 1.6 0 2.1l-8.6 5.2c-.8.5-1.8-.1-1.8-1V9.8z" fill="#fff"/>
<path d="M24.5 21.5l.7 1.7 1.7.7-1.7.7-.7 1.7-.7-1.7-1.7-.7 1.7-.7z" fill="#fff" opacity=".9"/>`
}
</svg>`;

async function draw(win, size) {
	const html = `<html><body style="margin:0;background:transparent"><img width="${size}" height="${size}" src="data:image/svg+xml;base64,${Buffer.from(svg(size <= 32)).toString("base64")}"></body></html>`;
	await win.loadURL(`data:text/html;base64,${Buffer.from(html).toString("base64")}`);
	await new Promise((r) => setTimeout(r, 150));
	const img = await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size });
	return img.resize({ width: size, height: size, quality: "best" }).toPNG();
}

/** ICO file with PNG entries (Windows Vista and later). */
function ico(pngs) {
	const head = Buffer.alloc(6 + 16 * pngs.length);
	head.writeUInt16LE(0, 0);
	head.writeUInt16LE(1, 2);
	head.writeUInt16LE(pngs.length, 4);
	let offset = head.length;
	pngs.forEach(({ size, data }, i) => {
		const e = 6 + 16 * i;
		head.writeUInt8(size >= 256 ? 0 : size, e);
		head.writeUInt8(size >= 256 ? 0 : size, e + 1);
		head.writeUInt16LE(1, e + 4); // colour planes
		head.writeUInt16LE(32, e + 6); // bits per pixel
		head.writeUInt32LE(data.length, e + 8);
		head.writeUInt32LE(offset, e + 12);
		offset += data.length;
	});
	return Buffer.concat([head, ...pngs.map((p) => p.data)]);
}

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
	const win = new BrowserWindow({ width: 512, height: 512, show: false, transparent: true, frame: false, useContentSize: true, webPreferences: { offscreen: true } });
	const pngs = [];
	for (const size of SIZES) pngs.push({ size, data: await draw(win, size) });
	mkdirSync(join(root, "build"), { recursive: true });
	writeFileSync(join(root, "build", "icon.ico"), ico(pngs));
	writeFileSync(join(root, "build", "icon.png"), await draw(win, 512));
	writeFileSync(join(root, "resources", "icon.png"), pngs.find((p) => p.size === 256).data);
	console.log(`icon written: ${SIZES.join(", ")} px`);
	app.quit();
});
