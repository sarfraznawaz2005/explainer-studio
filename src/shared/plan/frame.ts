/**
 * The shape of a video frame. Kept apart from the planner settings so the video
 * bundle can use it without them.
 *  - landscape 16:9: YouTube, web;
 *  - vertical 9:16: phones held upright (Shorts, TikTok, Reels); the app's own
 *    bar and buttons cover the top and bottom of the frame;
 *  - square 1:1 and portrait 4:5: feeds (Instagram, Facebook, LinkedIn); only a margin.
 */
export type FrameShape = "landscape" | "vertical" | "square" | "portrait";

/** The shape nearest to a frame size (any size: older plans and hand-edited ones too). */
export function shapeOf(width: number, height: number): FrameShape {
	const r = width / height;
	if (r >= 1.3) return "landscape";
	if (r >= 0.9) return "square";
	if (r >= 0.68) return "portrait";
	return "vertical";
}

/** Narrow frames (all but wide) use the stacked scene layouts. */
export const isNarrow = (width: number, height: number) => shapeOf(width, height) !== "landscape";

/** 9:16 on a phone: keep clear of the app's own bar, buttons and captions. */
export const isPhone = (width: number, height: number) => shapeOf(width, height) === "vertical";
