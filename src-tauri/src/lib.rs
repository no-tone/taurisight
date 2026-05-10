use anyhow::{anyhow, Context};
use serde::Deserialize;
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

type AnyResult<T> = anyhow::Result<T>;

#[derive(Debug, Deserialize)]
struct TrayProgress {
    active: bool,
    progress: u8,
    label: String,
    dark: bool,
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

    if progress.active {
        let icon = progress_icon(progress.progress, progress.dark);
        tray.set_icon_with_as_template(Some(icon), false)
            .map_err(|error| error.to_string())?;
        tray.set_tooltip(Some(format!(
            "TauriSight - {} {}%",
            progress.label, progress.progress
        )))
        .map_err(|error| error.to_string())?;
    } else {
        let icon = app.default_window_icon().cloned();
        tray.set_icon_with_as_template(icon, true)
            .map_err(|error| error.to_string())?;
        tray.set_tooltip(Some("TauriSight"))
            .map_err(|error| error.to_string())?;
    }

    Ok(())
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

fn progress_icon(progress: u8, dark: bool) -> Image<'static> {
    let size = 32u32;
    let mut image = ::image::load_from_memory(TRAY_ICON_BYTES)
        .map(|image| image.resize_exact(size, size, ::image::imageops::FilterType::Lanczos3))
        .map(|image| image.to_rgba8())
        .unwrap_or_else(|_| ::image::RgbaImage::new(size, size));
    let fill = ((progress.min(100) as u32) * 24 / 100).max(1);
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
        .plugin(tauri_plugin_opener::init())
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

            TrayIconBuilder::with_id(TRAY_ID)
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
            hide_main_window,
            quit_app,
            update_tray_progress
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
