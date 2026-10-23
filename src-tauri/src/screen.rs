//! Screen reading helpers: capture the primary monitor, read text with the
//! Windows OCR engine, and tell whether Destiny 2 is the foreground window.
//! Only the screen is read; nothing touches the game process.
//!
//! The overlay stays visible to screen capture (streams, recordings), so our
//! own widgets would end up in the screenshots too. The overlay reports
//! where its widgets are, and those areas are blacked out before reading.

use std::io::Cursor;
use std::sync::Mutex;

use base64::Engine;
use image::{imageops, RgbaImage};
use serde::{Deserialize, Serialize};

use crate::i18n::tr;

/// The Windows OCR engine rejects larger images.
const OCR_MAX_DIMENSION: u32 = 2400;
/// Width of calibration previews sent to the UI.
const PREVIEW_WIDTH: u32 = 1280;

/// A region of the primary monitor, as fractions (0..1).
#[derive(Clone, Copy, Serialize, Deserialize)]
pub struct Region {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

/// Overlay widget areas in physical pixels of the primary monitor.
#[derive(Clone, Copy, Deserialize)]
pub struct Rect {
    pub(crate) x: f64,
    pub(crate) y: f64,
    pub(crate) w: f64,
    pub(crate) h: f64,
}

static OVERLAY_AREAS: Mutex<Vec<Rect>> = Mutex::new(Vec::new());
/// The overlay window, and whether it shows in captures (the setting).
static OVERLAY_WINDOW: std::sync::atomic::AtomicIsize = std::sync::atomic::AtomicIsize::new(0);
static IN_CAPTURES: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(true);
/// Where weapon names are read (a share of the screen), see `capture_primary`.
static READ_REGION: Mutex<Option<Region>> = Mutex::new(None);

/// Where the weapon name is read: the overlay is kept out of what is read
/// there (see `capture_primary`).
pub fn set_read_region(region: Region) {
    *READ_REGION.lock().unwrap() = Some(region);
}

fn set_affinity(window: isize, in_captures: bool) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{SetWindowDisplayAffinity, WDA_EXCLUDEFROMCAPTURE, WDA_NONE};
    let affinity = if in_captures { WDA_NONE } else { WDA_EXCLUDEFROMCAPTURE };
    unsafe {
        let _ = SetWindowDisplayAffinity(HWND(window as *mut _), affinity);
    }
}

/// The overlay reports where its widgets currently are.
#[tauri::command]
pub fn overlay_set_areas(areas: Vec<Rect>) {
    *OVERLAY_AREAS.lock().unwrap() = areas;
}

/// Show or hide the overlay in screen captures (streams, recordings).
#[tauri::command]
pub fn overlay_set_capture_visible(app: tauri::AppHandle, visible: bool) -> Result<(), String> {
    use tauri::Manager;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{SetWindowDisplayAffinity, WDA_EXCLUDEFROMCAPTURE, WDA_NONE};
    let window = app.get_webview_window("overlay").ok_or("overlay")?;
    let hwnd = window.hwnd().map_err(|e| e.to_string())?;
    OVERLAY_WINDOW.store(hwnd.0 as isize, std::sync::atomic::Ordering::SeqCst);
    IN_CAPTURES.store(visible, std::sync::atomic::Ordering::SeqCst);
    let affinity = if visible { WDA_NONE } else { WDA_EXCLUDEFROMCAPTURE };
    unsafe { SetWindowDisplayAffinity(HWND(hwnd.0), affinity) }.map_err(|e| e.to_string())
}

/// Screenshot of the primary monitor with the overlay's widgets blacked out.
pub fn capture_primary() -> Result<RgbaImage, String> {
    capture_primary_area(None)
}

/// Like `capture_primary`, but only `area` (a share of the screen) is taken
/// from the screen; the rest of the picture stays black. Each capture makes
/// Windows copy the game's frame back from the graphics card, which costs
/// the game frames: the smaller, the cheaper.
pub fn capture_primary_area(area: Option<Region>) -> Result<RgbaImage, String> {
    let monitors = xcap::Monitor::all().map_err(|e| e.to_string())?;
    let monitor = monitors
        .iter()
        .find(|m| m.is_primary().unwrap_or(false))
        .or_else(|| monitors.first())
        .ok_or(tr("Kein Bildschirm gefunden", "No screen found"))?;
    let (mw, mh) = (monitor.width().unwrap_or(1) as f64, monitor.height().unwrap_or(1) as f64);
    // A widget over the name: the game under it is wanted, not the widget.
    // The overlay is taken out of captures for this one picture (and only
    // then: a stream showing it would see it blink otherwise).
    let covered = READ_REGION.lock().unwrap().is_some_and(|r| {
        let (rx0, ry0, rx1, ry1) = (r.x * mw, r.y * mh, (r.x + r.w) * mw, (r.y + r.h) * mh);
        OVERLAY_AREAS.lock().unwrap().iter().any(|a| a.x < rx1 && a.x + a.w > rx0 && a.y < ry1 && a.y + a.h > ry0)
    });
    let window = OVERLAY_WINDOW.load(std::sync::atomic::Ordering::SeqCst);
    let in_captures = IN_CAPTURES.load(std::sync::atomic::Ordering::SeqCst);
    if covered && window != 0 && in_captures {
        set_affinity(window, false);
        // The change shows from the next composited frame on.
        std::thread::sleep(std::time::Duration::from_millis(40));
    }
    let captured = match area {
        None => monitor.capture_image().map_err(|e| e.to_string()),
        Some(a) => {
            let x = (a.x.clamp(0.0, 1.0) * mw) as u32;
            let y = (a.y.clamp(0.0, 1.0) * mh) as u32;
            let w = ((a.w.clamp(0.0, 1.0) * mw) as u32).clamp(1, mw as u32 - x);
            let h = ((a.h.clamp(0.0, 1.0) * mh) as u32).clamp(1, mh as u32 - y);
            monitor.capture_region(x, y, w, h).map_err(|e| e.to_string()).map(|part| {
                // Where it is on the screen: the readers work in screen pixels.
                let mut full = RgbaImage::new(mw as u32, mh as u32);
                image::imageops::replace(&mut full, &part, x as i64, y as i64);
                full
            })
        }
    };
    if covered && window != 0 && in_captures {
        set_affinity(window, true);
    }
    let mut image = captured?;
    // Out of captures (setting, or just now): nothing of it to black out.
    if window != 0 && (covered || !in_captures) {
        return Ok(image);
    }
    let (w, h) = (image.width() as f64, image.height() as f64);
    for r in OVERLAY_AREAS.lock().unwrap().iter() {
        let (x0, y0) = (r.x.clamp(0.0, w) as u32, r.y.clamp(0.0, h) as u32);
        let (x1, y1) = ((r.x + r.w).clamp(0.0, w) as u32, (r.y + r.h).clamp(0.0, h) as u32);
        for y in y0..y1 {
            for x in x0..x1 {
                image.put_pixel(x, y, image::Rgba([0, 0, 0, 255]));
            }
        }
    }
    Ok(image)
}

/// The mouse pointer's position on the screen (physical pixels).
pub fn cursor_pos() -> Option<(i32, i32)> {
    use windows::Win32::Foundation::POINT;
    use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;
    let mut p = POINT::default();
    unsafe { GetCursorPos(&mut p) }.ok()?;
    Some((p.x, p.y))
}

/// The primary monitor's size (physical pixels).
pub fn primary_size() -> Option<(u32, u32)> {
    let monitors = xcap::Monitor::all().ok()?;
    let m = monitors.iter().find(|m| m.is_primary().unwrap_or(false)).or_else(|| monitors.first())?;
    Some((m.width().ok()?, m.height().ok()?))
}

/// Top-left corner (pixels) of what `crop` cuts out for `r`.
pub fn crop_origin(image: &RgbaImage, r: Region) -> (u32, u32) {
    let (w, h) = (image.width(), image.height());
    let x = ((r.x.clamp(0.0, 1.0) * w as f64) as u32).min(w - 1);
    let y = ((r.y.clamp(0.0, 1.0) * h as f64) as u32).min(h - 1);
    (x, y)
}

pub fn crop(image: &RgbaImage, r: Region) -> RgbaImage {
    let (w, h) = (image.width(), image.height());
    let (x, y) = crop_origin(image, r);
    let cw = ((r.w.clamp(0.0, 1.0) * w as f64) as u32).clamp(1, w - x);
    let ch = ((r.h.clamp(0.0, 1.0) * h as f64) as u32).clamp(1, h - y);
    imageops::crop_imm(image, x, y, cw, ch).to_image()
}

/// Small HUD text reads much better when enlarged first; whole screens
/// above the OCR engine's limit are scaled down instead.
fn prepare(image: &RgbaImage, max_scale: f64) -> RgbaImage {
    let longest = image.width().max(image.height()).max(1) as f64;
    let scale = (OCR_MAX_DIMENSION as f64 / longest).min(max_scale);
    if (scale - 1.0).abs() < 0.01 {
        return image.clone();
    }
    imageops::resize(
        image,
        (image.width() as f64 * scale) as u32,
        (image.height() as f64 * scale) as u32,
        imageops::FilterType::CatmullRom,
    )
}

/// A line of text read off the screen, with its box in the input image's pixels.
#[derive(Clone)]
pub struct TextLine {
    pub text: String,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

/// Text lines in the image, via the Windows OCR engine (blocking).
pub fn ocr_lines(image: &RgbaImage) -> Result<Vec<String>, String> {
    Ok(ocr_text_lines(image)?.into_iter().map(|l| l.text).collect())
}

/// Text lines with their positions (blocking).
pub fn ocr_text_lines(image: &RgbaImage) -> Result<Vec<TextLine>, String> {
    ocr_text_lines_at(image, 2.0)
}

/// `ocr_text_lines`, enlarging at most by `max_scale` (big text enlarged
/// can get too big for the engine: short names like "D.F.A." went unread).
pub fn ocr_text_lines_at(image: &RgbaImage, max_scale: f64) -> Result<Vec<TextLine>, String> {
    use windows::Graphics::Imaging::{BitmapPixelFormat, SoftwareBitmap};
    use windows::Media::Ocr::OcrEngine;
    use windows::Security::Cryptography::CryptographicBuffer;

    let original_width = image.width() as f64;
    let image = prepare(image, max_scale);
    // prepare() may have scaled the image; boxes are mapped back.
    let back = original_width / image.width() as f64;
    let (w, h) = (image.width() as i32, image.height() as i32);
    // RGBA -> BGRA, as SoftwareBitmap expects.
    let mut bgra = image.into_raw();
    for px in bgra.as_chunks_mut::<4>().0 {
        px.swap(0, 2);
    }
    let buffer = CryptographicBuffer::CreateFromByteArray(&bgra).map_err(|e| e.to_string())?;
    let bitmap = SoftwareBitmap::CreateCopyFromBuffer(&buffer, BitmapPixelFormat::Bgra8, w, h)
        .map_err(|e| e.to_string())?;
    let engine = OcrEngine::TryCreateFromUserProfileLanguages()
        .map_err(|_| tr("Windows-Texterkennung nicht verfügbar", "Windows text recognition unavailable"))?;
    let result = engine
        .RecognizeAsync(&bitmap)
        .map_err(|e| e.to_string())?
        .join()
        .map_err(|e| e.to_string())?;
    let lines = result.Lines().map_err(|e| e.to_string())?;
    Ok(lines
        .into_iter()
        .filter_map(|line| {
            let text = line.Text().ok()?.to_string();
            // The line's box is the union of its words' boxes.
            let (mut x0, mut y0, mut x1, mut y1) = (f64::MAX, f64::MAX, f64::MIN, f64::MIN);
            for word in line.Words().ok()? {
                let r = word.BoundingRect().ok()?;
                x0 = x0.min(r.X as f64);
                y0 = y0.min(r.Y as f64);
                x1 = x1.max((r.X + r.Width) as f64);
                y1 = y1.max((r.Y + r.Height) as f64);
            }
            (x1 > x0).then_some(TextLine { text, x: x0 * back, y: y0 * back, w: (x1 - x0) * back, h: (y1 - y0) * back })
        })
        .collect())
}

/// Downscaled PNG data URL, for drawing a region on in the settings.
pub fn preview_url(image: &RgbaImage) -> Result<String, String> {
    let height = (image.height() as f64 * PREVIEW_WIDTH as f64 / image.width().max(1) as f64) as u32;
    let small = imageops::resize(image, PREVIEW_WIDTH, height.max(1), imageops::FilterType::Triangle);
    let mut png = Vec::new();
    small
        .write_to(&mut Cursor::new(&mut png), image::ImageFormat::Png)
        .map_err(|e| e.to_string())?;
    Ok(format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(png)
    ))
}

/// Whether the foreground window belongs to destiny2.exe.
/// Whether destiny2.exe is running at all.
pub fn destiny_running() -> bool {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
    };

    unsafe {
        let Ok(snapshot) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else {
            return false;
        };
        let mut entry = PROCESSENTRY32W { dwSize: size_of::<PROCESSENTRY32W>() as u32, ..Default::default() };
        let mut found = false;
        let mut more = Process32FirstW(snapshot, &mut entry).is_ok();
        while more {
            let len = entry.szExeFile.iter().position(|&c| c == 0).unwrap_or(entry.szExeFile.len());
            if String::from_utf16_lossy(&entry.szExeFile[..len]).eq_ignore_ascii_case("destiny2.exe") {
                found = true;
                break;
            }
            more = Process32NextW(snapshot, &mut entry).is_ok();
        }
        let _ = CloseHandle(snapshot);
        found
    }
}

/// Whether the overlay belongs on screen, and why (for the log): Destiny 2
/// is not minimized and no other app's window lies above it on its monitor.
/// So an app on a second monitor doesn't hide the overlay, but one left
/// open over the game does, whichever app has the focus. `overlay` is the
/// overlay's own window handle (ignored, like the taskbar and other
/// click-through overlays).
pub fn destiny_active(overlay: isize) -> (bool, String) {
    use windows::core::{w, BOOL};
    use windows::Win32::Foundation::{HWND, LPARAM, RECT};
    use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED, DWMWA_EXTENDED_FRAME_BOUNDS};
    use windows::Win32::Graphics::Gdi::{GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST};
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, FindWindowW, GetClassNameW, GetWindowLongPtrW, GetWindowTextW, IsIconic, IsWindowVisible,
        GWL_EXSTYLE, WS_EX_TOOLWINDOW, WS_EX_TRANSPARENT,
    };

    /// Smallest overlap (pixels, each side) that counts as covering the game.
    const MIN_OVERLAP: i32 = 24;

    fn text(window: HWND, class: bool) -> String {
        let mut buffer = [0u16; 256];
        let len = unsafe {
            if class {
                GetClassNameW(window, &mut buffer)
            } else {
                GetWindowTextW(window, &mut buffer)
            }
        };
        String::from_utf16_lossy(&buffer[..len.max(0) as usize])
    }

    struct Search {
        game: HWND,
        overlay: isize,
        monitor: RECT,
        /// Some(None): reached the game; Some(Some(window)): covered by it.
        result: Option<Option<HWND>>,
    }

    /// Whether `window` is an app window drawn over part of `monitor`.
    unsafe fn covers(window: HWND, monitor: &RECT) -> bool {
        if !IsWindowVisible(window).as_bool() || IsIconic(window).as_bool() {
            return false;
        }
        let ex = GetWindowLongPtrW(window, GWL_EXSTYLE);
        if ex & (WS_EX_TOOLWINDOW.0 | WS_EX_TRANSPARENT.0) as isize != 0 {
            return false;
        }
        // Hidden UWP / virtual-desktop windows are "visible" but cloaked.
        let mut cloaked = 0u32;
        let _ = DwmGetWindowAttribute(
            window,
            DWMWA_CLOAKED,
            &mut cloaked as *mut u32 as *mut _,
            size_of::<u32>() as u32,
        );
        if cloaked != 0 {
            return false;
        }
        let class = text(window, true);
        if matches!(class.as_str(), "Shell_TrayWnd" | "Shell_SecondaryTrayWnd" | "Progman" | "WorkerW") {
            return false;
        }
        // The visible frame, without the invisible resize borders that
        // would reach into the neighbouring monitor.
        let mut r = RECT::default();
        if DwmGetWindowAttribute(
            window,
            DWMWA_EXTENDED_FRAME_BOUNDS,
            &mut r as *mut RECT as *mut _,
            size_of::<RECT>() as u32,
        )
        .is_err()
        {
            return false;
        }
        let w = r.right.min(monitor.right) - r.left.max(monitor.left);
        let h = r.bottom.min(monitor.bottom) - r.top.max(monitor.top);
        w >= MIN_OVERLAP && h >= MIN_OVERLAP
    }

    unsafe extern "system" fn visit(window: HWND, data: LPARAM) -> BOOL {
        let search = &mut *(data.0 as *mut Search);
        if window == search.game {
            search.result = Some(None);
            return BOOL(0);
        }
        if window.0 as isize != search.overlay && covers(window, &search.monitor) {
            search.result = Some(Some(window));
            return BOOL(0);
        }
        BOOL(1)
    }

    if destiny_in_foreground() {
        return (true, "Destiny 2 in front".into());
    }
    unsafe {
        // The game's render window (its hidden input window has the same title).
        let game = FindWindowW(w!("Tiger D3D Window"), None).unwrap_or_default();
        if game.is_invalid() {
            return (false, "no Destiny 2 window".into());
        }
        if IsIconic(game).as_bool() {
            return (false, "Destiny 2 minimized".into());
        }
        let mut info = MONITORINFO { cbSize: size_of::<MONITORINFO>() as u32, ..Default::default() };
        if !GetMonitorInfoW(MonitorFromWindow(game, MONITOR_DEFAULTTONEAREST), &mut info).as_bool() {
            return (true, "monitor unknown".into());
        }
        let mut search = Search { game, overlay, monitor: info.rcMonitor, result: None };
        // Top-level windows come in Z-order, topmost first.
        let _ = EnumWindows(Some(visit), LPARAM(&mut search as *mut Search as isize));
        match search.result {
            Some(Some(window)) => (
                false,
                format!("'{}' ({}) over Destiny 2", text(window, false), text(window, true)),
            ),
            _ => (true, "nothing over Destiny 2".into()),
        }
    }
}

/// Work area (x, y, width, height in physical pixels) of the monitor
/// Destiny 2 is on; None if the game isn't running.
pub fn game_monitor_area() -> Option<(i32, i32, i32, i32)> {
    use windows::core::w;
    use windows::Win32::Graphics::Gdi::{GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST};
    use windows::Win32::UI::WindowsAndMessaging::FindWindowW;
    unsafe {
        let game = FindWindowW(w!("Tiger D3D Window"), None).ok().filter(|h| !h.is_invalid())?;
        let mut info = MONITORINFO { cbSize: size_of::<MONITORINFO>() as u32, ..Default::default() };
        if !GetMonitorInfoW(MonitorFromWindow(game, MONITOR_DEFAULTTONEAREST), &mut info).as_bool() {
            return None;
        }
        // The whole monitor: the game covers the taskbar too.
        let r = info.rcMonitor;
        Some((r.left, r.top, r.right - r.left, r.bottom - r.top))
    }
}

/// Give Destiny 2 the focus back (after closing DIM over it).
pub fn focus_game() {
    use windows::core::w;
    use windows::Win32::UI::WindowsAndMessaging::{FindWindowW, SetForegroundWindow};
    unsafe {
        if let Ok(game) = FindWindowW(w!("Tiger D3D Window"), None) {
            if !game.is_invalid() {
                let _ = SetForegroundWindow(game);
            }
        }
    }
}

/// The Discord app's main window to the front (restored if minimized), e.g.
/// after Radar opened a voice channel in it. False if it isn't open.
pub fn focus_discord_app() -> bool {
    use windows::core::BOOL;
    use windows::Win32::Foundation::{HWND, LPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetClassNameW, GetWindowTextW, IsIconic, IsWindowVisible, SetForegroundWindow, ShowWindow, SW_RESTORE,
    };
    unsafe extern "system" fn each(window: HWND, found: LPARAM) -> BOOL {
        let mut buffer = [0u16; 256];
        let len = GetWindowTextW(window, &mut buffer);
        let title = String::from_utf16_lossy(&buffer[..len.max(0) as usize]);
        let len = GetClassNameW(window, &mut buffer);
        let class = String::from_utf16_lossy(&buffer[..len.max(0) as usize]);
        // Its window: Chromium's class, the title "… - Discord" or "Discord".
        if class == "Chrome_WidgetWin_1" && (title == "Discord" || title.ends_with(" - Discord")) && IsWindowVisible(window).as_bool() {
            *(found.0 as *mut isize) = window.0 as isize;
            return BOOL(0);
        }
        BOOL(1)
    }
    let mut found: isize = 0;
    unsafe {
        let _ = EnumWindows(Some(each), LPARAM(&mut found as *mut isize as isize));
        if found == 0 {
            return false;
        }
        let window = HWND(found as *mut _);
        if IsIconic(window).as_bool() {
            let _ = ShowWindow(window, SW_RESTORE);
        }
        SetForegroundWindow(window).as_bool()
    }
}

/// Show or hide a window directly through Windows. Showing doesn't activate
/// it unless `activate` (activating the overlay would take the focus from
/// the app in front). Always use this for the overlay, never Tauri's
/// show/hide: Tauri tracks visibility itself and skips a hide when it
/// thinks the window is hidden already.
pub fn set_window_shown(window: isize, show: bool, activate: bool) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_HIDE, SW_SHOW, SW_SHOWNOACTIVATE};
    let command = match (show, activate) {
        (false, _) => SW_HIDE,
        (true, true) => SW_SHOW,
        (true, false) => SW_SHOWNOACTIVATE,
    };
    unsafe {
        let _ = ShowWindow(HWND(window as *mut _), command);
    }
}

/// Show a window minimized (in the taskbar) without taking the focus.
pub fn show_minimized(window: isize) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_SHOWMINNOACTIVE};
    unsafe {
        let _ = ShowWindow(HWND(window as *mut _), SW_SHOWMINNOACTIVE);
    }
}

/// Whether a window is visible (as Windows sees it).
pub fn window_visible(window: isize) -> bool {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::IsWindowVisible;
    unsafe { IsWindowVisible(HWND(window as *mut _)).as_bool() }
}

/// Whether the window in front is the game's, by its window class (as
/// `game_monitor_area` finds it); the game's process is never opened.
pub fn destiny_in_foreground() -> bool {
    use windows::Win32::UI::WindowsAndMessaging::{GetClassNameW, GetForegroundWindow};

    unsafe {
        let window = GetForegroundWindow();
        if window.is_invalid() {
            return false;
        }
        let mut buffer = [0u16; 64];
        let len = GetClassNameW(window, &mut buffer);
        len > 0 && String::from_utf16_lossy(&buffer[..len as usize]) == "Tiger D3D Window"
    }
}

/// Which app has the focus: Some(true) another one, Some(false) Destiny 2
/// or Radar itself, None no window (switching between windows).
pub fn other_app_in_front() -> Option<bool> {
    use windows::Win32::Foundation::RECT;
    use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowRect, GetWindowThreadProcessId, IsIconic};
    let mut pid = 0u32;
    let mut rect = RECT::default();
    unsafe {
        let window = GetForegroundWindow();
        if window.is_invalid() {
            return None;
        }
        GetWindowThreadProcessId(window, Some(&mut pid));
        if IsIconic(window).as_bool() || GetWindowRect(window, &mut rect).is_err() {
            return Some(false);
        }
    }
    if pid == 0 {
        return None;
    }
    if pid == std::process::id() || destiny_in_foreground() {
        return Some(false);
    }
    // Only an app on the game's screen counts (one clicked on another
    // monitor leaves the game uncovered): more than a sliver of it over
    // the game's monitor.
    let Some((x, y, w, h)) = game_monitor_area() else { return Some(true) };
    let overlap_w = (rect.right.min(x + w) - rect.left.max(x)).max(0) as i64;
    let overlap_h = (rect.bottom.min(y + h) - rect.top.max(y)).max(0) as i64;
    Some(overlap_w * overlap_h > (w as i64 * h as i64) / 20)
}

#[cfg(test)]
mod tests {
    /// Prints whether Destiny 2 is running right now:
    /// `cargo test --lib destiny_process -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn destiny_process() {
        println!("destiny2.exe running: {}, overlay active: {}", super::destiny_running(), super::destiny_active(0).1);
    }

    /// `cargo test --lib overlay_areas -- --ignored`
    #[test]
    #[ignore]
    fn overlay_areas_are_blacked_out() {
        super::overlay_set_areas(vec![super::Rect { x: 10.0, y: 20.0, w: 100.0, h: 50.0 }]);
        let shot = super::capture_primary().expect("capture");
        assert_eq!(shot.get_pixel(60, 40).0, [0, 0, 0, 255]);
        assert_eq!(shot.get_pixel(109, 69).0, [0, 0, 0, 255]);
    }
}

/// Round the corners of a child window (an embedded webview's host), so
/// everything in it, scrollbars and fixed elements included, is clipped to
/// Radar's rounded panel. Only for child windows: never the app window.
/// Returns the window's class name (for the log) when it was rounded.
pub fn round_child_window(window: isize, radius: i32) -> Option<String> {
    use windows::Win32::Foundation::{HWND, RECT};
    use windows::Win32::Graphics::Gdi::{CreateRoundRectRgn, SetWindowRgn};
    use windows::Win32::UI::WindowsAndMessaging::{GetClassNameW, GetClientRect, GetWindowLongW, GWL_STYLE, WS_CHILD};
    let hwnd = HWND(window as *mut _);
    unsafe {
        if GetWindowLongW(hwnd, GWL_STYLE) as u32 & WS_CHILD.0 == 0 {
            return None;
        }
        let mut r = RECT::default();
        GetClientRect(hwnd, &mut r).ok()?;
        // +1: the region's right / bottom edge is exclusive.
        let region = CreateRoundRectRgn(0, 0, r.right + 1, r.bottom + 1, radius * 2, radius * 2);
        // The system owns the region from here on.
        SetWindowRgn(hwnd, Some(region), true);
        let mut name = [0u16; 64];
        let len = GetClassNameW(hwnd, &mut name);
        Some(String::from_utf16_lossy(&name[..len.max(0) as usize]))
    }
}
