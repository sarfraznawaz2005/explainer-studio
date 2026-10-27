import { describe, expect, it } from "vitest";
import { contrast, DEFAULT_LOOK, fixLook, LookRecipe, type LookRecipeInput } from "@shared/plan/look";
import { VideoPlan } from "@shared/plan/schema";
import { PlanSettings } from "@shared/planner";
import { jsonInstructions } from "../src/main/ai/structured";
import { plannerAiFromRunner } from "../src/main/planner/ai";
import { avoidList, designLook, lookCalls, lookPrompt, LOOK_SYSTEM } from "../src/main/planner/look";
import { AiOutline } from "../src/main/planner/outline";
import { lookStyle, styleFor, STYLES } from "../video/src/styles/styles";

const recipe = (over: Partial<LookRecipeInput> = {}): LookRecipe => LookRecipe.parse({ ...DEFAULT_LOOK, ...over });

/** Small fixed "random" numbers, so the test is the same every run. */
const rand = (seed: number) => () => {
	seed = (seed * 16807) % 2147483647;
	return seed / 2147483647;
};
const hex = (r: () => number) => `#${Array.from({ length: 3 }, () => Math.floor(r() * 256).toString(16).padStart(2, "0")).join("")}`;

describe("AI look recipes", () => {
	it("are forgiving: unknown fonts, kinds and numbers fall back; colours without # are fixed", () => {
		const r = LookRecipe.parse({
			...DEFAULT_LOOK,
			name: "",
			headingFont: "Papyrus",
			corners: 400,
			background: { kind: "lava", strength: 2 },
			motion: { enter: "explode", bounce: "soft", speed: "normal" },
			colors: { ...DEFAULT_LOOK.colors, accent: "FF0000", background2: "nope" },
		});
		expect(r).toMatchObject({ name: "AI look", headingFont: "modern", corners: 16, background: { kind: "plain" }, motion: { enter: "rise" } });
		expect(r.colors.accent).toBe("#ff0000");
		expect(r.colors.background2).toBeUndefined();
		// A colour that is not a colour at all is a real mistake: the AI gets a repair turn.
		expect(LookRecipe.safeParse({ ...DEFAULT_LOOK, colors: { ...DEFAULT_LOOK.colors, text: "red" } }).success).toBe(false);
	});

	it("are always readable after fixLook, whatever colours the AI picks", () => {
		const r = rand(7);
		for (let i = 0; i < 300; i++) {
			const look = recipe({
				colors: { background: hex(r), surface: hex(r), text: hex(r), muted: hex(r), accent: hex(r), accent2: hex(r), accent3: hex(r), positive: hex(r) },
				surfaceOpacity: r(),
			});
			const f = fixLook(look);
			const c = f.colors;
			for (const bg of [c.background]) {
				expect(contrast(c.text, bg), `text ${c.text} on ${bg}`).toBeGreaterThanOrEqual(7);
				expect(contrast(c.muted, bg)).toBeGreaterThanOrEqual(4.5);
				for (const a of [c.accent, c.accent2, c.accent3, c.positive]) expect(contrast(a, bg)).toBeGreaterThanOrEqual(3);
			}
			// Solid cards: text reads on them too.
			if (look.surfaceOpacity >= 0.999) expect(contrast(c.text, c.surface)).toBeGreaterThanOrEqual(7);
			expect(Math.max(contrast(f.onAccent, c.accent), 0)).toBeGreaterThanOrEqual(3);
		}
	});

	it("drop effects that fight: glow on light backgrounds, blur entry with a texture", () => {
		const light = fixLook(recipe({ glow: true, shadow: "glow", texture: "chalk", motion: { enter: "blur", bounce: "soft", speed: "fast" } }));
		expect(light).toMatchObject({ dark: false, glow: false, shadow: "soft", hand: true, motion: { enter: "fade" } });
		const dark = fixLook(recipe({ glow: true, shadow: "glow", colors: { ...DEFAULT_LOOK.colors, background: "#05050f", surface: "#10102a", text: "#ffffff" } }));
		expect(dark).toMatchObject({ dark: true, glow: true, shadow: "glow" });
	});

	it("turn into a full video style with its own motion", () => {
		const s = lookStyle(recipe({ headingFont: "elegant", motion: { enter: "pop", bounce: "lively", speed: "fast" } }));
		expect(s).toMatchObject({ id: "free", name: "Warm studio", motion: { enter: "pop", damping: 10, speed: 1.45 } });
		expect(s.headingFont).toMatch(/Palatino/);
		// "free" without a recipe uses the default look; the fixed styles keep the soft rise they always had.
		expect(styleFor("free").name).toBe("Warm studio");
		expect(styleFor("free", undefined, recipe({ name: "Night sky" })).name).toBe("Night sky");
		expect(STYLES.clean.motion).toEqual({ enter: "rise", damping: 18, mass: 0.7, speed: 1, dist: 1 });
	});

	it("are stored in the plan, and only with the user's own pick (the outline AI never picks free)", () => {
		const plan = VideoPlan.parse({
			version: 1,
			meta: { title: "Saturn", level: "Teens", style: "free", look: DEFAULT_LOOK },
			chapters: [{ id: "c1", title: "Rings", scenes: [{ id: "s1", type: "title", props: { title: "Saturn" }, narration: [{ id: "n1", text: "Saturn has rings." }] }] }],
		});
		expect(plan.meta.look?.name).toBe("Warm studio");
		expect(AiOutline.shape.style.safeParse("free").success).toBe(false);
		expect(PlanSettings.parse({ level: "High school", style: "free" }).style).toBe("free");
	});
});

describe("designing a look", () => {
	it("asks the AI with the topic, frame and the looks to avoid, and returns a checked recipe", async () => {
		const seen: { system: string; text: string }[] = [];
		const ai = plannerAiFromRunner((slot, purpose) => async (req) => {
			expect([slot, purpose]).toEqual(["planner", "plan.look"]);
			seen.push({ system: req.system, text: req.messages.map((m) => (typeof m.content === "string" ? m.content : "")).join("\n") });
			return { text: JSON.stringify({ ...DEFAULT_LOOK, name: "Night sky", headingFont: "tech" }), usage: { inputTokens: 1, outputTokens: 1 }, finishReason: "stop" } as never;
		});
		const brief = { title: "Saturn", level: "Teens", tone: "Friendly", language: "ur", format: "vertical" as const, avoid: avoidList(DEFAULT_LOOK, ["Old map: #f1e3c0 background"]), wish: "dark and dreamy" };
		const look = await designLook(ai, brief);
		expect(look).toMatchObject({ name: "Night sky", headingFont: "tech" });
		expect(seen[0]!.system).toContain(LOOK_SYSTEM.slice(0, 60));
		expect(seen[0]!.text).toMatch(/vertical 9:16/);
		expect(seen[0]!.text).toMatch(/Warm studio:.*\n- Old map/);
		expect(seen[0]!.text).toMatch(/dark and dreamy/);
		expect(lookPrompt(brief)).toMatch(/Urdu/);
		expect(lookCalls(brief)[0]!.input).toBeGreaterThan(500);
	});

	it("has a JSON schema the model can follow (every menu listed)", () => {
		const json = jsonInstructions(LookRecipe);
		for (const word of ["elegant", "waves", "swing", "lively", "surfaceOpacity"]) expect(json).toContain(word);
	});
});
