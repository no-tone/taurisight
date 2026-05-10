# TauriSight

TauriSight is a tray-first Tauri desktop app for local image object detection with a compact native-style React interface.

It uses [TensorFlow.js Coco SSD](https://www.npmjs.com/package/@tensorflow-models/coco-ssd) to detect common COCO objects in uploaded images.

Made by [no-tone](https://no-tone.com).

## What It Includes

- Tray-only desktop behavior with the main window hidden until the tray icon is clicked.
- Compact dark/light native-style interface for macOS and Windows.
- Drag-and-drop image dropzone with file picker and clipboard image import.
- Uploading and analyzing states with inline progress in the dropzone.
- TensorFlow.js Coco SSD object detection for 80 common object classes.
- Local image analysis inside the app webview; no custom upload server.
- Recent uploads page with status, confidence scores, dimensions, and removable entries.
- Latest upload preview in the main tray panel.
- Tauri tray menu with select file, clipboard upload, recent uploads, about, settings placeholder, and quit.
- Dynamic tray progress icon using the app icon plus a theme-aware progress bar.
- Markdown-driven about panel loaded from `public/about.md`.
- GitHub Actions release workflow for macOS, Windows, and Linux builds.

## Project Structure

- `src/App.tsx`: main React UI, file handling, clipboard import, and TensorFlow.js analysis.
- `src/App.css`: compact native-style UI theme and responsive dark/light styling.
- `public/about.md`: Markdown content shown in the in-app About panel.
- `src-tauri/src/lib.rs`: Tauri tray, window positioning, dock/taskbar behavior, and tray progress icon.
- `src-tauri/tauri.conf.json`: Tauri app, security, window, and bundle configuration.
- `src-tauri/icons/`: app and tray icon assets.
- `.github/workflows/main.yml`: tagged/manual release workflow for GitHub Releases.

## Local Run

1. Install dependencies.

```bash
pnpm install
```

2. Start the Tauri dev app.

```bash
pnpm tauri dev
```

3. Build the desktop app locally.

```bash
pnpm tauri build
```

## Release

Automatic GitHub releases run when a version tag is pushed.

```bash
git tag v0.2.0
git push origin v0.2.0
```

The workflow can also be started manually from GitHub Actions with `workflow_dispatch`.

## Notes

- The first analysis downloads and loads the Coco SSD model, so it can take longer than later runs.
- Image files are decoded locally in the Tauri webview and are not sent to a project backend.
- Coco SSD model assets are fetched from TensorFlow-hosted storage at runtime.
- Clipboard image import depends on operating system and webview permissions.
- Release builds are unsigned unless signing and notarization are configured separately.
