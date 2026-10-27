import { describe, expect, it } from "vitest";
import { captionBand, captionGroups, groupAt, groupWords, splitWords, wordTimes } from "../src/shared/plan/captions";
import { codeVideoData } from "../src/shared/plan/code-data";
import { VideoPlan } from "../src/shared/plan/schema";
import { computeTimeline } from "../src/shared/plan/timing";
import { SAMPLE_PLAN } from "../video/src/samples/web-page-journey";

describe("captions", () => {
	it("spreads a sentence's time over its words by length, with a pause after punctuation", () => {
		const w = wordTimes("A browser asks, then waits.", 100, 60);
		expect(w.map((x) => x.text)).toEqual(["A", "browser", "asks,", "then", "waits."]);
		expect(w[0]!.from).toBe(100);
		expect(w.at(-1)!.to).toBe(160);
		// In order, no gaps, longer words take longer.
		for (let i = 1; i < w.length; i++) expect(w[i]!.from).toBe(w[i - 1]!.to);
		expect(w[1]!.to - w[1]!.from).toBeGreaterThan(w[0]!.to - w[0]!.from);
		// "asks," (4 letters and a comma) takes longer than "then" (4 letters).
		expect(w[2]!.to - w[2]!.from).toBeGreaterThan(w[3]!.to - w[3]!.from);
	});

	it("cuts text without spaces into short pieces", () => {
		expect(splitWords("光合作用是植物利用光能制造养分的过程")).toHaveLength(3);
		expect(splitWords("hello")).toEqual(["hello"]);
	});

	it("groups 2 to 5 words (4 and fewer letters in narrow frames) and breaks at the end of a clause", () => {
		const words = wordTimes("Your browser sends a request, the server finds the page and sends it back to you.", 0, 300);
		const wide = groupWords(words, false);
		expect(wide.every((g) => g.length >= 1 && g.length <= 5)).toBe(true);
		expect(wide[0]!.map((w) => w.text).join(" ")).toBe("Your browser sends a request,");
		const narrow = groupWords(words, true);
		expect(narrow.every((g) => g.length <= 4 && g.map((w) => w.text).join(" ").length <= 22 + 6)).toBe(true);
		expect(narrow.length).toBeGreaterThan(wide.length);
		// Every word once, in order.
		expect(narrow.flat().map((w) => w.text)).toEqual(words.map((w) => w.text));
	});

	it("shows one group at a time over the whole video, never two at once", () => {
		const plan = VideoPlan.parse(SAMPLE_PLAN);
		const t = computeTimeline(plan);
		const groups = captionGroups(t, 1920, 1080);
		expect(groups.length).toBeGreaterThan(20);
		for (let i = 1; i < groups.length; i++) expect(groups[i]!.from).toBeGreaterThanOrEqual(groups[i - 1]!.to);
		const g = groups[5]!;
		expect(groupAt(groups, g.from)).toBe(g);
		expect(groupAt(groups, g.to - 1)).toBe(g);
		expect(groupAt(groups, 0)).toBeNull();
		// A group lasts at least as long as its words.
		expect(groups.every((x) => x.to >= x.words.at(-1)!.to || x.to === groups[groups.indexOf(x) + 1]?.from)).toBe(true);
	});

	it("puts the band above the phone app's buttons in 9:16, near the bottom elsewhere, and none when off", () => {
		expect(captionBand("off", 1920, 1080)).toEqual({ bottom: 0, height: 0 });
		const wide = captionBand("pill", 1920, 1080);
		const phone = captionBand("pop", 1080, 1920);
		expect(wide.bottom).toBeLessThan(100);
		expect(phone.bottom).toBeGreaterThan(330);
	});

	it("is off by default, and tells AI code where the band is", () => {
		const plan = VideoPlan.parse(SAMPLE_PLAN);
		expect(plan.meta.captions).toBe("off");
		expect(codeVideoData(plan, computeTimeline(plan)).captions).toEqual({ bottom: 0, height: 0 });
		const on = VideoPlan.parse({ ...SAMPLE_PLAN, meta: { ...SAMPLE_PLAN.meta, captions: "karaoke" } });
		expect(codeVideoData(on, computeTimeline(on)).captions.height).toBeGreaterThan(0);
	});
});
