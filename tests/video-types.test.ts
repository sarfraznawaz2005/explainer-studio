import { describe, expect, it } from "vitest";
import { PlanSettings, VIDEO_TYPES, type VideoType } from "../src/shared/planner";
import { outlineSystem } from "../src/main/planner/outline";
import { scriptSystem } from "../src/main/planner/script";

const settings = (videoType?: VideoType) => PlanSettings.parse({ level: "High school", ...(videoType ? { videoType } : {}) });

describe("video types", () => {
	it("defaults to an explainer, so old settings keep working", () => {
		expect(settings().videoType).toBe("explainer");
		expect(Object.keys(VIDEO_TYPES)).toEqual(["explainer", "launch", "data", "promo"]);
	});

	it("an explainer keeps the planner's own teaching arc and adds no guide", () => {
		expect(outlineSystem(settings("explainer"))).toBe(outlineSystem(settings()));
		expect(outlineSystem(settings())).not.toMatch(/LAUNCH|DATA STORY|PROMO/);
		expect(scriptSystem(settings())).not.toMatch(/This is a (launch video|data story|promo)/);
	});

	it.each([
		["launch", /This is a LAUNCH video/, /This is a launch video/, /call to action/],
		["data", /This is a DATA STORY/, /This is a data story/, /exactly as in the material/],
		["promo", /This is a PROMO/, /This is a promo/, /No quiz, pause, glossary or code scenes/],
	] as const)("%s: the outline and the script get its guide", (type, outline, script, detail) => {
		const o = outlineSystem(settings(type));
		const sc = scriptSystem(settings(type));
		expect(o).toMatch(outline);
		expect(sc).toMatch(script);
		expect(o + sc).toMatch(detail);
		// The guide comes after the base rules, so it can replace the teaching arc.
		expect(o.indexOf("instead of the teaching arc")).toBeGreaterThan(o.indexOf("Use the teaching arc"));
	});
});
