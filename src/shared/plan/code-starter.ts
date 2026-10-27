/**
 * "AI free-form" style: the working file the AI starts a new design from.
 *
 * It holds only the plumbing every design needs and gets wrong most often:
 * one Sequence per scene, reading the texts of every scene type, reveal times
 * from the voice cues, text that fits the frame, right-to-left text, figures,
 * equations and a hand-over between scenes. Its look is a plain grey
 * placeholder: the prompt tells the AI to replace every design value and
 * layout, so the starter does not push a house style.
 *
 * It must compile, pass the scan and draw without errors (tests/code.test.ts).
 */
export const CODE_STARTER = `// name: Starter
// idea: Placeholder look; replace every design value and layout.
/* SPEC (placeholder: replace all of it)
palette: background #4d4d4d, surface #5c5c5c, text #ffffff, muted #d9d9d9, accent #ffffff
type: title fonts.bold 120px 800, heading 72px 700, body 44px 400, label 30px 600
space: margin 7% of the short side, gap 28px, radius 0
motion: entrances Easing.out(Easing.cubic) over 12 frames, stagger from the voice cues
scene change: 8-frame fade at each end; a slow 3% push-in over each scene, so long holds never freeze
*/
import { AbsoluteFill, Sequence, Img, useCurrentFrame, interpolate, Easing } from "remotion";
import { fonts, fitFontSize, figureUrl, Tex } from "studio";

type Scene = VideoData["scenes"][number];
type Item = { label: string; detail?: string; tex?: string };

// DESIGN: every value here comes from the SPEC. Replace them.
const S = {
  bg: "#4d4d4d", surface: "#5c5c5c", text: "#ffffff", muted: "#d9d9d9", accent: "#ffffff",
  title: { font: fonts.bold, max: 120, weight: 800 },
  heading: { font: fonts.bold, max: 72, weight: 700 },
  body: { font: fonts.modern, max: 44, weight: 400 },
  label: { font: fonts.modern, max: 30, weight: 600 },
  gap: 28, radius: 0, enter: 12, handover: 8,
};

const str = (x: unknown): string => (typeof x === "string" ? x : typeof x === "number" ? String(x) : "");

/** The main line of any scene type. */
function headingOf(scene: Scene): string {
  const p = scene.props;
  return str(p.heading) || str(p.title) || str(p.headline) || str(p.statement) || str(p.name) || str(p.term) || str(p.question) || str(p.center) || str(p.idea) || str(p.caption) || str(p.setting);
}

/** The list a scene shows, as label + detail, for any scene type. Index i matches cue target i. */
function itemsOf(scene: Scene): Item[] {
  const p = scene.props;
  const t = scene.type;
  if (t === "title") return [p.subtitle, p.kicker].filter(Boolean).map((s: string) => ({ label: s }));
  if (t === "chapter") return p.goal ? [{ label: p.goal }] : [];
  if (t === "definition") return [{ label: p.definition }, ...(p.example ? [{ label: p.example }] : [])];
  if (t === "quote") return [{ label: p.text, detail: [p.author, p.source].filter(Boolean).join(", ") }];
  if (t === "glossary") return (p.terms ?? []).map((x: any) => ({ label: x.term, detail: x.meaning }));
  if (t === "compare") return [p.left, p.right].map((s: any) => ({ label: s.title, detail: (s.points ?? []).join(" · ") }));
  if (t === "proscons") return [...(p.pros ?? []).map((x: string) => ({ label: "+ " + x })), ...(p.cons ?? []).map((x: string) => ({ label: "- " + x }))];
  if (t === "chart") return (p.data ?? []).map((d: any) => ({ label: d.label, detail: String(d.value) + (p.unit ? " " + p.unit : "") }));
  if (t === "counter") return (p.counters ?? []).map((c: any) => ({ label: c.label, detail: (c.prefix ?? "") + c.value + (c.unit ?? "") }));
  if (t === "equation") return (p.steps ?? []).map((s: any) => ({ label: s.note ?? "", tex: s.tex }));
  if (t === "table") return (p.rows ?? []).map((r: string[]) => ({ label: r.join("  ·  ") }));
  if (t === "timeline") return (p.events ?? []).map((e: any) => ({ label: e.date + "  " + e.label, detail: e.detail }));
  if (t === "map") return (p.pins ?? []).map((x: any) => ({ label: x.label, detail: x.detail }));
  if (t === "analogy") return (p.pairs ?? []).map((x: any) => ({ label: x.idea, detail: x.like }));
  if (t === "dialogue") return (p.lines ?? []).map((l: any) => ({ label: l.text, detail: p.characters?.[l.who]?.name }));
  if (t === "mindmap") return (p.branches ?? []).map((b: any) => ({ label: b.label, detail: (b.children ?? []).join(" · ") }));
  if (t === "venn") return (p.sets ?? []).map((x: any) => ({ label: x.label, detail: (x.items ?? []).join(" · ") }));
  if (t === "pause") return [{ label: p.answer }];
  if (t === "quiz") return (p.questions ?? []).map((q: any) => ({ label: q.question, detail: (q.options ?? []).join(" / ") }));
  if (t === "figure") return (p.callouts ?? []).map((c: any) => ({ label: c.text }));
  if (t === "lowerthird") return [{ label: p.name, detail: p.role }];
  if (t === "device") return (p.items ?? []).map((x: string) => ({ label: x }));
  if (t === "chat") return (p.messages ?? []).map((m: any) => ({ label: m.text, detail: m.from === "me" ? "" : p.title }));
  if (t === "social") return [{ label: p.text, detail: [p.author, p.handle].filter(Boolean).join(" ") }];
  if (t === "cta") return [...(p.points ?? []).map((x: string) => ({ label: x })), { label: p.action, detail: p.detail }];
  if (t === "logo") return p.tagline ? [{ label: p.tagline }] : [];
  const list = p.items ?? p.steps ?? p.lines ?? p.nodes ?? p.functions ?? [];
  return list.map((x: any) => (typeof x === "string" ? { label: x } : { label: str(x.label) || str(x.text) || str(x.expr) || str(x.note), detail: x.detail }));
}

/** The frame (from the scene start) to show item i: its voice cue, else a stagger. */
function revealAt(scene: Scene, i: number): number {
  const cue = scene.cues.find((c) => c.action === "reveal" && c.target === i);
  return cue ? cue.frame : 12 + i * 10;
}

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
// Quick tweaks from the app: entrances run faster or slower (speed), the cue frames stay.
const enterAt = (frame: number, at: number, speed: number) => interpolate(frame, [at, at + S.enter / speed], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });

function SceneView({ scene, video }: { scene: Scene; video: VideoData }) {
  const frame = useCurrentFrame();
  // Quick tweaks the user sets in the app: text size, spacing, motion speed, accent.
  const T = video.tweaks;
  const short = Math.min(video.width, video.height);
  const margin = Math.round(short * 0.07 * T.space);
  const gap = S.gap * T.space;
  const accent = T.accent ?? S.accent;
  // Smallest readable text: 2.4% of the short side (26 px at 1080).
  const minText = Math.ceil(short * 0.024);
  const inner = video.width - margin * 2;
  const heading = headingOf(scene);
  const items = itemsOf(scene);
  const big = scene.type === "title" || scene.type === "chapter" || scene.type === "kinetic";
  const h = big ? S.title : S.heading;
  const hSize = fitFontSize(heading, { maxWidth: inner, max: h.max * T.text, min: 28, fontFamily: h.font, fontWeight: h.weight, lines: 2 });
  // Items share the height left under the heading.
  // The app's captions (when on) cover a band at the bottom: keep content above it.
  const bottom = video.captions.height ? Math.max(margin, video.captions.bottom + video.captions.height + 16) : margin;
  const room = video.height - margin - bottom - (heading ? hSize * 2.4 : 0) - (scene.props.figure ? video.height * 0.5 : 0);
  const bodyMax = Math.max(minText, Math.min(S.body.max * T.text, room / Math.max(1, items.length) / 2.8));
  const fig = scene.props.figure ? figureUrl(scene.props.figure) : undefined;
  // Hand-over: fade in at the start, out at the end; a slow push-in keeps long holds alive.
  const push = 1 + 0.03 * (frame / scene.durationInFrames);
  const fade = interpolate(frame, [0, S.handover / T.speed, scene.durationInFrames - S.handover / T.speed, scene.durationInFrames], [0, 1, 1, 0], clamp);
  return (
    <AbsoluteFill style={{ padding: margin, paddingBottom: bottom, gap, justifyContent: "center", direction: video.rtl ? "rtl" : "ltr", opacity: fade, transform: "scale(" + push + ")" }}>
      {heading ? <div data-id={"s" + scene.index + "-title"} style={{ fontFamily: h.font, fontWeight: h.weight, fontSize: hSize, lineHeight: 1.1, color: S.text, opacity: enterAt(frame, 0, T.speed) }}>{heading}</div> : null}
      {fig ? <Img data-id={"s" + scene.index + "-figure"} src={fig} style={{ maxWidth: inner, maxHeight: video.height * 0.5, objectFit: "contain", opacity: enterAt(frame, 6, T.speed) }} /> : null}
      {items.map((it, i) => {
        const p = enterAt(frame, revealAt(scene, i), T.speed);
        const size = fitFontSize(it.label, { maxWidth: inner, max: bodyMax, min: minText, fontFamily: S.body.font, fontWeight: S.body.weight, lines: 2 });
        return (
          <div key={i} data-id={"s" + scene.index + "-item-" + i} style={{ opacity: p, background: S.surface, borderRadius: S.radius, padding: gap / 2, borderLeft: "6px solid " + accent }}>
            {/* A formula cannot wrap: its size follows its length (about half an em per source character). */}
            {it.tex ? <Tex tex={it.tex} style={{ fontSize: Math.min(bodyMax, (inner * 1.6) / Math.max(10, it.tex.length)), color: S.text }} /> : null}
            {it.label ? <div style={{ fontFamily: S.body.font, fontWeight: S.body.weight, fontSize: size, color: S.text }}>{it.label}</div> : null}
            {it.detail ? <div style={{ fontFamily: S.label.font, fontWeight: S.label.weight, fontSize: Math.max(minText, Math.min(S.label.max * T.text, bodyMax * 0.7)), color: S.muted }}>{it.detail}</div> : null}
          </div>
        );
      })}
    </AbsoluteFill>
  );
}

export default function Video({ video }: { video: VideoData }) {
  return (
    <AbsoluteFill data-id="bg" style={{ background: S.bg }}>
      {video.scenes.map((s) => (
        <Sequence key={s.id} from={s.from} durationInFrames={s.durationInFrames}>
          <SceneView scene={s} video={video} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
}
`;
