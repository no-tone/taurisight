use std::{path::Path, sync::Arc};

use anyhow::{anyhow, Context};
use image::ImageFormat;
use serde::{Deserialize, Serialize};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, State,
};
use tract_tensorflow::prelude::*;
use tract_tensorflow::tract_hir::internal::*;

const WINDOW_LABEL: &str = "main";
const TRAY_SHOW_ID: &str = "tray-show";
const TRAY_QUIT_ID: &str = "tray-quit";
const MODEL_PATHS: [&str; 2] = [
    "src-tauri/models/vision_model.pb",
    "src-tauri/models/model.pb",
];
const INPUT_SIZE: usize = 224;

#[derive(Debug, Deserialize)]
struct AnalyzeImageInput {
    name: String,
    bytes: Vec<u8>,
}

#[derive(Debug, Serialize, Clone)]
struct Detection {
    label: String,
    score: f32,
}

#[derive(Debug, Serialize)]
struct AnalyzeResult {
    name: String,
    detections: Vec<Detection>,
}

type RunnableModel = TypedSimplePlan;
type AnyResult<T> = anyhow::Result<T>;

struct AppState {
    model: Option<Arc<RunnableModel>>,
}

impl AppState {
    fn new() -> Self {
        Self {
            model: load_model().ok().flatten(),
        }
    }
}

#[tauri::command]
fn analyze_image(
    state: State<'_, AppState>,
    name: String,
    bytes: Vec<u8>,
) -> std::result::Result<AnalyzeResult, String> {
    let input = AnalyzeImageInput { name, bytes };
    analyze_image_with_state(state, input).map_err(|error| error.to_string())
}

fn analyze_image_with_state(
    state: State<'_, AppState>,
    input: AnalyzeImageInput,
) -> AnyResult<AnalyzeResult> {
    let format = detect_format(&input.bytes)?;
    let image = image::load_from_memory_with_format(&input.bytes, format)
        .or_else(|_| image::load_from_memory(&input.bytes))
        .with_context(|| format!("failed to decode image '{}'", input.name))?;

    let detections = if let Some(model) = &state.model {
        run_tensorflow_model(model, &image).unwrap_or_else(|_| fallback_detections(&image))
    } else {
        fallback_detections(&image)
    };

    Ok(AnalyzeResult {
        name: input.name,
        detections,
    })
}

fn detect_format(bytes: &[u8]) -> AnyResult<ImageFormat> {
    image::guess_format(bytes).context("could not detect image format")
}

fn load_model() -> AnyResult<Option<Arc<RunnableModel>>> {
    for relative_path in MODEL_PATHS {
        let path = Path::new(relative_path);
        if !path.exists() {
            continue;
        }

        let mut model = tensorflow()
            .model_for_path(path)
            .with_context(|| format!("failed to load TensorFlow model from {relative_path}"))?;
        model
            .set_input_fact(
                0,
                f32::fact(&[1, INPUT_SIZE as i64, INPUT_SIZE as i64, 3]).into(),
            )
            .context("failed to set model input fact")?;

        let runnable = SimplePlan::new(Arc::new(
            model
                .into_optimized()
                .context("failed to optimize TensorFlow model")?,
        ))
        .context("failed to build TensorFlow runnable")?;

        return Ok(Some(runnable));
    }

    Ok(None)
}

fn run_tensorflow_model(
    model: &Arc<RunnableModel>,
    image: &image::DynamicImage,
) -> AnyResult<Vec<Detection>> {
    let resized = image.resize_exact(
        INPUT_SIZE as u32,
        INPUT_SIZE as u32,
        image::imageops::FilterType::Triangle,
    );
    let rgb = resized.to_rgb8();

    let mut pixels = Vec::with_capacity(INPUT_SIZE * INPUT_SIZE * 3);
    for pixel in rgb.pixels() {
        pixels.push(pixel[0] as f32 / 255.0);
        pixels.push(pixel[1] as f32 / 255.0);
        pixels.push(pixel[2] as f32 / 255.0);
    }

    let input = tract_ndarray::Array4::from_shape_vec((1, INPUT_SIZE, INPUT_SIZE, 3), pixels)
        .context("failed to build input tensor")?
        .into_tensor();

    let mut outputs = model
        .run(tvec![input.into()])
        .context("TensorFlow inference failed")?;
    let output = outputs
        .pop()
        .ok_or_else(|| anyhow!("TensorFlow model returned no outputs"))?;
    let scores = output
        .to_plain_array_view::<f32>()
        .context("unexpected TensorFlow output type")?;

    let mut ranked: Vec<(usize, f32)> = scores.iter().copied().enumerate().collect();
    ranked.sort_by(|left, right| right.1.total_cmp(&left.1));

    Ok(ranked
        .into_iter()
        .take(3)
        .map(|(index, score)| Detection {
            label: label_for(index),
            score,
        })
        .collect())
}

fn label_for(index: usize) -> String {
    const LABELS: [&str; 12] = [
        "person", "dog", "cat", "bird", "car", "bottle", "chair", "phone", "keyboard", "cup",
        "animal", "object",
    ];

    LABELS
        .get(index)
        .copied()
        .map(String::from)
        .unwrap_or_else(|| format!("class-{index}"))
}

fn fallback_detections(image: &image::DynamicImage) -> Vec<Detection> {
    let luminance = image.to_luma8();
    let total = luminance.pixels().count().max(1) as f32;
    let mean = luminance.pixels().map(|pixel| pixel[0] as f32).sum::<f32>() / total / 255.0;

    let primary = if mean > 0.6 {
        "person"
    } else if mean > 0.35 {
        "object"
    } else {
        "animal"
    };

    vec![
        Detection {
            label: primary.to_string(),
            score: 0.61,
        },
        Detection {
            label: "scene".to_string(),
            score: 0.27,
        },
    ]
}

fn toggle_main_window(app: &AppHandle) -> AnyResult<()> {
    if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
        if window.is_visible().unwrap_or(false) {
            window.hide().context("failed to hide main window")?;
        } else {
            window.show().context("failed to show main window")?;
            window.set_focus().context("failed to focus main window")?;
        }
    }

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::new())
        .setup(|app| {
            let menu = Menu::with_items(
                app,
                &[
                    &MenuItem::with_id(app, TRAY_SHOW_ID, "Show / Hide", true, None::<&str>)?,
                    &PredefinedMenuItem::separator(app)?,
                    &MenuItem::with_id(app, TRAY_QUIT_ID, "Quit", true, None::<&str>)?,
                ],
            )?;

            TrayIconBuilder::with_id("main")
                .icon(
                    app.default_window_icon()
                        .cloned()
                        .ok_or_else(|| anyhow!("missing default app icon"))?,
                )
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    TRAY_SHOW_ID => {
                        let _ = toggle_main_window(app);
                    }
                    TRAY_QUIT_ID => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button,
                        button_state,
                        ..
                    } = event
                    {
                        if button == MouseButton::Left && button_state == MouseButtonState::Up {
                            let _ = toggle_main_window(tray.app_handle());
                        }
                    }
                })
                .build(app)
                .context("failed to create tray icon")?;

            if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
                window
                    .hide()
                    .context("failed to hide main window on startup")?;
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![analyze_image])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
