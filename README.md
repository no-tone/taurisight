<div align="center">

<img src="public/icon.png" alt="TauriSight" width="128"/>

# TauriSight

<p>
  <a href="#what-it-includes">Features</a>
  ·
  <a href="#project-structure">Project Structure</a>
  ·
  <a href="#prerequisites">Installation</a>
  ·
  <a href="#local-run-development">Development</a>
  ·
  <a href="#release">Release</a>
</p>

</div>

---

Tray-first Tauri desktop app for local image object detection with compact native-style React UI.

Uses [TensorFlow.js Coco SSD](https://www.npmjs.com/package/@tensorflow-models/coco-ssd) to detect common COCO objects in uploaded images.

Made by [no-tone](https://no-tone.com).

## What It Includes

### Desktop App Experience

- Tray-only desktop behavior with the main window hidden until the tray icon is clicked.
- Compact dark/light native-style interface for macOS and Windows.
- Latest upload preview in the main tray panel.
- Tauri tray menu with select file, clipboard upload, recent uploads, about, settings, and quit.
- Dynamic tray progress icon using the app icon plus a theme-aware progress bar.

### Media Input & Processing

- Drag-and-drop media dropzone with file picker, clipboard image import, image support, and short MP4/MOV video support.
- Uploading and analyzing states with inline progress in the dropzone.
- TensorFlow.js Coco SSD object detection for 80 common object classes.
- Local image analysis inside the app webview; no custom upload server.
- Annotated image/video export to a user-selected local folder.

### Export & File Management

- Required first-run export folder setting with guarded writes from Rust.
- Recent uploads page with expandable entries, status, confidence scores, dimensions, exported filename, reveal-in-Finder/File Explorer, and removable entries.
- Export existence check, so moved/deleted exports are shown as missing instead of silently failing.

### Settings & Localization

- Settings for preferred video export format and UI language (`en` / `pt`).
- Localized about panel driven by frontend i18n (`src/i18n/*.json`).

### Updates & Releases

- GitHub Actions release workflow for macOS, Windows, and Linux builds.
- Automatic in-app updates via Tauri Updater + GitHub Releases.
- Signed release artifacts with generated `latest.json` metadata.
- Silent update checks on app startup.

### Technical Notes

- Built with Tauri + React + TensorFlow.js.
- Native-style lightweight desktop architecture with local-first processing.

## Project Structure

- `src/App.tsx`: main React UI, file handling, clipboard import, and TensorFlow.js analysis.
- `src/App.css`: compact native-style UI theme and responsive dark/light styling.
- `src/i18n/`: frontend translations for supported UI languages.
- `src-tauri/src/lib.rs`: Tauri tray, window positioning, dock/taskbar behavior, and tray progress icon.
- `src-tauri/tauri.conf.json`: Tauri app, security, window, and bundle configuration.
- `src-tauri/icons/`: app and tray icon assets.
- `.github/workflows/main.yml`: tagged/manual release workflow for GitHub Releases.

## Prerequisites

- **Node.js**: v18+ recommended. Download: https://nodejs.org/

**macOS** (via Homebrew):

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
brew install rust pnpm
```

**Windows** (via Chocolatey or Scoop):

- Chocolatey: https://chocolatey.org/install
  ```bash
  choco install rust pnpm
  ```
- Scoop: https://scoop.sh/
  ```bash
  scoop install rust pnpm
  ```

**Linux or manual install**:

- pnpm: `npm install -g pnpm` or https://pnpm.io/installation
- Rust: https://www.rust-lang.org/tools/install (run `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`)

Note: On Windows ensure MSVC toolchain available if building native bundles.

## Local Run (development)

1. Install dependencies:

```bash
pnpm install
```

2. Start dev app (hot reload):

```bash
pnpm tauri dev
```

3. If you prefer a local desktop build instead of running the dev server, create a distributable:

```bash
pnpm tauri build
```

Use `pnpm tauri build` when you want a production binary without running the dev server each time.

## Release

Automatic GitHub releases run when a version tag is pushed.

```bash
git tag v0.3.7
git push origin v0.3.7
```

The workflow can also be started manually from GitHub Actions with `workflow_dispatch`.

## Installing from GitHub release (macOS / Windows notes)

- **macOS**: Gatekeeper may block first-run for unsigned apps. If the app is blocked:
  - Open `System Settings` → `Privacy & Security`.
  - Look for a message about the blocked app and click `Open Anyway` (or right-click the app → `Open`).

  This may be necessary after downloading from GitHub Releases on first run.

- **Windows**: SmartScreen or Defender may warn on first-run of an unsigned app.
  - If blocked by SmartScreen, choose `More info` → `Run anyway`.
  - To permanently unblock a downloaded installer/executable: right-click the file → `Properties` → check `Unblock` → `OK`.

Note: signed/notarized builds avoid these prompts; release artifacts here are unsigned unless you configure signing.

## Notes

- The first analysis downloads and loads the Coco SSD model, so it can take longer than later runs.
- Video export uses browser `MediaRecorder`; output is WebM for broad local browser support.
- Long videos are capped for safe local processing.
- Image files are decoded locally in the Tauri webview and are not sent to a project backend.
- Coco SSD model assets are fetched from TensorFlow-hosted storage at runtime.
- Clipboard image import depends on operating system and webview permissions.
- Release builds are unsigned unless signing and notarization are configured separately.
