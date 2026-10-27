import type { CheckResult } from "@shared/code-preview";
import { CODE_IMPORTS, CODE_TYPES, compileCode, extractCode, VideoCode } from "@shared/plan/code";
import { codeVideoData } from "@shared/plan/code-data";
import { CODE_STARTER } from "@shared/plan/code-starter";
import { LOOK_FONTS } from "@shared/plan/look";
import type { VideoPlan } from "@shared/plan/schema";
import { computeTimeline } from "@shared/plan/timing";
import { formatOf, languageLabel } from "@shared/planner";
import type { TextRunResult } from "../ai/providers/types";
import type { Check } from "../ai/structured";
import { writeLog } from "../app/logger";
import type { PlannerAi } from "./ai";
import { FRAME_WORDS } from "./look";
import type { EstimateCall } from "./estimate";
import { tokens } from "./estimate";

/**
 * "AI free-form" style: the AI writes the whole picture of the video as one
 * React (TSX) file. The prompt gives only the technical contract (data, allowed
 * imports, rules the checker enforces); every design choice is the AI's, led by
 * the user's wish. Each reply is compiled, scanned and test-drawn in the
 * sandbox; problems go back to the AI, up to CODE_REPAIRS times.
 */

export const CODE_REPAIRS = 3;
const MAX_OUTPUT = 32_000;
/** Typical size of a reply (tokens), for the estimate. */
const OUTPUT_GUESS = 12_000;

export type CodeBrief = {
	title: string;
	level: string;
	tone: string;
	language: string;
	/** What the user wants, in their words. */
	wish?: string;
	/** Designs this video or the user's last videos had: the new one should differ (unless the wish says otherwise). */
	avoid?: string[];
	/** Redo: the current code, to change as the wish says. */
	current?: string;
	/** Redo: errors the preview saw while playing the current code. */
	seenErrors?: string[];
	/** Redo: the one part the user clicked (its data-id and words). Only that part changes. */
	part?: { id: string; text: string };
};

/** The test draw: draws a "code" plan in the sandbox. */
export type DrawFn = (plan: VideoPlan) => Promise<CheckResult>;

const fontList = Object.entries(LOOK_FONTS)
	.map(([k, f]) => `${k} (${f.label})`)
	.join(", ");

export const CODE_SYSTEM = [
	"You write the complete picture of ONE explainer video as code: a single React (TSX) file that Remotion renders frame by frame.",
	"You decide everything the viewer sees: layout, colour, type, shapes, illustration, backgrounds, motion, transitions and the rhythm of reveals. There is no house style and no template. Follow the user's wishes when they give them.",
	"",
	"THE CONTRACT",
	"- One file. It must have `export default function Video({ video }: { video: VideoData })`. It is drawn for every frame of the video at video.width × video.height pixels and must paint the whole frame, background included.",
	"- The app adds the voice, music and sound effects, and its own brand intro and outro on top. You draw only the picture.",
	"- The types `VideoData` and `SceneData` (below) exist in the file already: use them, do not declare them.",
	"- Scenes: wrap each scene in <Sequence from={scene.from} durationInFrames={scene.durationInFrames}>, so useCurrentFrame() inside is counted from the scene start. Sentence, cue and gap frames are counted from the scene start too.",
	"- Sync: show each idea when the voice says it. Use scene.cues (reveal/focus/highlight item `target` at `frame`) and scene.sentences (when each sentence starts).",
	"- Content: the scene's text, numbers and lists are in scene.props. Read them from the data, never type them into the code: the user edits texts later and scenes can be added. Handle every scene type in the data, plus a sensible general layout for any other type (heading and the texts found in props).",
	"- Text must stay inside the frame and be easy to read at this size, whatever its length: use fitFontSize or wrapping, and keep a safe margin. Narrow frames (vertical 9:16, portrait 4:5, square 1:1) are watched on phones: use big type and few words. In vertical 9:16 frames keep text out of the top 11% and the bottom 17%: the phone app's own bar, buttons and captions cover them. When video.rtl is true, set direction: 'rtl' on text.",
	"- Equations (LaTeX in props) are drawn with <Tex tex={...} style={...} />. Figures: props hold file names; figureUrl(file) gives the URL for <Img src>, or undefined when it cannot be shown (then draw something else).",
	"- Same picture on every draw of a frame: it may depend only on the frame number and the data. Use random(seed) from remotion for randomness. No Math.random, no Date, no timers, no effects.",
	"- Keep frames light: at most a few hundred elements per frame, no loops over huge ranges. Use useMemo for heavy work.",
	"- Write compact code: reusable components and loops over video.scenes, never one hand-written block per scene. Aim for under 700 lines.",
	"",
	"DESIGN FIRST: THE SPEC",
	"Right after the name and idea lines, write a SPEC as one block comment (/* SPEC ... */, at most 25 lines). Turn every adjective into exact values:",
	"- palette: hex colours by role (background, surface, text, muted text, accent, and any others you use);",
	"- type: font key and px size and weight for each text level (title, heading, body, label, numbers);",
	"- space: frame margin, gaps and corner radius in px; the layout grid;",
	"- motion: the easing for entrances, emphasis and exits (Easing.bezier(...) values or spring configs), durations and stagger in frames;",
	"- scene change: how one scene hands over to the next, with its length in frames.",
	"Then write code that follows the SPEC exactly: the code uses these values, not new ones.",
	"",
	"PARTS",
	'Give every main element a short, stable data-id attribute, so the user can click it in the app and ask you to change only that part: the background "bg", and per scene "s{index}-title", "s{index}-item-{i}", "s{index}-figure", plus your own names for other parts. Keep the ids when you change a design.',
	"",
	"QUICK TWEAKS",
	"The user can change a few things in the app without asking you: video.tweaks. Your design must follow them, everywhere:",
	"- every font size × tweaks.text; every margin, padding and gap × tweaks.space;",
	"- every animation length and delay inside a reveal ÷ tweaks.speed (cue and sentence frames stay as they are);",
	"- the main accent colour = tweaks.accent ?? your own accent. Keep text readable on it.",
	"",
	"AVOID THE GENERIC AI LOOK",
	"Unless the user asks for them, do not fall back on these defaults: a dark navy or black void with neon glow; purple-to-blue gradients; frosted glass cards; every element fading in and sliding up the same way; three equal cards in a row; a logo parked in a corner; emoji used as icons; the same layout for every scene type.",
	"Instead pick a clear point of view that fits this topic and audience, and commit to it. Vary entrances, eases and timing with meaning (what matters most moves differently). Let each scene type have a layout that suits its content.",
	"",
	"WHAT YOU CAN USE",
	`- Imports, only these names: ${Object.entries(CODE_IMPORTS)
		.map(([m, names]) => `from "${m}": ${names.join(", ")}`)
		.join("; ")}. JSX works without importing React.`,
	"- \"studio\" module:",
	`  - fonts: font stacks by key: ${fontList}. Other installed Windows fonts may be named too. No web fonts.`,
	"  - fitFontSize(text, { maxWidth, max, min?, fontFamily?, fontWeight?, lines? }): the largest size (≤ max) at which the text fits in maxWidth on that many lines.",
	"  - sceneAt(video, frame): the scene on screen at an absolute frame.",
	"  - figureUrl(file): string | undefined.  Tex({ tex, style }): a LaTeX formula.",
	"- Draw with div, span, svg (all SVG shapes, gradients, filters, masks, paths) and <Img>. Style with inline style={{...}} only (there is no stylesheet, no class names, no <style> tag). CSS gradients, transforms, filters, blend modes, shadows and clip-paths all work.",
	"",
	"REFUSED BY THE CHECKER (the file is rejected): network (fetch and others), window, document, globalThis, eval, Function, timers, storage, Date, Math.random, import() and modules not listed, <iframe>, <script>, <a>, <video>, <audio>, <style>, <link>, <form>, dangerouslySetInnerHTML, property names built from strings (obj['a' + b]), constructor, prototype and __proto__.",
	"Also refused, because they run on the clock and not on the frame: useState and useReducer, CSS transition and animation properties, and SVG <animate>, <animateTransform>, <animateMotion> and <set>. Animate only with interpolate(), spring() and the frame number.",
	"",
	"REPLY FORMAT",
	"One ```tsx code block and nothing else. Its first two lines are comments, then the SPEC:",
	"// name: <the design's name, 2 to 4 words>",
	"// idea: <one sentence: the idea behind the design>",
	"/* SPEC ... */",
	"",
	"THE TYPES",
	CODE_TYPES,
].join("\n");

export function codePrompt(b: CodeBrief, plan: VideoPlan): string {
	const t = computeTimeline(plan);
	const data = codeVideoData(plan, t);
	return [
		`Video: "${b.title}". Audience: ${b.level}. Tone: ${b.tone}. Language of the texts: ${languageLabel(b.language)}${data.rtl ? " (right to left)" : ""}.`,
		`Frame: ${plan.meta.width}×${plan.meta.height}, ${FRAME_WORDS[formatOf(plan.meta)]}; ${t.fps} fps, ${Math.round(t.durationInFrames / t.fps)} seconds, ${data.scenes.length} scenes.`,
		b.wish ? `What the user wants (follow it closely): ${b.wish}` : "The user gave no wishes: design what suits this topic and audience best.",
		b.avoid?.length && !b.current ? `Designs used before (make something clearly different unless the user asks for it):\n${b.avoid.map((a) => `- ${a}`).join("\n")}` : "",
		b.current && b.part
			? `This video already has code (below). The user clicked ONE part of the picture: the element with data-id="${b.part.id}"${b.part.text ? ` (it shows: "${b.part.text}")` : ""}. Change ONLY that part, as the user asks. Every other element, value, layout and animation stays exactly as it is, and every data-id stays. Reply with the complete new file.\n\`\`\`tsx\n${b.current}\n\`\`\``
			: b.current
			? `This video already has code (below). Change it as the user asks; keep what they did not ask to change. Reply with the complete new file.\n\`\`\`tsx\n${b.current}\n\`\`\``
			: `Start from this working file (below). It already does the plumbing right: one Sequence per scene, the texts of every scene type (headingOf, itemsOf), reveal times from the voice cues (revealAt), text that fits, right to left, figures and equations. Keep that plumbing and grow it as you need. Its look is only a grey placeholder: replace all of it (the SPEC, the S values, the layouts, the motion), and give each scene type a layout that suits its content.\n\`\`\`tsx\n${CODE_STARTER}\`\`\``,
		b.seenErrors?.length ? `The preview saw these errors with that code; fix them too:\n${b.seenErrors.map((e) => `- ${e}`).join("\n")}` : "",
		`The data your component gets as \`video\` (JSON):\n${JSON.stringify(data)}`,
	]
		.filter(Boolean)
		.join("\n\n");
}

/** Name and idea from the first comment lines. */
export function codeHeader(source: string): { name: string; idea: string } {
	const name = /^\s*\/\/\s*name:\s*(.+)$/im.exec(source)?.[1]?.trim() ?? "";
	const idea = /^\s*\/\/\s*idea:\s*(.+)$/im.exec(source)?.[1]?.trim() ?? "";
	return { name: name.slice(0, 60) || "AI design", idea: idea.slice(0, 300) };
}

const where = (plan: VideoPlan, i: { frame: number; scene: number }) => {
	if (i.scene < 0) return i.frame >= 0 ? `Frame ${i.frame}` : "The file";
	const s = plan.chapters.flatMap((c) => c.scenes)[i.scene];
	return `Frame ${i.frame} (scene ${i.scene + 1}${s ? `, type "${s.type}"` : ""})`;
};

/**
 * Checks one reply: cut off? compiles and passes the scan? draws without errors?
 * Warnings (text outside the frame, an empty frame) are sent back once; after
 * that they no longer block. When the test draw itself cannot run, the code
 * that compiles is taken (the video still has the per-scene safety net).
 */
export function codeChecker(plan: VideoPlan, draw: DrawFn | null) {
	return async (reply: TextRunResult, attempt: number): Promise<Check<VideoCode>> => {
		if (reply.cutOff) return { ok: false, problems: ["Your reply was cut off at the output limit. Write a shorter file: reusable components and loops over video.scenes, no hand-written block per scene."] };
		const source = extractCode(reply.text);
		const parsed = VideoCode.safeParse({ ...codeHeader(source), source });
		if (!parsed.success) return { ok: false, problems: ["The reply had no usable code. Reply with one ```tsx block."] };
		const compiled = compileCode(source);
		if (!compiled.ok) return { ok: false, problems: compiled.problems };
		if (!draw) return { ok: true, value: parsed.data };
		let r: CheckResult;
		try {
			r = await draw({ ...plan, meta: { ...plan.meta, style: "code", code: parsed.data } });
		} catch (err) {
			writeLog("planner", "warn", "the test draw could not run; the code is taken after the compile check", err);
			return { ok: true, value: parsed.data };
		}
		const errors = r.errors.map((e) => `${where(plan, e)}: ${e.message}`);
		const warnings = attempt === 1 ? r.warnings.map((w) => `${where(plan, w)}: ${w.message}`) : [];
		if (errors.length || warnings.length) return { ok: false, problems: [...errors, ...warnings].slice(0, 20) };
		return { ok: true, value: parsed.data };
	};
}

export const codeRepair = (problems: string[]) =>
	`The test draw of your code found problems:\n${problems.map((p) => `- ${p}`).join("\n")}\n\nFix them and reply with the complete corrected file, in one \`\`\`tsx block, with the name and idea comment lines and the SPEC first.`;

/** Progress of one run: a reply is being checked, or problems go back for a fix. */
export type CodeProgress = (step: "checking" | "fixing", attempt: number, problems?: number) => void;

export async function writeVideoCode(ai: PlannerAi, brief: CodeBrief, plan: VideoPlan, draw: DrawFn | null, onProgress?: CodeProgress): Promise<VideoCode> {
	const check = codeChecker(plan, draw);
	return ai.checked(
		{
			system: CODE_SYSTEM,
			prompt: codePrompt(brief, plan),
			check: async (reply, attempt) => {
				onProgress?.("checking", attempt);
				const c = await check(reply, attempt);
				if (!c.ok && attempt <= CODE_REPAIRS) onProgress?.("fixing", attempt + 1, c.problems.length);
				return c;
			},
			repair: codeRepair,
			maxRepairs: CODE_REPAIRS,
			failure: (tries, problems) => `The AI's video code still had problems after ${tries} tries. First problem: ${problems[0] ?? "unknown"}`,
		},
		{ slot: "planner", purpose: "plan.code", maxOutputTokens: MAX_OUTPUT },
	);
}

/** Cost estimate: one call, plus repair rounds at the high end. Without a plan yet, the data size is guessed from the scene count. */
export function codeCalls(brief: CodeBrief, plan: VideoPlan | null, sceneGuess = 20): EstimateCall[] {
	const prompt = plan ? codePrompt(brief, plan).length : 2_000 + sceneGuess * 1_400 + (brief.current?.length ?? CODE_STARTER.length);
	const input = tokens(CODE_SYSTEM.length + prompt);
	const output = OUTPUT_GUESS;
	const first: EstimateCall = { slot: "planner", input, output };
	// Each repair round sends the whole conversation again, with the last reply.
	const repairs = Array.from({ length: CODE_REPAIRS }, (_, i): EstimateCall => ({ slot: "planner", input: input + (i + 1) * (output + 400), output, extra: true }));
	return [first, ...repairs];
}

/** One line per design, for the avoid list. */
export const codeSummary = (c: VideoCode) => `${c.name}${c.idea ? `: ${c.idea}` : ""}`;
