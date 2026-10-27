import { describe, expect, it } from "vitest";
import { convertScene } from "../src/shared/plan/convert";
import { SCENE_LABELS, sceneName } from "../src/shared/plan/describe";
import { SCENE_PROPS, VideoPlan, type Scene } from "../src/shared/plan/schema";
import { computeTimeline } from "../src/shared/plan/timing";
import { PlanSettings } from "../src/shared/planner";
import { AUDIENCES } from "../src/main/planner/audience";
import { contentTypes, PROMO_TYPES, scriptSystem, tidyProps } from "../src/main/planner/script";
import { GALLERY_PLAN, GALLERY_SCENES } from "../video/src/samples/gallery";
import { compactNumber } from "../video/src/scenes/promo-scenes";

const PROMO = ["lowerthird", "device", "chat", "social", "cta", "logo"] as const;

describe("promo and social scenes", () => {
	it("each type has props, a label, a gallery sample and a name", () => {
		const plan = VideoPlan.parse(GALLERY_PLAN);
		for (const t of PROMO) {
			expect(SCENE_PROPS[t]).toBeDefined();
			expect(SCENE_LABELS[t]).toBeTruthy();
			const scene = plan.chapters[0]!.scenes.find((s) => s.type === t)!;
			expect(scene, t).toBeDefined();
			expect(sceneName(scene).length).toBeGreaterThan(0);
		}
	});

	it("items appear one by one with the voice (device items, chat messages, call-to-action points)", () => {
		const plan = VideoPlan.parse({ ...GALLERY_PLAN, chapters: [{ id: "c", title: "c", scenes: GALLERY_SCENES.filter((s) => s.type === "chat" || s.type === "device" || s.type === "cta") }] });
		const t = computeTimeline(plan);
		const reveals = t.scenes.map((s) => s.cues.filter((c) => c.action === "reveal").length);
		expect(reveals).toEqual([3, 4, 2]);
	});

	it("converts to and from other scene types", () => {
		const plan = VideoPlan.parse(GALLERY_PLAN);
		const scenes = plan.chapters[0]!.scenes;
		const bullets = scenes.find((s) => s.type === "bullets")!;
		for (const t of PROMO) {
			const as = convertScene(bullets, t);
			expect(as.type).toBe(t);
			expect(SCENE_PROPS[t].safeParse(as.props).success).toBe(true);
			const back = convertScene(as, "bullets");
			expect(back.type).toBe("bullets");
		}
		const chat = convertScene(bullets as Scene, "chat");
		expect(chat.type === "chat" && chat.props.messages.length).toBeGreaterThan(1);
	});

	it("offers the ad types only in launch and promo videos; phone and chat in every video", () => {
		const a = AUDIENCES["High school"];
		const explainer = contentTypes(a, [], "explainer");
		for (const t of PROMO_TYPES) expect(explainer).not.toContain(t);
		expect(explainer).toContain("device");
		expect(explainer).toContain("chat");
		for (const kind of ["launch", "promo"] as const) for (const t of PROMO) expect(contentTypes(a, [], kind)).toContain(t);
		expect(scriptSystem(PlanSettings.parse({ level: "High school", videoType: "promo" }))).toMatch(/- cta \(Call to action\)/);
		expect(scriptSystem(PlanSettings.parse({ level: "High school" }))).not.toMatch(/- cta \(/);
		// Young viewers do not get them.
		expect(contentTypes(AUDIENCES.Kindergarten, [], "promo")).not.toContain("cta");
	});

	it("turns a figure id into its file name for the phone and the logo", () => {
		const figures = [{ id: "f1", file: "in1-001.png", caption: "Logo", kind: "figure" }] as unknown as Parameters<typeof tidyProps>[2];
		expect(tidyProps("logo", { name: "X", figure: "f1" }, figures).figure).toBe("in1-001.png");
		expect(tidyProps("device", { figure: "f1" }, figures).figure).toBe("in1-001.png");
	});

	it("writes counts short", () => {
		expect(compactNumber(860)).toBe("860");
		expect(compactNumber(12400)).toBe("12K");
		expect(compactNumber(1500)).toBe("1.5K");
		expect(compactNumber(2_300_000)).toBe("2.3M");
	});
});
