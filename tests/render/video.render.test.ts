/**
 * The chapter render path with the real Remotion bundle, headless Chrome and ffmpeg:
 * two chapters render to video-only MP4 + WAV at 720p, then join into one MP4 with
 * AAC sound, exactly as the render worker does. Also renders the 3 thumbnails to
 * tests/__stills__ for review. Slow; runs with `npm run test:render`.
 */
import { bundle } from "@remotion/bundler";
import { RenderInternals, renderMedia, renderStill, selectComposition } from "@remotion/renderer";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { VideoPlan } from "@shared/plan/schema";
import { computeTimeline } from "@shared/plan/timing";
import { outputSize } from "@shared/render";
import { concatList, joinArgs } from "../../src/main/render/media-server";
import { SAMPLE_PLAN } from "../../video/src/samples/web-page-journey";
import { tempDir } from "../helpers";

const OUT = resolve("tests/__stills__");
const APP_CHROME = join(process.env.APPDATA ?? "", "Explainer Studio/engine/node_modules/.remotion/chrome-headless-shell/win64/chrome-headless-shell-win64/chrome-headless-shell.exe");
const browserExecutable = existsSync(APP_CHROME) ? APP_CHROME : null;
const FFPROBE = resolve("node_modules/@remotion/compositor-win32-x64-msvc/ffprobe.exe");

let serveUrl = "";
beforeAll(async () => {
	mkdirSync(OUT, { recursive: true });
	serveUrl = await bundle({ entryPoint: resolve("video/src/index.ts") });
}, 240_000);

describe("video render path", () => {
	it("renders two chapters at 720p and joins them into one MP4 with AAC sound", async () => {
		const plan = VideoPlan.parse(SAMPLE_PLAN);
		const short = { ...plan, chapters: plan.chapters.slice(0, 2).map((c) => ({ ...c, scenes: c.scenes.slice(0, 1) })) };
		const tl = computeTimeline(short);
		const inputProps = { plan: short };
		const composition = await selectComposition({ serveUrl, id: "Explainer", inputProps, browserExecutable, chromeMode: "headless-shell" });
		const dir = tempDir("es-video-");
		const size = outputSize(short.meta, "720p");
		const parts = tl.chapters.map((_, i) => ({ video: join(dir, `chapter-0${i + 1}.mp4`), audio: join(dir, `chapter-0${i + 1}.wav`) }));
		for (const [i, c] of tl.chapters.entries()) {
			await renderMedia({
				serveUrl,
				composition,
				inputProps,
				codec: "h264",
				audioCodec: "pcm-16",
				separateAudioTo: parts[i]!.audio,
				frameRange: [c.from, c.from + c.durationInFrames - 1],
				scale: size.scale,
				crf: 26,
				x264Preset: "veryfast",
				pixelFormat: "yuv420p",
				outputLocation: parts[i]!.video,
				browserExecutable,
				chromeMode: "headless-shell",
				logLevel: "warn",
			});
			expect(statSync(parts[i]!.audio).size).toBeGreaterThan(44);
		}
		const vList = join(dir, "v.txt");
		const aList = join(dir, "a.txt");
		writeFileSync(vList, concatList(parts.map((p) => p.video)));
		writeFileSync(aList, concatList(parts.map((p) => p.audio)));
		const out = join(dir, "video.mp4");
		await RenderInternals.callFf({ bin: "ffmpeg", args: joinArgs(vList, aList, out), indent: false, logLevel: "warn", binariesDirectory: null, cancelSignal: undefined });
		const probe = JSON.parse(spawnSync(FFPROBE, ["-v", "error", "-show_streams", "-show_format", "-of", "json", out], { encoding: "utf8" }).stdout) as {
			streams: { codec_type: string; codec_name: string; width?: number; height?: number; r_frame_rate?: string; nb_frames?: string }[];
			format: { duration: string };
		};
		const v = probe.streams.find((s) => s.codec_type === "video")!;
		const a = probe.streams.find((s) => s.codec_type === "audio")!;
		expect(v).toMatchObject({ codec_name: "h264", width: 1280, height: 720, r_frame_rate: "30/1" });
		expect(Number(v.nb_frames)).toBe(tl.durationInFrames);
		expect(a.codec_name).toBe("aac");
		expect(Math.abs(Number(probe.format.duration) - tl.durationInFrames / 30)).toBeLessThan(0.08);
	}, 600_000);

	it("renders the three thumbnails at 1280×720", async () => {
		for (const variant of ["a", "b", "c"] as const) {
			for (const style of ["clean", "chalkboard"] as const) {
				const inputProps = { plan: SAMPLE_PLAN, variant, style };
				const composition = await selectComposition({ serveUrl, id: "Thumbnail", inputProps, browserExecutable, chromeMode: "headless-shell" });
				expect(composition).toMatchObject({ width: 1280, height: 720 });
				const file = join(OUT, `thumbnail-${variant}-${style}.png`);
				await renderStill({ serveUrl, composition, inputProps, output: file, imageFormat: "png", overwrite: true, browserExecutable, chromeMode: "headless-shell" });
				expect(statSync(file).size).toBeGreaterThan(30_000);
			}
		}
	}, 300_000);
});
