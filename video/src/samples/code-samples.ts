/**
 * Hand-written video code, the way the AI is asked to write it. Used by the
 * in-app code test (src/main/dev/code-test.ts),
 * the unit tests and the render test (a real Remotion render of AI-style code).
 */
export const SAMPLE_CODE = `import { AbsoluteFill, Sequence, useCurrentFrame, interpolate, spring, useVideoConfig } from "remotion";
import { fonts, fitFontSize } from "studio";

type Scene = VideoData["scenes"][number];

const PALETTE = ["#ff6b35", "#2ec4b6", "#e71d36", "#ffbf00"];

function textsOf(scene: Scene): string[] {
  const p = scene.props;
  const list = p.items ?? p.steps ?? p.lines ?? p.terms ?? p.events ?? [];
  return list.map((x: any) => (typeof x === "string" ? x : x.text ?? x.title ?? x.term ?? x.label ?? "")).filter(Boolean);
}

function SceneView({ scene, video }: { scene: Scene; video: VideoData }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const heading = scene.props.heading ?? scene.props.title ?? scene.props.text ?? "";
  const items = textsOf(scene);
  const color = PALETTE[scene.index % PALETTE.length];
  const enter = spring({ frame, fps, config: { damping: 12 } });
  const size = fitFontSize(heading, { maxWidth: video.width * 0.8, max: 110, fontFamily: fonts.bold, fontWeight: 900, lines: 2 });
  const sentence = scene.sentences.filter((s) => s.from <= frame).at(-1);
  return (
    <AbsoluteFill style={{ padding: 120, direction: video.rtl ? "rtl" : "ltr", justifyContent: "center", gap: 36 }}>
      <div style={{ width: 240 * enter, height: 18, background: color, transform: "skewX(-20deg)" }} />
      <div style={{ fontFamily: fonts.bold, fontWeight: 900, fontSize: size, color: "#fffdf5", lineHeight: 1.05, transform: \`translateX(\${(1 - enter) * -80}px)\` }}>{heading}</div>
      {items.map((t, i) => {
        const cue = scene.cues.find((c) => c.target === i);
        const at = cue ? cue.frame : 10 + i * 8;
        const p = interpolate(frame, [at, at + 12], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
        return (
          <div key={i} style={{ opacity: p, fontFamily: fonts.modern, fontSize: 48, color: "#fffdf5", display: "flex", gap: 20, alignItems: "center" }}>
            <span style={{ width: 28, height: 28, borderRadius: 999, background: PALETTE[(scene.index + i + 1) % PALETTE.length] }} />
            {t}
          </div>
        );
      })}
      {sentence ? <div style={{ position: "absolute", left: 120, right: 120, bottom: 90, fontFamily: fonts.serif, fontStyle: "italic", fontSize: 34, color: "#b8b2a6" }}>{sentence.text}</div> : null}
    </AbsoluteFill>
  );
}

export default function Video({ video }: { video: VideoData }) {
  const frame = useCurrentFrame();
  const hue = interpolate(frame, [0, video.durationInFrames], [220, 320]);
  const top = 40;
  return (
    <AbsoluteFill style={{ background: \`linear-gradient(135deg, hsl(\${hue} 45% 14%), hsl(\${hue + 40} 50% 8%))\` }}>
      <div style={{ position: "absolute", top, left: 120, fontFamily: fonts.code, fontSize: 24, color: "#8f8aa0" }}>{video.title}</div>
      {video.scenes.map((s) => (
        <Sequence key={s.id} from={s.from} durationInFrames={s.durationInFrames}>
          <SceneView scene={s} video={video} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
}
`;

/** Code that throws in scene 2 only (index 1): the guard must draw the built-in scene there. */
export const CRASH_IN_SCENE_2 = `import { AbsoluteFill, Sequence } from "remotion";
export default function Video({ video }: { video: VideoData }) {
  return (
    <AbsoluteFill style={{ background: "#102030" }}>
      {video.scenes.map((s) => (
        <Sequence key={s.id} from={s.from} durationInFrames={s.durationInFrames}>
          <Part index={s.index} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
}
function Part({ index }: { index: number }) {
  if (index === 1) throw new Error("boom in scene 2");
  return <div style={{ color: "white", fontSize: 80, padding: 100 }}>Scene {index + 1}</div>;
}
`;

/** Code that divides by zero: an SVG gets NaN in its attributes. */
export const NAN_CODE = `import { AbsoluteFill, useCurrentFrame } from "remotion";
export default function Video({ video }: { video: VideoData }) {
  const frame = useCurrentFrame();
  const empty: number[] = [];
  const avg = empty.reduce((a, b) => a + b, 0) / empty.length;
  return (
    <AbsoluteFill style={{ background: "#202020" }}>
      <svg width={800} height={400}><circle cx={avg} cy={200} r={50} fill="orange" /></svg>
      <div style={{ color: "white", fontSize: 60 }}>{video.title} {frame}</div>
    </AbsoluteFill>
  );
}
`;

/** Code with a loop that never ends while drawing: the loop guard stops it. */
export const ENDLESS_CODE = `import { AbsoluteFill } from "remotion";
export default function Video() {
  let n = 0;
  while (n >= 0) n++;
  return <AbsoluteFill style={{ background: "red" }} />;
}
`;

/** Text pushed far outside the frame. */
export const OVERFLOW_CODE = `import { AbsoluteFill } from "remotion";
export default function Video({ video }: { video: VideoData }) {
  return (
    <AbsoluteFill style={{ background: "#0d1b2a" }}>
      <div style={{ position: "absolute", left: video.width - 200, top: 300, fontSize: 90, color: "white", whiteSpace: "nowrap" }}>{video.title}</div>
    </AbsoluteFill>
  );
}
`;

/**
 * Hard-to-read text, one kind per scene, for the test draw's checks:
 * scene 1 overlap, edge and small text; scene 2 cut-off text and low contrast;
 * scene 3 a long sentence that flashes by. Every scene then holds still.
 */
export const LAYOUT_ISSUES_CODE = `import { AbsoluteFill, Sequence, useCurrentFrame } from "remotion";

function Bad({ index }: { index: number }) {
  const frame = useCurrentFrame();
  const k = index % 3;
  if (k === 0)
    return (
      <AbsoluteFill style={{ background: "#ffffff" }}>
        <div style={{ position: "absolute", left: 200, top: 300, fontSize: 60, color: "#000000", whiteSpace: "nowrap" }}>Overlapping words one</div>
        <div style={{ position: "absolute", left: 210, top: 312, fontSize: 60, color: "#000000", whiteSpace: "nowrap" }}>Second line on top</div>
        <div style={{ position: "absolute", left: 2, top: 700, fontSize: 40, color: "#000000" }}>Edge text here</div>
        <div style={{ position: "absolute", left: 600, top: 900, fontSize: 12, color: "#000000" }}>tiny print below</div>
      </AbsoluteFill>
    );
  if (k === 1)
    return (
      <AbsoluteFill style={{ background: "#ffffff" }}>
        <div style={{ position: "absolute", left: 300, top: 300, width: 200, height: 70, overflow: "hidden" }}>
          <div style={{ fontSize: 50, whiteSpace: "nowrap", color: "#000000" }}>This text is cut off by its box</div>
        </div>
        <div style={{ position: "absolute", left: 300, top: 600, fontSize: 60, color: "#eeeeee" }}>Pale text on white</div>
      </AbsoluteFill>
    );
  return (
    <AbsoluteFill style={{ background: "#202020" }}>
      {frame >= 30 && frame < 33 ? <div style={{ position: "absolute", left: 200, top: 400, fontSize: 60, color: "#ffffff" }}>A long sentence that flashes by far too fast to read</div> : null}
    </AbsoluteFill>
  );
}

export default function Video({ video }: { video: VideoData }) {
  return (
    <AbsoluteFill>
      {video.scenes.map((s) => (
        <Sequence key={s.id} from={s.from} durationInFrames={s.durationInFrames}>
          <Bad index={s.index} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
}
`;
