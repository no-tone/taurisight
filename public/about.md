## Resumé

Local tray utility for image object detection.

Made by [no-tone](https://no-tone.com).

## Model

TauriSight uses TensorFlow.js with Coco SSD (`@tensorflow-models/coco-ssd`).
Coco SSD detects common COCO objects such as people, animals, vehicles, bottles, chairs, phones, cups, and keyboards.

Images stay inside the app window. Detection runs in the webview through TensorFlow.js; Rust only handles tray/window behavior.

## Workflow

- Drag image files into the dropzone.
- Use Select file (`Cmd/Ctrl+O`) for a file picker.
- Use Upload from clipboard (`Cmd/Ctrl+Shift+V`) for copied images.
- Open Recent uploads (`Cmd/Ctrl+Y`) to inspect detections.

## Notes

The first detection may take longer while TensorFlow.js downloads and initializes Coco SSD. After that, detections reuse the loaded model.
