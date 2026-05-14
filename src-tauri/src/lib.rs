use anyhow::{anyhow, Context};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::atomic::{AtomicBool, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{
    image::Image,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, PhysicalPosition, Position, Size,
};
#[cfg(target_os = "windows")]
use window_vibrancy::apply_acrylic;
#[cfg(target_os = "macos")]
use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial};

const WINDOW_LABEL: &str = "main";
const TRAY_ID: &str = "main";
const TRAY_SHOW_ID: &str = "tray-show";
const TRAY_PICK_ID: &str = "tray-pick";
const TRAY_CLIPBOARD_ID: &str = "tray-clipboard";
const TRAY_RECENT_ID: &str = "tray-recent";
const TRAY_ABOUT_ID: &str = "tray-about";
const TRAY_SETTINGS_ID: &str = "tray-settings";
const TRAY_QUIT_ID: &str = "tray-quit";
const TRAY_ICON_BYTES: &[u8] = include_bytes!("../icons/32x32.png");
const SETTINGS_FILE: &str = "settings.json";
const MAX_EXPORT_BYTES: usize = 500 * 1024 * 1024;
static LAST_DARK_THEME: AtomicBool = AtomicBool::new(true);

type AnyResult<T> = anyhow::Result<T>;

#[derive(Debug, Deserialize)]
struct TrayProgress {
    active: bool,
    progress: u8,
    label: String,
    dark: bool,
}

#[derive(Debug, Deserialize, Serialize)]
struct AppSettings {
    export_folder: Option<PathBuf>,
    #[serde(default = "default_video_export")]
    preferred_video_export: String,
    #[serde(default = "default_image_export")]
    preferred_image_export: String,
    #[serde(default = "default_language")]
    language: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            export_folder: None,
            preferred_video_export: default_video_export(),
            preferred_image_export: default_image_export(),
            language: default_language(),
        }
    }
}

#[derive(Debug, Serialize)]
struct SavedExport {
    path: String,
    name: String,
}

#[derive(Debug, Serialize)]
struct ClientSettings {
    export_folder: Option<String>,
    preferred_video_export: String,
    preferred_image_export: String,
    language: String,
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

#[tauri::command]
fn update_tray_progress(app: AppHandle, progress: TrayProgress) -> std::result::Result<(), String> {
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return Ok(());
    };

    LAST_DARK_THEME.store(progress.dark, Ordering::Relaxed);

    let template = cfg!(target_os = "macos");

    let icon = if progress.active {
        progress_icon(Some(progress.progress), progress.dark)
    } else {
        #[cfg(target_os = "macos")]
        {
            app.default_window_icon()
                .cloned()
                .unwrap_or_else(|| progress_icon(None, progress.dark))
        }

        #[cfg(not(target_os = "macos"))]
        {
            progress_icon(None, LAST_DARK_THEME.load(Ordering::Relaxed))
        }
    };

    let tooltip = if progress.active {
        format!("TauriSight - {} {}%", progress.label, progress.progress)
    } else {
        "TauriSight".into()
    };

    tray.set_icon_with_as_template(Some(icon), template)
        .map_err(|error| error.to_string())?;

    tray.set_tooltip(Some(tooltip))
        .map_err(|error| error.to_string())?;

    Ok(())
}

#[tauri::command]
fn get_export_folder(app: AppHandle) -> std::result::Result<Option<String>, String> {
    read_settings(&app)
        .map(|settings| {
            settings
                .export_folder
                .filter(|path| path.is_dir())
                .map(|path| path.to_string_lossy().to_string())
        })
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn get_settings(app: AppHandle) -> std::result::Result<ClientSettings, String> {
    read_settings(&app)
        .map(|settings| ClientSettings {
            export_folder: settings
                .export_folder
                .filter(|path| path.is_dir())
                .map(|path| path.to_string_lossy().to_string()),
            preferred_video_export: safe_video_export(&settings.preferred_video_export)
                .unwrap_or_else(|_| default_video_export()),
            preferred_image_export: safe_image_export(&settings.preferred_image_export)
                .unwrap_or_else(|_| default_image_export()),
            language: safe_language(&settings.language).unwrap_or_else(|_| default_language()),
        })
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn update_preferences(
    app: AppHandle,
    preferred_video_export: String,
    preferred_image_export: String,
    language: String,
) -> std::result::Result<ClientSettings, String> {
    let mut settings = read_settings(&app).map_err(|error| error.to_string())?;
    settings.preferred_video_export = safe_video_export(&preferred_video_export)?;
    settings.preferred_image_export = safe_image_export(&preferred_image_export)?;
    settings.language = safe_language(&language)?;
    write_settings(&app, &settings).map_err(|error| error.to_string())?;
    get_settings(app)
}

#[tauri::command]
fn choose_export_folder(app: AppHandle) -> std::result::Result<Option<String>, String> {
    let Some(folder) = rfd::FileDialog::new()
        .set_title("Choose export folder")
        .pick_folder()
    else {
        return Ok(None);
    };

    if !folder.is_dir() {
        return Err("Selected path is not a folder.".into());
    }

    let mut settings = read_settings(&app).map_err(|error| error.to_string())?;
    settings.export_folder = Some(folder.clone());
    write_settings(&app, &settings).map_err(|error| error.to_string())?;

    Ok(Some(folder.to_string_lossy().to_string()))
}

#[tauri::command]
fn export_file_exists(app: AppHandle, path: String) -> std::result::Result<bool, String> {
    let root = configured_export_folder(&app).map_err(|error| error.to_string())?;
    let root = root.canonicalize().map_err(|error| error.to_string())?;
    let target = PathBuf::from(path);

    if !target.exists() {
        return Ok(false);
    }

    let target = target.canonicalize().map_err(|error| error.to_string())?;
    if !target.starts_with(&root) {
        return Ok(false);
    }

    Ok(target.is_file())
}

#[tauri::command]
fn save_export_file(
    app: AppHandle,
    original_name: String,
    extension: String,
    bytes: Vec<u8>,
) -> std::result::Result<SavedExport, String> {
    if bytes.is_empty() {
        return Err("Export is empty.".into());
    }
    if bytes.len() > MAX_EXPORT_BYTES {
        return Err("Export too large.".into());
    }

    let folder = configured_export_folder(&app).map_err(|error| error.to_string())?;
    let extension = safe_extension(&extension)?;
    let stem = safe_file_stem(&original_name);
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis();
    let name = format!("{stem}_taurisight_{timestamp}.{extension}");
    let path = folder.join(&name);

    fs::write(&path, bytes).map_err(|error| error.to_string())?;

    Ok(SavedExport {
        path: path.to_string_lossy().to_string(),
        name,
    })
}

#[tauri::command]
fn reveal_exported_file(app: AppHandle, path: String) -> std::result::Result<(), String> {
    let root = configured_export_folder(&app).map_err(|error| error.to_string())?;
    let root = root.canonicalize().map_err(|error| error.to_string())?;
    let target = PathBuf::from(path);
    let target = target.canonicalize().map_err(|error| error.to_string())?;

    if !target.starts_with(&root) {
        return Err("Export path is outside configured folder.".into());
    }

    reveal_path(&target).map_err(|error| error.to_string())
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

fn settings_path(app: &AppHandle) -> AnyResult<PathBuf> {
    let dir = app
        .path()
        .app_config_dir()
        .context("failed to resolve app config dir")?;
    fs::create_dir_all(&dir).context("failed to create app config dir")?;
    Ok(dir.join(SETTINGS_FILE))
}

fn read_settings(app: &AppHandle) -> AnyResult<AppSettings> {
    let path = settings_path(app)?;
    if !path.exists() {
        return Ok(AppSettings::default());
    }

    let data = fs::read_to_string(path).context("failed to read settings")?;
    serde_json::from_str(&data).context("failed to parse settings")
}

fn write_settings(app: &AppHandle, settings: &AppSettings) -> AnyResult<()> {
    let path = settings_path(app)?;
    let data = serde_json::to_string_pretty(settings).context("failed to serialize settings")?;
    fs::write(path, data).context("failed to write settings")
}

fn configured_export_folder(app: &AppHandle) -> AnyResult<PathBuf> {
    let settings = read_settings(app)?;
    let folder = settings
        .export_folder
        .ok_or_else(|| anyhow!("Export folder not configured."))?;
    if !folder.is_dir() {
        return Err(anyhow!("Export folder missing."));
    }

    Ok(folder)
}

fn default_video_export() -> String {
    "webm".into()
}

fn default_image_export() -> String {
    "png".into()
}

fn default_language() -> String {
    "en".into()
}

fn safe_video_export(value: &str) -> std::result::Result<String, String> {
    match value.to_lowercase().as_str() {
        "webm" => Ok("webm".into()),
        "mp4" => Ok("mp4".into()),
        "mov" => Ok("mov".into()),
        _ => Err("Unsupported video export type.".into()),
    }
}

fn safe_image_export(value: &str) -> std::result::Result<String, String> {
    match value.to_lowercase().as_str() {
        "png" => Ok("png".into()),
        _ => Err("Unsupported image export type.".into()),
    }
}

fn safe_language(value: &str) -> std::result::Result<String, String> {
    match value.to_lowercase().as_str() {
        "en" => Ok("en".into()),
        "pt" => Ok("pt".into()),
        _ => Err("Unsupported language.".into()),
    }
}

fn safe_extension(extension: &str) -> std::result::Result<&'static str, String> {
    match extension.to_lowercase().as_str() {
        "png" => Ok("png"),
        "webm" => Ok("webm"),
        "mp4" => Ok("mp4"),
        "mov" => Ok("mov"),
        _ => Err("Unsupported export extension.".into()),
    }
}

fn safe_file_stem(name: &str) -> String {
    let stem = Path::new(name)
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("export");
    let mut clean = String::with_capacity(stem.len().min(80));

    for ch in stem.chars().take(80) {
        if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.' | ' ') {
            clean.push(ch);
        } else {
            clean.push('_');
        }
    }

    let clean = clean.trim_matches([' ', '.', '_', '-']);
    if clean.is_empty() {
        "export".into()
    } else {
        clean.into()
    }
}

fn reveal_path(path: &Path) -> AnyResult<()> {
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg("-R")
            .arg(path)
            .spawn()
            .context("failed to reveal export")?;
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(format!("/select,{}", path.display()))
            .spawn()
            .context("failed to reveal export")?;
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let folder = path.parent().unwrap_or(path);
        Command::new("xdg-open")
            .arg(folder)
            .spawn()
            .context("failed to reveal export")?;
    }

    Ok(())
}

fn progress_icon(progress: Option<u8>, dark: bool) -> Image<'static> {
    let size = 32u32;
    let mut image = ::image::load_from_memory(TRAY_ICON_BYTES)
        .map(|image| image.resize_exact(size, size, ::image::imageops::FilterType::Lanczos3))
        .map(|image| image.to_rgba8())
        .unwrap_or_else(|_| ::image::RgbaImage::new(size, size));
    let tint = if dark { [246, 247, 249] } else { [18, 20, 24] };
    let track = if dark {
        [246, 247, 249, 72]
    } else {
        [18, 20, 24, 72]
    };
    let bar = if dark {
        [246, 247, 249, 255]
    } else {
        [18, 20, 24, 255]
    };

    for pixel in image.pixels_mut() {
        if pixel[3] > 0 {
            pixel[0] = tint[0];
            pixel[1] = tint[1];
            pixel[2] = tint[2];
        }
    }

    if let Some(progress) = progress {
        let fill = ((progress.min(100) as u32) * 24 / 100).max(1);

        for y in 27..30 {
            for x in 4..28 {
                image.put_pixel(x, y, ::image::Rgba(track));
            }
        }

        for y in 27..30 {
            for x in 4..(4 + fill) {
                image.put_pixel(x, y, ::image::Rgba(bar));
            }
        }
    }

    Image::new_owned(image.into_raw(), size, size)
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
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
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
                        Some("CmdOrCtrl+V"),
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
                        true,
                        Some("CmdOrCtrl+,"),
                    )?,
                    &PredefinedMenuItem::separator(app)?,
                    &MenuItem::with_id(app, TRAY_QUIT_ID, "Quit", true, Some("CmdOrCtrl+Q"))?,
                ],
            )?;

            TrayIconBuilder::with_id(TRAY_ID)
                .icon(
                    app.default_window_icon()
                        .cloned()
                        .ok_or_else(|| anyhow!("missing default app icon"))?,
                )
                .icon_as_template(cfg!(target_os = "macos"))
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
                    TRAY_SETTINGS_ID => {
                        emit_to_panel(app, "show-settings");
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
            hide_main_window,
            quit_app,
            update_tray_progress,
            get_export_folder,
            get_settings,
            update_preferences,
            choose_export_folder,
            export_file_exists,
            save_export_file,
            reveal_exported_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
