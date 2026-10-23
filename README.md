# Explainer Studio

A Windows desktop app that turns learning material (PDF, Word, web pages, images, pasted text)
into long-form YouTube explainer videos. AI writes the outline and script, Kokoro reads it aloud,
and Remotion renders the video with captions, chapters, thumbnails and the YouTube description.

## Install (users)

1. Run `Explainer Studio-Setup-<version>.exe`. The app installs for your user only (no admin needed).
   The installer is not code-signed yet, so Windows SmartScreen may warn. Choose **More info → Run anyway**.
2. Open the app. Go to **Settings → AI providers** and add a provider. The easiest is **Claude subscription**:
   it uses the Claude Code CLI that you are already logged in to (`claude` on PATH).
   API-key providers (Anthropic, OpenAI, Google, Groq, DeepSeek, xAI, OpenAI-compatible) also work.
3. For narration, go to **Settings → Voice** and install the voice engine (see Python below).
   Without it you can still render silent videos.

The first render downloads Chrome Headless Shell (about 100 MB, one time) into the app's data folder.

### Python (needed for narration and local OCR)

- Install **64-bit Python 3.11, 3.12 or 3.13** from <https://www.python.org/downloads/>.
  In the installer, tick **Add python.exe to PATH**.
- In **Settings → Voice**, press **Install**. The app makes its own virtual environment in its data
  folder and installs the pinned packages from `resources/python/requirements.txt`
  (kokoro-onnx, pypdfium2, rapidocr, opencv-python-headless). Your system Python is not changed.
- The Kokoro v1.0 model files (about 350 MB) download from the kokoro-onnx GitHub release.
  Their SHA-256 hashes are pinned in the app.

### Where your data lives

`%APPDATA%\Explainer Studio` holds the database, drafts, videos, assets, the Python environment,
the render browser and logs. Uninstalling the app does not delete this folder.
**Settings → Storage** shows the size of each part and can clean temporary files.

## Develop

Requirements: Node.js 24+, npm, Windows 10/11 x64. Python as above for voice work.

```sh
npm install
npm run dev          # app with hot reload
npm run typecheck
npm test             # unit tests
npm run test:render  # real Remotion renders: scene snapshots, a 20 s video, brand kit
```

Other suites: `npm run test:voice`, `npm run test:ingest`, `npm run test:planner`
(these need Python, the voice engine, or an AI provider).

### Scripts (double-click on Windows)

| Script | What it does |
| --- | --- |
| `run.bat` | Installs packages on the first run, makes the icons if missing, starts the app with hot reload. |
| `build.bat` | Type-check, tests, then packs the app into `release\win-unpacked\Explainer Studio.exe` (no installer). |
| `create-shortcut.bat` | Adds a Desktop shortcut to the app made by `build.bat`. |
| `installer.bat` | Tests, type-check, then makes `release\ExplainerStudio-Setup-<version>.exe` and `release\ExplainerStudio-<version>-portable.zip`. |
| `release.bat` | Asks for the new version, writes release notes (`release-notes.json`, AI draft from the commits), builds, pushes `main` and the tag, and publishes the files on the GitHub Releases page. Needs the [GitHub CLI](https://cli.github.com) (`gh auth login`). |

`npm run dist` is the command behind `installer.bat`. It runs the typecheck, builds the app,
pre-bundles the Remotion video code (`scripts/bundle-video.mjs` → `out/video-bundle`) and runs electron-builder.
`npm run icon` draws the icons again from the logo (`scripts/make-icon.cjs`).

Build notes (see `electron-builder.yml`):

- App code is in an asar archive. Remotion's ffmpeg and compositor binaries are unpacked
  (`app.asar.unpacked`), because executables cannot run from inside the asar.
- The video bundle and the Python scripts ship in `resources/`.
- Electron fuses are hardened: no `ELECTRON_RUN_AS_NODE`, no `NODE_OPTIONS`, no `--inspect`,
  cookie encryption on, asar integrity check on, app loads only from the asar.
- There is no auto-update feed. Install new versions by hand.

## Licenses

### Remotion

Video rendering uses [Remotion](https://www.remotion.dev). Remotion is **not** MIT. It has its own
[license](https://github.com/remotion-dev/remotion/blob/main/LICENSE.md):

- **Free** for individuals, for-profit companies with **up to 3 employees**, non-profits, and evaluation.
- Larger for-profit companies need a **Company License**: <https://www.remotion.pro/license>.
- You may not sell or relicense a modified copy of Remotion itself.

Check that you are eligible before you use this app commercially.

### Assets in videos

The app only accepts assets with licenses that allow YouTube use:

- **CC0 / public domain**: no credit needed.
- **CC BY 3.0 / 4.0**: allowed. The app adds the required credit to the video description.
- **Your own files**: marked as owned.

The starter pack uses public-domain music from [FreePD](https://freepd.com) (mirror on archive.org)
and CC0 sounds from [Kenney](https://kenney.nl). Freesound search needs your own API key and shows
each sound's license before you add it.

### Other parts

- Electron, React, Tailwind CSS, TanStack Router, zod, Radix UI: MIT.
- Kokoro TTS model and kokoro-onnx: Apache 2.0.
- KaTeX: MIT. pdf.js: Apache 2.0.
- ffmpeg (shipped by Remotion): LGPL/GPL, see the Remotion compositor package.
- Inter and JetBrains Mono fonts: SIL Open Font License.

The app itself is private (`UNLICENSED`).
