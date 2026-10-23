/**
 * Pre-bundles the Remotion project for the release build, so the installed app
 * never runs webpack. The folder ships as resources/video-bundle (see electron-builder.yml).
 */
import { bundle } from "@remotion/bundler";
import { rmSync } from "node:fs";
import { resolve } from "node:path";

const outDir = resolve("out/video-bundle");
rmSync(outDir, { recursive: true, force: true });
let last = -1;
await bundle({
	entryPoint: resolve("video/src/index.ts"),
	outDir,
	onProgress: (p) => {
		const step = Math.floor(p / 25);
		if (step > last) console.log(`bundling video ${p}%`), (last = step);
	},
});
console.log(`video bundle written to ${outDir}`);
