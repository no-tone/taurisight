# TauriSight TensorFlow model

Place one frozen TensorFlow graph here:

- `vision_model.pb`
- or `model.pb`

Optional labels:

- `labels.txt`, one label per line, in output index order.

Current Rust input contract:

- input tensor: `f32`
- shape: `[1, 224, 224, 3]`
- RGB values normalized to `0.0..1.0`
- output: flat `f32` scores, one score per class

If your model uses a different input/output shape, update `INPUT_SIZE` and
`run_tensorflow_model` in `src-tauri/src/lib.rs`.
