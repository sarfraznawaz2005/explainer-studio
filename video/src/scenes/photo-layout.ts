/**
 * Where a photo goes in the frame. When its shape is close to the frame's, it
 * fills the frame and is cropped around the subject (the focus point stays in
 * view, as near the middle as the edges allow). When the shapes differ a lot
 * (a wide photo in a vertical Short, a tall portrait in a wide video) cropping
 * would cut too much: the whole photo is shown, as large as fits, over a
 * blurred copy of itself that fills the frame.
 */

export type PhotoBox = { mode: "fill" | "fit"; left: number; top: number; width: number; height: number };

/** Shapes further apart than this (ratio of aspect ratios) are fitted, not cropped. */
export const FILL_LIMIT = 1.4;

export function photoLayout(img: { width: number; height: number }, frame: { width: number; height: number }, focus: { x: number; y: number } = { x: 50, y: 45 }, margin = 60): PhotoBox {
	const ri = img.width / img.height;
	const rf = frame.width / frame.height;
	const apart = Math.max(ri / rf, rf / ri);
	if (apart <= FILL_LIMIT) {
		const s = Math.max(frame.width / img.width, frame.height / img.height);
		const width = img.width * s;
		const height = img.height * s;
		// Put the focus point in the middle, then pull back so no edge shows.
		const left = clamp(frame.width / 2 - (focus.x / 100) * width, frame.width - width, 0);
		const top = clamp(frame.height / 2 - (focus.y / 100) * height, frame.height - height, 0);
		return { mode: "fill", left, top, width, height };
	}
	const s = Math.min((frame.width - 2 * margin) / img.width, (frame.height - 2 * margin) / img.height);
	const width = img.width * s;
	const height = img.height * s;
	return { mode: "fit", left: (frame.width - width) / 2, top: (frame.height - height) / 2, width, height };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
