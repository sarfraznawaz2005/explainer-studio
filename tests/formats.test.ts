import { describe, expect, it } from "vitest";
import { isNarrow, isPhone, shapeOf } from "../src/shared/plan/frame";
import { VideoPlan } from "../src/shared/plan/schema";
import { formatOf, PlanSettings, VIDEO_FORMATS, type VideoFormat } from "../src/shared/planner";
import { shapeScore, needsPrompt } from "../src/main/pictures/find";
import { codePrompt } from "../src/main/planner/code";
import { FRAME_WORDS, lookPrompt } from "../src/main/planner/look";
import { scriptSystem } from "../src/main/planner/script";
import { placeLabels } from "../video/src/scenes/story-scenes";
import { SAMPLE_PLAN } from "../video/src/samples/web-page-journey";

const FORMATS = Object.keys(VIDEO_FORMATS) as VideoFormat[];

describe("video formats", () => {
	it("has wide, vertical, square and portrait sizes, and finds the format of any frame size", () => {
		expect(VIDEO_FORMATS.square).toMatchObject({ width: 1080, height: 1080 });
		expect(VIDEO_FORMATS.portrait).toMatchObject({ width: 1080, height: 1350 });
		for (const f of FORMATS) expect(formatOf(VIDEO_FORMATS[f])).toBe(f);
		// Older or odd sizes go to the nearest shape.
		expect(formatOf({ width: 1280, height: 720 })).toBe("landscape");
		expect(formatOf({ width: 720, height: 1280 })).toBe("vertical");
		expect(formatOf({ width: 1000, height: 1050 })).toBe("square");
		expect(shapeOf(1080, 1440)).toBe("portrait");
	});

	it("uses the stacked layouts for every narrow shape, and the phone margins only for 9:16", () => {
		expect(isNarrow(1920, 1080)).toBe(false);
		for (const f of ["vertical", "square", "portrait"] as const) expect(isNarrow(VIDEO_FORMATS[f].width, VIDEO_FORMATS[f].height)).toBe(true);
		expect(isPhone(1080, 1920)).toBe(true);
		expect(isPhone(1080, 1350)).toBe(false);
		expect(isPhone(1080, 1080)).toBe(false);
	});

	it("keeps old settings and plans working (16:9 by default)", () => {
		expect(PlanSettings.parse({ level: "High school" }).format).toBe("landscape");
		expect(PlanSettings.parse({ level: "High school", format: "square" }).format).toBe("square");
		const plan = VideoPlan.parse(SAMPLE_PLAN);
		expect(formatOf(plan.meta)).toBe("landscape");
	});

	it("tells the script writer about feed videos", () => {
		const s = (format: VideoFormat) => scriptSystem(PlanSettings.parse({ level: "High school", format }));
		expect(s("square")).toMatch(/square \(1:1\) video for social feeds/);
		expect(s("portrait")).toMatch(/portrait \(4:5\) video for social feeds/);
		expect(s("landscape")).not.toMatch(/social feeds/);
		expect(s("vertical")).toMatch(/vertical video \(9:16\)/);
	});

	it("names the frame in the look and code prompts", () => {
		for (const f of FORMATS) {
			const look = lookPrompt({ title: "x", level: "High school", tone: "Friendly", language: "en", format: f });
			expect(look).toContain(FRAME_WORDS[f]);
		}
		const plan = VideoPlan.parse({ ...SAMPLE_PLAN, meta: { ...SAMPLE_PLAN.meta, width: 1080, height: 1350 } });
		expect(codePrompt({ title: "x", level: "High school", tone: "Friendly", language: "en" }, plan)).toContain(`Frame: 1080×1350, ${FRAME_WORDS.portrait}`);
	});

	it("asks for photos that suit the shape", () => {
		expect(shapeScore({ width: 1000, height: 1000 }, "square")).toBe(2);
		expect(shapeScore({ width: 1600, height: 900 }, "square")).toBe(1);
		expect(shapeScore({ width: 800, height: 1000 }, "portrait")).toBe(2);
		expect(shapeScore({ width: 1600, height: 900 }, "portrait")).toBe(0);
		expect(shapeScore({ width: 1600, height: 900 }, "landscape")).toBe(2);
		const outline = { title: "Leaves", chapters: [] } as unknown as Parameters<typeof needsPrompt>[0];
		expect(needsPrompt(outline, PlanSettings.parse({ level: "High school", format: "square" }), [], 3)).toMatch(/Square \(1:1\)/);
	});
});

describe("map labels", () => {
	it("places cards so they do not cover each other, inside the map", () => {
		const W = 936;
		const H = 600;
		const pins = [
			{ x: 300, y: 300, label: "Congo", detail: "Second largest rainforest" },
			{ x: 420, y: 310, label: "Borneo", detail: "Very old rainforest" },
			{ x: 900, y: 20, label: "Edge" },
		];
		const places = placeLabels(pins, W, H, 300, 260);
		// The first card keeps the usual spot; the second card, close by, does not take the same one.
		expect(places[0]).toEqual({ flip: false, dy: -44 });
		expect(places[1]).not.toEqual(places[0]);
		// The pin at the top right edge turns its card to the left and below.
		expect(places[2]).toMatchObject({ flip: true });
		expect(places[2]!.dy).toBeGreaterThan(0);
		// A wide map with pins far apart: every card in the usual spot (as before).
		expect(placeLabels([{ x: 200, y: 400, label: "A" }, { x: 900, y: 400, label: "B" }], 1640, 880, 380, 360)).toEqual([
			{ flip: false, dy: -44 },
			{ flip: false, dy: -44 },
		]);
	});
});
