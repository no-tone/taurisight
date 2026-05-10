# Tauri + React + Typescript

This template should help get you started developing with Tauri, React and Typescript in Vite.

## TauriSight

Tray-style image analysis shell for TensorFlow.js object detection.

The app uses Coco SSD (`@tensorflow-models/coco-ssd`) in the React webview. Images stay local in the app process; Rust handles tray/window behavior only.

Main window starts hidden, lives in tray, and opens on tray click. First analysis loads the TensorFlow.js model, later analyses reuse it.

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
