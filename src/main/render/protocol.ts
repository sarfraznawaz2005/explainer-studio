import type { RenderUpdate } from "@shared/ipc/render";
import type { MediaRoots } from "../app/media-url";

/** One step of a video render. Main runs the steps in order and keeps the state; the worker only does the work. */
export type Task =
	/** Downloads the render browser if needed and bundles the video code. */
	| { kind: "prepare"; entryPoint: string }
	/** One chapter: video-only H.264 plus a lossless WAV of its sound. */
	| {
			kind: "chapter";
			entryPoint: string;
			inputProps: Record<string, unknown>;
			frameRange: [number, number];
			videoPath: string;
			audioPath: string;
			scale: number;
			crf: number;
			preset: "veryfast" | "medium" | "slow";
			roots: MediaRoots;
	  }
	/** Joins the chapter files into one MP4 (video copied, sound encoded to AAC once). */
	| { kind: "join"; videoParts: string[]; audioParts: string[]; outputPath: string; durationMs: number }
	/** One PNG still (thumbnails). */
	| { kind: "still"; entryPoint: string; compositionId: string; inputProps: Record<string, unknown>; outputPath: string; roots: MediaRoots };

/** Messages from main to the render worker. */
export type ToWorker =
	| {
			type: "start";
			jobId: string;
			entryPoint: string;
			compositionId: string;
			inputProps: Record<string, unknown>;
			outputPath: string;
	  }
	| { type: "cancel"; jobId: string }
	| { type: "task"; jobId: string; taskId: string; task: Task };

/** Messages from the render worker to main. */
export type FromWorker =
	| { type: "update"; update: RenderUpdate }
	| { type: "log"; level: "info" | "warn" | "error"; message: string }
	| { type: "progress"; taskId: string; progress: number; detail?: string }
	| { type: "result"; taskId: string; ok: true }
	| { type: "result"; taskId: string; ok: false; cancelled: boolean; error: string };
