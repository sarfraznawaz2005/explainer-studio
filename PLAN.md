# Explainer Studio — Plan

Desktop app (Windows first) that turns any learning material into a long-form,
YouTube-ready explainer video. Kindergarten to PhD. Rendered with Remotion.

Working name: **Explainer Studio**. (Easy to rename.)

---

## 1. What the user does

1. **New Video** → drop files (PDF, DOCX, DOC, HTML, MD, TXT, images) and/or type text.
2. Pick **audience level** (KG · Primary · Middle · High · College · University · PhD · Custom), **language**, **tone**, optional **target length** ("as long as needed" is the default), **voice**, **visual style** (or "let AI decide").
3. App reads the material and shows an **outline** (chapters + learning goals + estimated length). User edits or approves.
4. App writes the **script and scene plan** per chapter. User sees a **live preview** (Remotion Player) and can edit any scene: narration text, scene type, visuals, music, SFX. Regenerate one scene or one chapter.
5. **Render** → MP4 + thumbnail + captions (SRT) + YouTube pack (title, description with chapters and credits, tags).
6. Video lands in **Library**. Unfinished work stays in **Drafts**.

## 2. Screens

| Screen | Purpose |
|---|---|
| **Home / Dashboard** | Recent drafts, recent renders, render queue status, quick "New Video". |
| **New Video (wizard)** | Inputs → settings → outline review. |
| **Studio (draft editor)** | Left: chapter/scene list. Center: Remotion Player preview. Right: inspector (narration, scene props, timing, audio). Bottom: timeline with voice, music, SFX tracks. |
| **Library** | Finished videos: grid/list, search, filter by level/topic/date. Play, open folder, copy YouTube pack, re-render, duplicate as draft, delete. |
| **Drafts** | All drafts with stage badge (Outline · Script · Voice · Ready to render · Failed). Resume anywhere. |
| **Assets** | Music, SFX, voices, fonts, brand images. Play preview, tags (mood, energy, BPM), license shown per item, import files, online search (Freesound), favourites. |
| **Render Queue** | Background jobs, progress, ETA, cancel (confirm), logs. |
| **Brand Kit** | Channel name, logo/watermark, colours, fonts, intro/outro, default end-screen. Applied to every video. |
| **Settings** | AI providers & model slots, voice defaults, render defaults (resolution, fps, quality), output folder, Python environment status/repair, theme, storage usage & cleanup, about/licenses. |

## 3. UI quality bar

- Modern, calm, professional. Reference feel: Linear / Raycast / Arc.
- **Design system**: Tailwind v4 + shadcn/ui-style components on Radix primitives (accessible dialogs, menus, tooltips), lucide icons, Framer Motion for small transitions. Inter / Geist font, bundled locally.
- **Themes**: Light, Dark, System. All colours via CSS variables (design tokens). Checked for contrast (WCAG AA).
- Custom frameless title bar, sidebar navigation, command palette (Ctrl+K), keyboard shortcuts, toasts, skeleton loaders, empty states with a clear next action.
- **Confirmation dialogs** for anything destructive or costly: delete video/draft/asset, overwrite file, cancel render, discard edits, start a run that will cost money (shows estimate), reset settings. Type-to-confirm for bulk delete.
- Undo for scene edits. Autosave drafts.
- Responsive down to 1100 px wide. High-DPI safe.

## 4. Architecture

```
Electron main (Node, TypeScript)
 ├─ ai/          provider layer ported from Igent (Vercel AI SDK)
 ├─ ingest/      file → clean text + images
 ├─ planner/     outline → script → scene plan (zod-validated JSON)
 ├─ voice/       talks to Python sidecar (TTS)
 ├─ audio/       asset library, music pick, SFX cues, ducking plan
 ├─ render/      Remotion bundle + renderMedia in a utility process
 ├─ youtube/     title, description, chapters, tags, SRT, thumbnail
 ├─ db/          SQLite (better-sqlite3 + drizzle)
 ├─ jobs/        queue, progress events, resume after crash
 └─ security/    IPC validation, path guards, keystore
Renderer (React 19 + Vite + TanStack Router + Zustand)
 └─ screens above + @remotion/player for live preview
video/ (Remotion project, shared with renderer for preview)
 ├─ scenes/      scene library (React components)
 ├─ styles/      visual themes
 └─ Root.tsx     one composition driven by the VideoPlan JSON
python/ (sidecar, own venv inside app data)
 ├─ tts.py       Kokoro TTS
 ├─ ocr.py       local OCR fallback
 └─ pdf.py       page render / image extract
```

Same base stack as Igent (electron-vite, React 19, Tailwind 4, TanStack Router, Zustand, drizzle, vitest), so code and habits carry over.

## 5. AI layer

- **Port Igent's `src/main/providers/`** as-is in spirit: OpenCode (free), Anthropic API, Claude subscription (Agent SDK), OpenRouter, OpenAI, Google, Groq, DeepSeek, xAI, Ollama, Z.ai, custom OpenAI-compatible. Same adapter interface, test-connection, model list, error log.
- **Model slots**: `planner` (strong model: outline + script), `vision` (reads scanned pages and images), `cheap` (tags, titles, small fixes).
- **Structured output**: every AI step returns JSON checked by zod schemas. Invalid output → automatic repair prompt → retry (max 2) → clear error.
- **Long inputs**: chunk the source, summarise per chunk into a knowledge map, then plan from the map. No hard limit on video length.
- **Quality passes** (each a separate call):
  1. *Fact check* — script vs source; flags claims not supported by the source.
  2. *Level check* — vocabulary and sentence length vs chosen level.
  3. *Pacing check* — no scene too dense, no scene too empty.
- **Cost estimate** shown before each run (tokens × model price where known; "free" for OpenCode/Ollama).
- Keys: Electron `safeStorage` (DPAPI). Never sent to renderer, never logged.

> Note from Igent's own code: the **Claude subscription** path is fine for personal use only, and the **OpenCode free tier** relies on a reverse-engineered gate that can break without notice. Keep both, but default to "bring your own API key" if the app is ever distributed.

## 6. Ingestion

| Input | How |
|---|---|
| PDF with text | `pdf-parse` (Node) for text; PyMuPDF for page images and embedded figures. |
| Scanned PDF / images | Page → PNG (PyMuPDF). Read with the **vision model** (best quality). Fallback: local **RapidOCR** (offline). |
| DOCX | `mammoth` → HTML → text + images. |
| DOC (old Word) | Ask LibreOffice if installed (`soffice --convert-to docx`); else show a clear message to save as DOCX. |
| HTML | `cheerio`, strip nav/scripts, keep headings, lists, tables, images. |
| MD / TXT / typed text | Direct. |

Output: one normalised **Source** (sections, headings, text, tables, figures with captions) stored with the draft. Figures from the source can be reused inside scenes.

## 7. The VideoPlan (heart of the app)

One JSON document per draft. Edited by AI and by the user. Rendered by Remotion.

```
VideoPlan
 ├─ meta: title, level, language, style, voice, brand kit, fps, size
 ├─ chapters[]
 │   ├─ title, goal
 │   └─ scenes[]
 │       ├─ type        (from scene library, or "svg-custom")
 │       ├─ props       (zod schema per scene type)
 │       ├─ narration[] (sentences; each gets its own audio file + measured duration)
 │       ├─ cues[]      (visual events tied to sentence index: reveal, highlight, sfx)
 │       └─ transition
 ├─ music[]   (track id, start, end, volume curve; ducked under voice)
 └─ sfx[]     (asset id, time) — mostly derived from cues
```

**Timing**: narration is synthesised **sentence by sentence**. Each sentence's real duration drives when its visual cues fire. Picture and voice stay in sync by design, no guessing.

## 8. Scene library ("not one template")

The AI picks the best scene type for each idea. Each type has many props, so two videos never look the same. Start with ~24 types and grow:

- **Text & structure**: Title card · Chapter card · Kinetic text · Bullet reveal · Definition card · Quote · Summary checklist · Key-term glossary
- **Diagrams**: Flow / process steps · Cycle · Hierarchy / tree · Mind map · Labelled diagram (SVG with callouts) · Venn · Compare two columns · Pros / cons
- **Data & math**: Bar / line / pie chart (animated) · Number counter · Equation derivation (KaTeX, line by line) · Graph plot y=f(x) with moving point
- **Technical**: Code walkthrough (syntax highlight, line focus, variable watch) · Algorithm trace (array boxes, pointers — like the binary search lesson) · Table build-up
- **Story & world**: Timeline · Map with pins · Analogy split-screen · Character dialogue (simple flat characters for KG–Middle) · Source figure (image from the PDF with Ken Burns + callouts)
- **Engagement**: Pause-and-think question (countdown, then answer) · Recap quiz
- **Custom**: `svg-custom` — AI draws an SVG and an animation timeline (keyframes on element ids). **Declarative data only**; sanitised with an allowlist. No AI-written code is ever executed.

**Visual styles** (whole-video look): Clean minimal · Chalkboard · Paper & pencil · Blueprint · Neon dark · Kids cartoon · Academic serif · Brand kit colours. Chosen by AI from topic + level unless the user picks.

Level shapes everything: KG → big shapes, characters, slow pace, 1 idea per scene. PhD → dense diagrams, notation, faster pace, explicit assumptions. (Reuses the audience rules from the explain skill.)

## 9. Voice (local, free)

- **Kokoro TTS via `kokoro-onnx`** (ONNX runtime, CPU, ~350 MB model; no PyTorch). Many voices, good quality, offline.
- App creates its own Python venv in app data on first run (`python -m venv` → `pip install` from pinned versions with hashes). Settings page shows status, size, and a **Repair** button.
- Per-sentence WAV → measured duration → stored in the draft. Cached, so editing one sentence re-voices only that sentence.
- Pronunciation dictionary per draft (e.g. "SQL" → "sequel") and speed control.
- Later (optional plugins): ElevenLabs / OpenAI TTS with API keys.

## 10. Music & sound effects

- **Starter pack downloaded on first run** (with license file per item, checksum-verified):
  - Music: **FreePD.com** (public domain / CC0) — calm, upbeat, curious, dramatic, playful, ambient.
  - SFX: **Kenney.nl audio packs** (CC0) — clicks, pops, whooshes, dings, typing, transitions.
- **Online search**: **Freesound API** (free key in Settings). Filter to CC0 and CC-BY only. Never allow NC (non-commercial) licenses — they break YouTube monetization.
  - *(Correction to my earlier note: Pixabay has no official music API, so it is left out. Users can still import any file they own.)*
- Every asset stores: source URL, author, license, attribution text. **Credits are added to the YouTube description automatically** when a license needs it.
- AI picks music by mood tags per chapter; voice **ducking** (music volume drops under speech); SFX tied to scene cues (reveal → pop, transition → whoosh, correct answer → ding). User can change any pick in the Studio timeline.
- Assets are reused across videos (library, not per-video copies).

## 11. Rendering

- `@remotion/bundler` + `@remotion/renderer` inside an Electron **utility process** (UI never freezes). Remotion downloads its own headless Chrome once.
- 1080p30 default; 720p / 1440p / 4K and 60 fps options. H.264 MP4, AAC audio.
- Long videos render **per chapter** (parallel up to CPU limit) then join with Remotion's ffmpeg. A failed chapter re-renders alone.
- Progress, ETA, cancel (confirm), resume after crash.
- **Outputs per video**: `video.mp4`, `thumbnail.png` (Remotion still, 1280×720, bold title + key visual), `captions.srt`, `youtube.txt` (title, description with chapter timestamps + credits, tags), `plan.json`.
- Optional burned-in captions. Optional brand intro/outro and watermark.

> **Remotion license**: free for individuals and companies of up to 3 people. Larger companies need a Remotion company license. Matters if the app is ever sold.

## 12. Data & storage

- SQLite in app data: drafts, videos, assets, jobs, settings, providers.
- Files: `AppData/ExplainerStudio/{drafts,videos,assets,cache,python,logs}`. Output folder user-selectable.
- Storage page: size per area, clean cache (confirm).
- Backups of the DB on version upgrade (same pattern as Igent).

## 13. Security

- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, strict CSP, no remote content in app windows.
- Typed IPC allowlist via preload; **every IPC payload validated with zod** in main.
- File access only via OS file dialogs or inside the app's own folders; all paths normalised and checked (no path traversal).
- Python and other tools started with `execFile` + fixed argument arrays (never a shell string).
- Downloads: HTTPS only, allowlisted hosts, size limit, checksum when known.
- No AI-generated code is executed. Scene specs are data; custom SVG is sanitised (no scripts, no external refs, no event handlers).
- API keys in `safeStorage`; redacted from logs and error messages.
- External links open in the system browser only after an allowlist check.
- Electron fuses hardened in the packaged build.

## 14. Extra features (my picks for a YouTube creator)

- **Series**: group videos (e.g. "Class 11 CS – Unit 2"), shared style and voice, numbered episodes.
- **Brand kit** (see screens).
- **YouTube pack** with chapters and auto credits (above).
- **Hook generator**: first 15 seconds written to keep viewers watching.
- **A/B thumbnails**: 3 variants per video.
- **Render queue** with Windows notifications when done.
- **Cost & time estimate** before running.
- **Duplicate draft for another level** ("make a KG version of this PhD video").
- **Command palette**, shortcuts, autosave, crash-safe resume.
- Not in v1 (could add later): direct YouTube upload (needs Google OAuth), translations/dubbing, AI-generated images.

## 15. Folder layout

```
explainerskill/
├─ package.json, electron.vite.config.ts, electron-builder.yml, tsconfig.json
├─ src/
│  ├─ main/      (ai, ingest, planner, voice, audio, render, youtube, db, jobs, security, ipc)
│  ├─ preload/
│  ├─ renderer/  (app shell, screens, components/ui, stores, theme)
│  └─ shared/    (zod schemas: VideoPlan, scene props, IPC contracts)
├─ video/        (Remotion: Root, scenes/, styles/, audio/)
├─ python/       (tts.py, ocr.py, pdf.py, requirements.lock)
├─ resources/    (icons, fonts, starter-pack manifest)
├─ tests/        (vitest unit, schema tests, render smoke tests)
└─ PLAN.md
```

## 16. Build order (each step ends with something you can run)

| # | Milestone | You can… |
|---|---|---|
| 1 | App shell: window, sidebar, themes, command palette, dialogs, settings, DB | open the app, switch themes, see empty screens |
| 2 | AI providers (port from Igent) + model slots + test connection | add a provider and test it |
| 3 | Ingestion (all input types, OCR via vision + fallback) | drop a PDF and see the extracted outline source |
| 4 | Python sidecar + Kokoro voice + env repair | hear a voice sample in Settings |
| 5 | VideoPlan schema + first 8 scene types + Remotion preview | see a hand-written plan play in the Studio |
| 6 | Planner: outline → script → scenes + quality passes | turn a PDF into a previewable draft |
| 7 | Asset library + starter pack + Freesound + music/SFX mix | hear music and SFX in preview |
| 8 | Render pipeline + queue + Library + YouTube pack + thumbnail | get a finished MP4 |
| 9 | Remaining scene types + visual styles + Studio editing tools | edit scenes and regenerate parts |
| 10 | Brand kit, series, polish, tests, installer | install it like a real app |

## 17. Testing

- Unit tests (vitest): schemas, planner repair loop, timing maths, license filter, path guards.
- Scene snapshot tests: every scene type renders a still from sample props.
- Smoke render: 20-second sample plan → MP4 on every milestone from 8 on.
- Typecheck + lint on every change. Manual UI check in both themes.
