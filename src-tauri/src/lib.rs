use std::{fs, path::Path, sync::Arc};

use anyhow::{anyhow, Context};
use image::ImageFormat;
use serde::{Deserialize, Serialize};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, PhysicalPosition, Position, Size, State,
};
use tract_tensorflow::prelude::*;
use tract_tensorflow::tract_hir::internal::*;
#[cfg(target_os = "windows")]
use window_vibrancy::apply_acrylic;
#[cfg(target_os = "macos")]
use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial};

const WINDOW_LABEL: &str = "main";
const TRAY_SHOW_ID: &str = "tray-show";
const TRAY_PICK_ID: &str = "tray-pick";
const TRAY_CLIPBOARD_ID: &str = "tray-clipboard";
const TRAY_RECENT_ID: &str = "tray-recent";
const TRAY_ABOUT_ID: &str = "tray-about";
const TRAY_SETTINGS_ID: &str = "tray-settings";
const TRAY_QUIT_ID: &str = "tray-quit";
const MODEL_PATHS: [&str; 2] = [
    "src-tauri/models/vision_model.pb",
    "src-tauri/models/model.pb",
];
const LABELS_PATH: &str = "src-tauri/models/labels.txt";
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
    engine: String,
    width: u32,
    height: u32,
}

#[derive(Debug, Serialize)]
struct ModelStatus {
    loaded: bool,
    active_path: Option<String>,
    expected_paths: Vec<String>,
    labels_path: String,
}

type RunnableModel = TypedSimplePlan;
type AnyResult<T> = anyhow::Result<T>;

struct AppState {
    model: Option<Arc<RunnableModel>>,
    model_path: Option<String>,
    labels: Arc<Vec<String>>,
}

impl AppState {
    fn new() -> Self {
        let loaded = load_model().ok().flatten();
        let labels = Arc::new(load_labels().unwrap_or_else(|_| default_labels()));

        Self {
            model: loaded.as_ref().map(|(model, _)| Arc::clone(model)),
            model_path: loaded.map(|(_, path)| path),
            labels,
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

#[tauri::command]
fn model_status(state: State<'_, AppState>) -> ModelStatus {
    ModelStatus {
        loaded: state.model.is_some(),
        active_path: state.model_path.clone(),
        expected_paths: MODEL_PATHS.iter().map(|path| path.to_string()).collect(),
        labels_path: LABELS_PATH.to_string(),
    }
}

#[tauri::command]
fn hide_main_window(app: AppHandle) -> std::result::Result<(), String> {
    if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
        window.hide().map_err(|error| error.to_string())?;
    }

    Ok(())
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

fn analyze_image_with_state(
    state: State<'_, AppState>,
    input: AnalyzeImageInput,
) -> AnyResult<AnalyzeResult> {
    let format = detect_format(&input.bytes)?;
    let image = image::load_from_memory_with_format(&input.bytes, format)
        .or_else(|_| image::load_from_memory(&input.bytes))
        .with_context(|| format!("failed to decode image '{}'", input.name))?;

    let (detections, engine) = if let Some(model) = &state.model {
        match run_tensorflow_model(model, &image, &state.labels) {
            Ok(detections) => (detections, "TensorFlow".to_string()),
            Err(_) => (fallback_detections(&image), "Demo fallback".to_string()),
        }
    } else {
        (fallback_detections(&image), "Demo fallback".to_string())
    };

    Ok(AnalyzeResult {
        name: input.name,
        detections,
        engine,
        width: image.width(),
        height: image.height(),
    })
}

fn detect_format(bytes: &[u8]) -> AnyResult<ImageFormat> {
    image::guess_format(bytes).context("could not detect image format")
}

fn load_model() -> AnyResult<Option<(Arc<RunnableModel>, String)>> {
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

        return Ok(Some((runnable, relative_path.to_string())));
    }

    Ok(None)
}

fn load_labels() -> AnyResult<Vec<String>> {
    let contents = fs::read_to_string(LABELS_PATH)
        .with_context(|| format!("failed to read labels from {LABELS_PATH}"))?;
    let labels = contents
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(String::from)
        .collect::<Vec<_>>();

    if labels.is_empty() {
        return Err(anyhow!("labels file is empty"));
    }

    Ok(labels)
}

fn run_tensorflow_model(
    model: &Arc<RunnableModel>,
    image: &image::DynamicImage,
    labels: &[String],
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
            label: label_for(index, labels),
            score,
        })
        .collect())
}

fn label_for(index: usize, labels: &[String]) -> String {
    labels
        .get(index)
        .cloned()
        .unwrap_or_else(|| format!("class-{index}"))
}

fn default_labels() -> Vec<String> {
    [
        "person", "dog", "cat", "bird", "car", "bottle", "chair", "phone", "keyboard", "cup",
        "animal", "object",
    ]
    .into_iter()
    .map(String::from)
    .collect()
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

fn show_main_window(app: &AppHandle, anchor: Option<tauri::Rect>) -> AnyResult<()> {
    if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
        if let Some(rect) = anchor {
            position_window_near_tray(&window, rect)?;
        }

        window.show().context("failed to show main window")?;
        window.set_focus().context("failed to focus main window")?;
    }

    Ok(())
}

fn toggle_main_window(app: &AppHandle, anchor: Option<tauri::Rect>) -> AnyResult<()> {
    if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
        if window.is_visible().unwrap_or(false) {
            window.hide().context("failed to hide main window")?;
        } else {
            show_main_window(app, anchor)?;
        }
    }

    Ok(())
}

fn show_about(app: &AppHandle) {
    let _ = show_main_window(app, None);
    let _ = app.emit("show-about", ());
}

fn emit_to_panel(app: &AppHandle, event: &str) {
    let _ = show_main_window(app, None);
    let _ = app.emit(event, ());
}

fn position_window_near_tray(window: &tauri::WebviewWindow, rect: tauri::Rect) -> AnyResult<()> {
    let size = window.outer_size().context("failed to read window size")?;
    let monitor = window
        .current_monitor()
        .context("failed to read current monitor")?;
    let work_area = monitor.as_ref().map(|monitor| monitor.work_area());

    let scale_factor = monitor
        .as_ref()
        .map(|monitor| monitor.scale_factor())
        .unwrap_or(1.0);
    let (tray_x, tray_y) = position_to_physical(rect.position, scale_factor);
    let (tray_w, tray_h) = size_to_physical(rect.size, scale_factor);
    let window_w = size.width as f64;
    let window_h = size.height as f64;
    let gap = 8.0;

    let min_x = work_area.map(|area| area.position.x as f64).unwrap_or(0.0);
    let min_y = work_area.map(|area| area.position.y as f64).unwrap_or(0.0);
    let max_x = work_area
        .map(|area| (area.position.x + area.size.width as i32) as f64)
        .unwrap_or(tray_x + window_w);
    let max_y = work_area
        .map(|area| (area.position.y + area.size.height as i32) as f64)
        .unwrap_or(tray_y + window_h);

    let x = (tray_x + tray_w / 2.0 - window_w / 2.0).clamp(min_x + gap, max_x - window_w - gap);
    let y = if tray_y > min_y + (max_y - min_y) / 2.0 {
        tray_y - window_h - gap
    } else {
        tray_y + tray_h + gap
    }
    .clamp(min_y + gap, max_y - window_h - gap);

    window
        .set_position(PhysicalPosition::new(x.round() as i32, y.round() as i32))
        .context("failed to position window near tray")?;

    Ok(())
}

fn position_to_physical(position: Position, scale_factor: f64) -> (f64, f64) {
    match position {
        Position::Physical(position) => (position.x as f64, position.y as f64),
        Position::Logical(position) => (position.x * scale_factor, position.y * scale_factor),
    }
}

fn size_to_physical(size: Size, scale_factor: f64) -> (f64, f64) {
    match size {
        Size::Physical(size) => (size.width as f64, size.height as f64),
        Size::Logical(size) => (size.width * scale_factor, size.height * scale_factor),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::new())
        .setup(|app| {
            #[cfg(target_os = "macos")]
            {
                app.handle()
                    .set_activation_policy(tauri::ActivationPolicy::Accessory)
                    .context("failed to set accessory activation policy")?;
                app.handle()
                    .set_dock_visibility(false)
                    .context("failed to hide dock icon")?;
            }

            let menu = Menu::with_items(
                app,
                &[
                    &MenuItem::with_id(app, TRAY_SHOW_ID, "Show / Hide", true, None::<&str>)?,
                    &PredefinedMenuItem::separator(app)?,
                    &MenuItem::with_id(
                        app,
                        TRAY_PICK_ID,
                        "Select file",
                        true,
                        Some("CmdOrCtrl+O"),
                    )?,
                    &MenuItem::with_id(
                        app,
                        TRAY_CLIPBOARD_ID,
                        "Upload from clipboard",
                        true,
                        Some("CmdOrCtrl+Shift+V"),
                    )?,
                    &MenuItem::with_id(
                        app,
                        TRAY_RECENT_ID,
                        "Recent uploads",
                        true,
                        Some("CmdOrCtrl+Y"),
                    )?,
                    &PredefinedMenuItem::separator(app)?,
                    &MenuItem::with_id(app, TRAY_ABOUT_ID, "About TauriSight", true, None::<&str>)?,
                    &MenuItem::with_id(
                        app,
                        "tray-updates",
                        "Check for updates",
                        false,
                        None::<&str>,
                    )?,
                    &PredefinedMenuItem::separator(app)?,
                    &MenuItem::with_id(
                        app,
                        TRAY_SETTINGS_ID,
                        "Settings",
                        false,
                        Some("CmdOrCtrl+,"),
                    )?,
                    &PredefinedMenuItem::separator(app)?,
                    &MenuItem::with_id(app, TRAY_QUIT_ID, "Quit", true, Some("CmdOrCtrl+Q"))?,
                ],
            )?;

            TrayIconBuilder::with_id("main")
                .icon(
                    app.default_window_icon()
                        .cloned()
                        .ok_or_else(|| anyhow!("missing default app icon"))?,
                )
                .icon_as_template(true)
                .tooltip("TauriSight")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    TRAY_SHOW_ID => {
                        let _ = toggle_main_window(app, None);
                    }
                    TRAY_PICK_ID => {
                        emit_to_panel(app, "open-file-picker");
                    }
                    TRAY_CLIPBOARD_ID => {
                        emit_to_panel(app, "upload-from-clipboard");
                    }
                    TRAY_RECENT_ID => {
                        emit_to_panel(app, "show-recent");
                    }
                    TRAY_ABOUT_ID => {
                        show_about(app);
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
                        rect,
                        ..
                    } = event
                    {
                        if button == MouseButton::Left && button_state == MouseButtonState::Up {
                            let _ = toggle_main_window(tray.app_handle(), Some(rect));
                        }
                    }
                })
                .build(app)
                .context("failed to create tray icon")?;

            if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
                #[cfg(target_os = "macos")]
                apply_vibrancy(&window, NSVisualEffectMaterial::HudWindow, None, Some(7.0))
                    .context("failed to apply macOS vibrancy")?;

                #[cfg(target_os = "windows")]
                apply_acrylic(&window, Some((20, 20, 24, 160)))
                    .context("failed to apply Windows acrylic")?;

                window
                    .hide()
                    .context("failed to hide main window on startup")?;
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            analyze_image,
            hide_main_window,
            model_status,
            quit_app
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
