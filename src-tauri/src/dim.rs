//! DIM (Destiny Item Manager) embedded as a child webview of the main window,
//! and as a separate semi-transparent window over the game (hotkey).
//!
//! The frontend reserves an area for it and reports that rectangle (in CSS /
//! logical pixels); the webview is created lazily on first show and keeps its
//! session (login, cookies) in the app's shared WebView2 profile.
//!
//! CSS can't animate a native webview, so page swaps are animated from inside
//! DIM's document instead (`__radarAnimate`), with the webview transparent so
//! Radar's own UI shows through while it fades.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use serde::Deserialize;
use tauri::webview::{NewWindowResponse, WebviewBuilder, WebviewWindowBuilder};
use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, PhysicalPosition, PhysicalSize, Url, Webview, WebviewUrl};

const LABEL: &str = "dim";
const DIM_URL: &str = "https://app.destinyitemmanager.com/";

/// Sign-in flows may open popups on these hosts; everything else that tries
/// to open a new window goes to the system browser instead.
const LOGIN_HOSTS: [&str; 7] = [
    "bungie.net",
    "steamcommunity.com",
    "live.com",
    "microsoftonline.com",
    "playstation.com",
    "epicgames.com",
    "twitch.tv",
];

/// Injected into every page of the DIM webview.
///
/// `__radarAnimate(kind, dir)` plays the page-swap animation on the document
/// itself; keyframes and timing mirror `.page-enter-*` / `.page-exit-*` in
/// styles.css. `__radarRefresh()` presses DIM's own "R" (refresh inventory)
/// hotkey unless an item is being dragged, so a refresh never cancels a
/// transfer in progress.
const INIT_SCRIPT: &str = r##"
(() => {
  let current = null;

  // A page that loads while the webview is hidden starts invisible, so the
  // first show fades in instead of popping.
  const startHidden = () => {
    if (document.visibilityState === "hidden") document.documentElement.style.opacity = "0";
  };
  if (document.documentElement) startHidden();
  else document.addEventListener("DOMContentLoaded", startHidden, { once: true });

  // Radar's look: DIM's theme colors (it themes everything through
  // --theme-* variables) with the accent color (set by the app via
  // __radarAccent) and no background of its own, so Radar's shows through.
  // The rounded corners are cut natively (round_corners).
  const theme = () => {
    const style = document.createElement("style");
    style.id = "radar-theme";
    style.textContent = `
      :root, :root[class], [class*="theme-"] {
        --theme-accent-primary: var(--radar-accent, #ff9f2e) !important;
        --theme-app-bg-gradient-start: transparent !important;
        --theme-app-bg-gradient-end: transparent !important;
        --theme-app-bg-gradient: transparent !important;
        --theme-app-bg: transparent !important;
        --theme-pwa-background: transparent !important;
        --theme-header-nav-bg: rgb(5 7 12 / 0.55) !important;
        --theme-header-characters-bg: rgb(5 7 12 / 0.55) !important;
        --theme-search-bg: rgb(255 255 255 / 0.05) !important;
        --theme-fill-modal: #07090f !important;
        --theme-dropdown-menu-bg: #0a0c12 !important;
        --theme-search-dropdown-bg: #0a0c12 !important;
      }
      /* No background of its own: Radar's shows through 1:1. */
      html { background: transparent !important; }
      /* While a picture is taken (dim_snapshot): Radar's black, so the
         picture has no see-through parts. */
      html.radar-capture { background: #020307 !important; }
      /* The bars stay on top while scrolling: blur what passes under them
         instead of a solid grey band. */
      header { backdrop-filter: blur(16px); }
      body { background: transparent !important; }`;
    (document.head || document.documentElement).appendChild(style);
    // Kept last in <head> (DIM adds its styles later), so it always wins.
    const keepLast = () => {
      if (document.head && style.parentNode !== document.head) document.head.appendChild(style);
    };
    document.addEventListener("DOMContentLoaded", keepLast, { once: true });
    addEventListener("load", keepLast, { once: true });
  };
  if (document.documentElement) theme();
  else document.addEventListener("readystatechange", theme, { once: true });
  window.__radarAccent = (color) => {
    window.__radarAccentValue = color;
    document.documentElement?.style.setProperty("--radar-accent", color);
  };
  if (window.__radarAccentValue) window.__radarAccent(window.__radarAccentValue);

  // Radar's scrollbars (see styles.css), so DIM fits in.
  const scrollbars = () => {
    const style = document.createElement("style");
    style.textContent = `
      ::-webkit-scrollbar { width: 10px; height: 10px; }
      ::-webkit-scrollbar-track, ::-webkit-scrollbar-corner { background: transparent; }
      /* Always visible in DIM (it's a long page to find your way in),
         brighter while scrolling. */
      ::-webkit-scrollbar-thumb { border: 3px solid transparent; border-radius: 999px; background: rgb(255 255 255 / 0.16) padding-box; }
      .is-scrolling::-webkit-scrollbar-thumb { background: rgb(255 255 255 / 0.3) padding-box; }
      ::-webkit-scrollbar-thumb:hover { border-width: 2px; background: rgb(255 255 255 / 0.42) padding-box; }
      ::-webkit-scrollbar-button { display: none; }
      html, body, * { scrollbar-color: unset !important; scrollbar-width: unset !important; }`;
    (document.head || document.documentElement).appendChild(style);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", scrollbars, { once: true });
  else scrollbars();
  // Shown only while scrolling (like lib/scrollbars.ts in the app).
  const scrollTimers = new WeakMap();
  addEventListener("scroll", (e) => {
    const el = e.target instanceof Element ? e.target : document.documentElement;
    el.classList.add("is-scrolling");
    clearTimeout(scrollTimers.get(el));
    scrollTimers.set(el, setTimeout(() => el.classList.remove("is-scrolling"), 900));
  }, { capture: true, passive: true });

  // The app's page push (.page-enter-* / .page-exit-* in styles.css): in
  // from the right and out to the left going forward, mirrored going back.
  // Only transform animates, so DIM's heavy page isn't repainted per frame.
  // As Radar's pages (styles.css): coming in, DIM rises in as the page's
  // second part (after its header); going, it sinks back and fades.
  const IN = { duration: 360, delay: 100, easing: "cubic-bezier(0.22, 0.8, 0.2, 1)" };
  const OUT = { duration: 300, easing: "cubic-bezier(0.22, 0.8, 0.2, 1)" };
  const TIMING = { duration: IN.delay + IN.duration };

  // The root's background is painted on the canvas and doesn't move with a
  // transform, so DIM's grey would stay behind. While sliding, the canvas is
  // made transparent and the background is drawn by a layer that moves along.
  const BACKDROP_ID = "radar-slide-backdrop";
  const isClear = (c) => !c || c === "transparent" || c === "rgba(0, 0, 0, 0)";
  const liftBackground = () => {
    if (document.getElementById(BACKDROP_ID)) return;
    const html = getComputedStyle(document.documentElement);
    const body = document.body ? getComputedStyle(document.body) : html;
    const color = isClear(body.backgroundColor) ? html.backgroundColor : body.backgroundColor;
    const image = body.backgroundImage !== "none" ? body.backgroundImage : html.backgroundImage;
    const style = document.createElement("style");
    style.id = BACKDROP_ID;
    style.textContent = `
      html, body { background: transparent !important; }
      html::before {
        content: ""; position: fixed; z-index: -2147483647; pointer-events: none;
        /* Fixed inside the transformed root is relative to the document:
           cover the part of it that is on screen. */
        top: ${scrollY}px; left: ${scrollX}px; width: 100vw; height: 100vh;
        background-color: ${isClear(color) ? "transparent" : color};
        background-image: ${image === "none" ? "none" : image};
      }`;
    (document.head || document.documentElement).appendChild(style);
  };
  const dropBackground = () => document.getElementById(BACKDROP_ID)?.remove();

  // Back to the plain page (no transform, visible), for showing DIM without
  // an animation: the app slid a picture of it in instead.
  window.__radarReset = () => {
    if (current) current.cancel();
    current = null;
    const el = document.documentElement;
    if (!el) return;
    el.style.opacity = "";
    el.style.willChange = "";
    dropBackground();
  };

  // `startedAt` (ms since the epoch) is when the app's own page animation
  // started: this call can arrive late (DIM busy), so it catches up to the
  // same point instead of trailing behind Radar's header.
  window.__radarAnimate = (kind, dir, startedAt) => {
    const el = document.documentElement;
    if (!el || !el.animate) return;
    if (current) current.cancel();
    el.style.opacity = "";
    const home = { transform: "none", opacity: 1 };
    el.style.willChange = "transform, opacity";
    liftBackground();
    current =
      kind === "in"
        ? el.animate([{ transform: "translateY(8px)", opacity: 0 }, home], { ...IN, fill: "backwards" })
        : // Stays gone afterwards; the next "in" cancels it.
          el.animate([home, { transform: "scale(0.95)", opacity: 0 }], { ...OUT, fill: "forwards" });
    if (startedAt) {
      const behind = Date.now() - startedAt;
      if (behind > 0) current.currentTime = Math.min(behind, TIMING.duration);
    }
    if (kind === "in") {
      // Settled: back to DIM's own background (also when cancelled by an "out").
      const done = current;
      done.finished.then(
        () => {
          el.style.willChange = "";
          if (current === done) dropBackground();
        },
        () => {}
      );
    }
  };

  if (location.hostname !== "app.destinyitemmanager.com") return;
  let dragging = false;
  addEventListener("dragstart", () => { dragging = true; }, true);
  addEventListener("dragend", () => { dragging = false; }, true);
  addEventListener("drop", () => { dragging = false; }, true);
  window.__radarRefresh = () => {
    if (dragging || document.hidden || !document.body) return;
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key: "r", code: "KeyR", bubbles: true })
    );
  };

  // DIM's login page: straight on to Bungie's (DIM's own button, so its
  // sign-in state is set as usual), leaving only Bungie's consent. Once a
  // minute at most: coming back to it (consent declined) stays there.
  setInterval(() => {
    if (location.pathname !== "/login") return;
    const link = document.querySelector('a[href*="bungie.net/en/OAuth/Authorize"]');
    if (!link) return;
    let last = 0;
    try { last = Number(sessionStorage.getItem("radar-dim-login")) || 0; } catch {}
    if (Date.now() - last < 60000) return;
    try { sessionStorage.setItem("radar-dim-login", String(Date.now())); } catch {}
    link.click();
  }, 500);
})();
"##;

/// A JPEG of what DIM shows right now (WebView2 CapturePreview). The page
/// swap slides this picture along with Radar's page, instead of animating
/// DIM's own document, which never quite keeps pace with the app.
/// `png` keeps transparency (bigger); otherwise JPEG.
pub(crate) async fn capture(webview: &Webview, png: bool) -> Result<Vec<u8>, String> {
    use std::sync::{Arc, Mutex as StdMutex};
    use webview2_com::CapturePreviewCompletedHandler;
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_JPEG, COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG,
    };
    let format = if png { COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG } else { COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_JPEG };
    use windows::Win32::Foundation::HGLOBAL;
    use windows::Win32::System::Com::StructuredStorage::CreateStreamOnHGlobal;
    use windows::Win32::System::Com::{IStream, STATFLAG_NONAME, STATSTG, STREAM_SEEK_SET};

    fn read(stream: &IStream) -> windows::core::Result<Vec<u8>> {
        unsafe {
            stream.Seek(0, STREAM_SEEK_SET, None)?;
            let mut stat = STATSTG::default();
            stream.Stat(&mut stat, STATFLAG_NONAME)?;
            let mut bytes = vec![0u8; stat.cbSize as usize];
            let mut read = 0u32;
            stream.Read(bytes.as_mut_ptr() as *mut _, bytes.len() as u32, Some(&mut read)).ok()?;
            bytes.truncate(read as usize);
            Ok(bytes)
        }
    }

    let (tx, rx) = tokio::sync::oneshot::channel::<Result<Vec<u8>, String>>();
    let tx = Arc::new(StdMutex::new(Some(tx)));
    let send = move |result: Result<Vec<u8>, String>| {
        if let Some(tx) = tx.lock().unwrap().take() {
            let _ = tx.send(result);
        }
    };
    let on_error = send.clone();
    webview
        .with_webview(move |platform| {
            let started = (|| -> windows::core::Result<()> {
                let core = unsafe { platform.controller().CoreWebView2()? };
                let stream = unsafe { CreateStreamOnHGlobal(HGLOBAL::default(), true)? };
                let done = stream.clone();
                let handler = CapturePreviewCompletedHandler::create(Box::new(move |result| {
                    send(result.and_then(|_| read(&done)).map_err(|e| e.to_string()));
                    Ok(())
                }));
                unsafe { core.CapturePreview(format, &stream, &handler)? };
                Ok(())
            })();
            if let Err(e) = started {
                on_error(Err(e.to_string()));
            }
        })
        .map_err(|e| e.to_string())?;
    tokio::time::timeout(Duration::from_secs(3), rx)
        .await
        .map_err(|_| "snapshot timeout".to_string())?
        .map_err(|e| e.to_string())?
}

/// The DIM tab as a picture (data URL), for the page swap; None while DIM
/// isn't loaded.
#[tauri::command]
pub async fn dim_snapshot(app: AppHandle) -> Result<Option<String>, String> {
    use base64::Engine;
    let Some(webview) = app.get_webview(LABEL) else { return Ok(None) };
    // Best: the pixels on screen, exactly as seen. WebView2's own capture
    // renders some things differently (the dimmed postmaster items came out
    // brighter, so they flashed on every page swap).
    if let Some(url) = screen_snapshot(&app, &webview).await {
        return Ok(Some(url));
    }
    // Radar not in front (the screen shows something else there): WebView2's
    // capture, over Radar's black so it has no see-through parts.
    let _ = webview.eval("document.documentElement.classList.add('radar-capture')");
    tokio::time::sleep(Duration::from_millis(60)).await;
    let jpeg = capture(&webview, false).await;
    let _ = webview.eval("document.documentElement.classList.remove('radar-capture')");
    let jpeg = jpeg?;
    Ok((!jpeg.is_empty()).then(|| format!("data:image/jpeg;base64,{}", base64::engine::general_purpose::STANDARD.encode(jpeg))))
}

/// DIM's area as on screen (JPEG data URL), while Radar is the window in
/// front; None otherwise (then the screen there may show another window).
async fn screen_snapshot(app: &AppHandle, webview: &Webview) -> Option<String> {
    use windows::Win32::Foundation::{HWND, RECT};
    use windows::Win32::UI::WindowsAndMessaging::{GetAncestor, GetForegroundWindow, GetWindowRect, IsIconic, GA_ROOT};
    let main = app.get_window("main")?.hwnd().ok()?;
    let front = unsafe { GetAncestor(GetForegroundWindow(), GA_ROOT) };
    if front.0 != main.0 || unsafe { IsIconic(HWND(main.0)) }.as_bool() {
        return None;
    }
    // The webview's own child window: its rectangle on screen (pixels).
    let (tx, rx) = tokio::sync::oneshot::channel::<Option<RECT>>();
    let tx = std::sync::Mutex::new(Some(tx));
    webview
        .with_webview(move |platform| {
            let mut parent = HWND::default();
            let rect = unsafe { platform.controller().ParentWindow(&mut parent) }.ok().and_then(|_| {
                let mut r = RECT::default();
                unsafe { GetWindowRect(parent, &mut r) }.ok().map(|_| r)
            });
            if let Some(tx) = tx.lock().unwrap().take() {
                let _ = tx.send(rect);
            }
        })
        .ok()?;
    let r = tokio::time::timeout(Duration::from_secs(1), rx).await.ok()?.ok()??;
    let (w, h) = ((r.right - r.left).max(0) as u32, (r.bottom - r.top).max(0) as u32);
    if w < 8 || h < 8 {
        return None;
    }
    tauri::async_runtime::spawn_blocking(move || -> Option<String> {
        use base64::Engine;
        let monitor = xcap::Monitor::from_point(r.left + w as i32 / 2, r.top + h as i32 / 2).ok()?;
        let (mx, my) = (monitor.x().ok()?, monitor.y().ok()?);
        let (mw, mh) = (monitor.width().ok()?, monitor.height().ok()?);
        // Only the part on this monitor.
        let x = (r.left - mx).max(0) as u32;
        let y = (r.top - my).max(0) as u32;
        let w = w.min(mw.saturating_sub(x));
        let h = h.min(mh.saturating_sub(y));
        if w < 8 || h < 8 {
            return None;
        }
        let image = monitor.capture_region(x, y, w, h).ok()?;
        let rgb = image::DynamicImage::ImageRgba8(image).into_rgb8();
        let mut jpeg = Vec::new();
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg, 88).encode_image(&rgb).ok()?;
        Some(format!("data:image/jpeg;base64,{}", base64::engine::general_purpose::STANDARD.encode(jpeg)))
    })
    .await
    .ok()
    .flatten()
}

/// Radar's page (re)loads (F5): the tab's webview, which lies over the page
/// and isn't part of it, goes too; the page opens it again when wanted.
pub fn hide_tab(app: &AppHandle) {
    SHOW_GENERATION.fetch_add(1, Ordering::SeqCst);
    if let Some(webview) = app.get_webview(LABEL) {
        let _ = webview.hide();
    }
}

/// Hide the DIM tab at once (its picture slides out in the app instead).
#[tauri::command]
pub async fn dim_hide_now(app: AppHandle, seq: Option<u64>) -> Result<(), String> {
    if !newest(&SEQ, seq) {
        return Ok(());
    }
    SHOW_GENERATION.fetch_add(1, Ordering::SeqCst);
    if let Some(webview) = app.get_webview(LABEL) {
        webview.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Window label of DIM over the game.
const GAME_LABEL: &str = "dim-game";

/// Added to INIT_SCRIPT for DIM over the game: the whole page at a set
/// opacity, on Radar's dark backdrop. The root background is painted on the
/// canvas, which opacity doesn't reach, so it is drawn by a layer inside the
/// page.
const GAME_SCRIPT: &str = r##"
(() => {
  const ID = "radar-game-opacity";
  window.__radarOpacity = (value) => {
    window.__radarOpacityValue = value;
    let style = document.getElementById(ID);
    if (!style) {
      style = document.createElement("style");
      style.id = ID;
      (document.head || document.documentElement).appendChild(style);
    }
    style.disabled = false;
    style.textContent = `
      html, body { background: transparent !important; }
      html { opacity: ${value} !important; }
      /* No scrollbars over the game (scrolling still works): the page's
         one sat in a strip of its own at the right edge, which neither the
         backdrop nor the opacity reached. */
      html, body, * { scrollbar-width: none !important; scrollbar-gutter: auto !important; }
      ::-webkit-scrollbar { display: none !important; width: 0 !important; height: 0 !important; }
      html::before {
        content: ""; position: fixed; inset: 0; z-index: -2147483647; pointer-events: none;
        /* Radar's dark backdrop, like Discord over the game (DIM's own
           grey showed before). */
        background:
          radial-gradient(60rem 30rem at 85% -10%, color-mix(in oklab, var(--radar-accent, #5b8cff) 14%, transparent), transparent 60%),
          linear-gradient(160deg, #0d1018, #07080c 70%);
      }`;
  };
  const apply = () => window.__radarOpacity(window.__radarOpacityValue ?? 0.9);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", apply, { once: true });
  else apply();
  // DIM's stylesheet may only be in place once everything has loaded.
  addEventListener("load", apply, { once: true });
})();
"##;

/// Margin around DIM over the game, as a share of the monitor height.
/// Over the whole screen of the game (DIM and Discord in game).
const GAME_MARGIN: f64 = 0.0;

pub(crate) fn place_over_game(app: &AppHandle, window: &tauri::WebviewWindow) {
    let area = crate::screen::game_monitor_area().or_else(|| {
        let m = app.primary_monitor().ok().flatten()?;
        Some((m.position().x, m.position().y, m.size().width as i32, m.size().height as i32))
    });
    if let Some((x, y, w, h)) = area {
        let margin = (h as f64 * GAME_MARGIN) as i32;
        let _ = window.set_position(PhysicalPosition::new(x + margin, y + margin));
        let _ = window.set_size(PhysicalSize::new((w - 2 * margin).max(200) as u32, (h - 2 * margin).max(200) as u32));
    }
}

/// Apply the opacity to DIM over the game, if it's open.
pub fn apply_game_opacity(app: &AppHandle, opacity: f64) {
    if let Some(window) = app.get_webview_window(GAME_LABEL) {
        let _ = window.eval(format!("window.__radarOpacity && window.__radarOpacity({opacity})"));
    }
}

/// Hotkey: open DIM semi-transparent over the game, or close it again and
/// hand the focus back to the game. Created on first use and kept (hidden)
/// afterwards, so it opens instantly the next time.
/// Hide its window over the game (another one opens there).
pub fn hide_in_game(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(GAME_LABEL) {
        let _ = window.hide();
    }
}

/// Whether its window over the game is shown (the hotkey closes it then,
/// in game or not).
pub fn open_in_game(app: &AppHandle) -> bool {
    app.get_webview_window(GAME_LABEL).is_some_and(|w| w.is_visible().unwrap_or(false))
}

pub fn toggle_in_game(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let opacity = crate::hotkeys::dim_opacity(&app);
        let window = match app.get_webview_window(GAME_LABEL) {
            Some(window) if window.is_visible().unwrap_or(false) => {
                // The game first, while this window still has the front
                // (hidden, it may no longer hand it on).
                crate::screen::focus_game();
                let _ = window.hide();
                return;
            }
            Some(window) => window,
            None => {
                let script = format!("{INIT_SCRIPT}\nwindow.__radarOpacityValue = {opacity};\n{GAME_SCRIPT}");
                let built = WebviewWindowBuilder::new(&app, GAME_LABEL, WebviewUrl::External(dim_url()))
                    .title("Radar – DIM")
                    .decorations(false)
                    .transparent(true)
                    .shadow(false)
                    .always_on_top(true)
                    .skip_taskbar(true)
                    .visible(false)
                    .disable_drag_drop_handler()
                    .initialization_script(&script)
                    .on_page_load(|webview, payload| {
                        if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
                            if let Some(script) = accent_script() {
                                let _ = webview.eval(&script);
                            }
                        }
                    })
                    .on_new_window(|url, _features| {
                        if is_login_host(&url) {
                            NewWindowResponse::Allow
                        } else {
                            let _ = tauri_plugin_opener::open_url(url.as_str(), None::<&str>);
                            NewWindowResponse::Deny
                        }
                    })
                    .build();
                match built {
                    Ok(window) => window,
                    Err(e) => {
                        eprintln!("[dim] in-game window: {e}");
                        return;
                    }
                }
            }
        };
        place_over_game(&app, &window);
        apply_game_opacity(&app, opacity);
        // One window over the game at a time: Discord's goes.
        crate::discord::hide_in_game(&app);
        crate::inspect::hide_in_game(&app);
        crate::sleep::wake_window(&window);
        let _ = window.show();
        let _ = window.set_focus();
    });
}

/// Length of the exit animation in INIT_SCRIPT, plus a frame of slack.
const EXIT_ANIMATION: Duration = Duration::from_millis(320);

/// Bumped on every show, so a delayed hide from an earlier exit animation
/// doesn't hide the webview after the user already switched back.
static SHOW_GENERATION: AtomicU64 = AtomicU64::new(0);

/// The newest show or hide the page asked for (its number, see `nextSeq`
/// in the app): the commands run side by side, so on quick tab switches an
/// older one can come in after a newer one, and is dropped.
pub(crate) static SEQ: AtomicU64 = AtomicU64::new(0);

/// Whether `seq` is the newest asked for so far (no number: always).
pub(crate) fn newest(last: &AtomicU64, seq: Option<u64>) -> bool {
    seq.is_none_or(|s| last.fetch_max(s, Ordering::SeqCst) <= s)
}

/// Whether nothing newer came in since `seq` (checked right before showing).
pub(crate) fn still(last: &AtomicU64, seq: Option<u64>) -> bool {
    seq.is_none_or(|s| last.load(Ordering::SeqCst) == s)
}

/// The other tab's webview goes as this one shows (and an older show of it
/// coming in late is dropped): never both at once.
pub(crate) fn hide_for_other(app: &AppHandle, seq: Option<u64>) {
    if let Some(s) = seq {
        SEQ.fetch_max(s, Ordering::SeqCst);
    }
    SHOW_GENERATION.fetch_add(1, Ordering::SeqCst);
    if let Some(webview) = app.get_webview(LABEL) {
        let _ = webview.hide();
    }
}

/// Only the two known values ever reach the eval'd script.
fn direction(dir: Option<&str>) -> &'static str {
    if dir == Some("back") {
        "back"
    } else {
        "forward"
    }
}

/// Play the page animation inside DIM; `started_at` (ms since the epoch) is
/// when the app's page animation started, so both stay in step.
fn animate(webview: &Webview, kind: &str, dir: Option<&str>, started_at: Option<f64>) {
    let _ = webview.eval(format!(
        "window.__radarAnimate && window.__radarAnimate('{kind}', '{}', {})",
        direction(dir),
        started_at.filter(|t| t.is_finite()).unwrap_or(0.0)
    ));
}

#[derive(Deserialize)]
pub struct Bounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

fn dim_url() -> Url {
    DIM_URL.parse().expect("valid DIM url")
}

fn is_login_host(url: &Url) -> bool {
    url.host_str().is_some_and(|host| {
        LOGIN_HOSTS
            .iter()
            .any(|h| host == *h || host.ends_with(&format!(".{h}")))
    })
}

/// Serializes creation so concurrent show/preload calls can't race to add
/// two webviews with the same label.
static CREATE_LOCK: Mutex<()> = Mutex::new(());

/// Return the DIM webview, creating it at the given bounds if needed.
/// The bool is true when it was just created.
fn get_or_create(
    app: &AppHandle,
    position: LogicalPosition<f64>,
    size: LogicalSize<f64>,
) -> Result<(Webview, bool), String> {
    let _guard = CREATE_LOCK.lock().unwrap();
    if let Some(webview) = app.get_webview(LABEL) {
        return Ok((webview, false));
    }
    let window = app.get_window("main").ok_or(crate::i18n::tr("Hauptfenster nicht gefunden", "Main window not found"))?;
    let builder = WebviewBuilder::new(LABEL, WebviewUrl::External(dim_url()))
        // Tauri's native file-drop handler swallows HTML5 drag and drop on
        // Windows, which DIM needs to move items between characters/vault.
        .disable_drag_drop_handler()
        // Lets Radar's UI show through while DIM fades in and out.
        .transparent(true)
        .initialization_script(INIT_SCRIPT)
        .on_page_load(|webview, payload| {
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
                LOADED.store(true, std::sync::atomic::Ordering::SeqCst);
                if let Some(script) = accent_script() {
                    let _ = webview.eval(&script);
                }
            }
        })
        .on_new_window(|url, _features| {
            if is_login_host(&url) {
                NewWindowResponse::Allow
            } else {
                let _ = tauri_plugin_opener::open_url(url.as_str(), None::<&str>);
                NewWindowResponse::Deny
            }
        });
    let webview = window
        .add_child(builder, position, size)
        .map_err(|e| e.to_string())?;
    Ok((webview, true))
}

/// Clip an embedded webview to Radar's rounded panel (14 px corners). Its
/// page can't do that itself: DIM's document is taller than the view, so
/// rounding the document leaves the bottom corners square.
pub(crate) fn round_corners(webview: &Webview) {
    let scale = webview.window().scale_factor().unwrap_or(1.0);
    let radius = (14.0 * scale).round() as i32;
    let label = webview.label().to_string();
    let _ = webview.with_webview(move |platform| {
        let mut parent = Default::default();
        if unsafe { platform.controller().ParentWindow(&mut parent) }.is_err() {
            return;
        }
        let rounded = crate::screen::round_child_window(parent.0 as isize, radius);
        static LOGGED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
        if !LOGGED.swap(true, std::sync::atomic::Ordering::SeqCst) {
            println!("[webview-round] {label}: {rounded:?}");
        }
    });
}

/// Radar's accent color ("#rrggbb") for DIM's theme.
static ACCENT: std::sync::Mutex<String> = std::sync::Mutex::new(String::new());

fn accent_script() -> Option<String> {
    let accent = ACCENT.lock().unwrap().clone();
    (!accent.is_empty()).then(|| format!("window.__radarAccent && window.__radarAccent('{accent}')"))
}

#[tauri::command]
pub fn dim_set_accent(app: AppHandle, color: String) {
    let valid = color.len() == 7 && color.starts_with('#') && color[1..].chars().all(|c| c.is_ascii_hexdigit());
    if !valid {
        return;
    }
    *ACCENT.lock().unwrap() = color;
    let Some(script) = accent_script() else { return };
    if let Some(webview) = app.get_webview(LABEL) {
        let _ = webview.eval(&script);
    }
    if let Some(window) = app.get_webview_window(GAME_LABEL) {
        let _ = window.eval(&script);
    }
}

// The commands that may create the webview are async on purpose: add_child
// dispatches to the main thread and waits for it, which would deadlock inside
// a sync command (those run on the main thread).

/// Position and show DIM. With `animate` (a direction), it plays the
/// page-enter animation; plain repositioning (window resize) passes None.
#[tauri::command]
pub async fn dim_show(
    app: AppHandle,
    bounds: Bounds,
    animate: Option<String>,
    started_at: Option<f64>,
    reset: Option<bool>,
    seq: Option<u64>,
) -> Result<(), String> {
    if !newest(&SEQ, seq) {
        return Ok(());
    }
    SHOW_GENERATION.fetch_add(1, Ordering::SeqCst);
    crate::discord::hide_for_other(&app, seq);
    let position = LogicalPosition::new(bounds.x, bounds.y);
    let size = LogicalSize::new(bounds.width.max(1.0), bounds.height.max(1.0));
    let (webview, created) = get_or_create(&app, position, size)?;
    if !created {
        webview.set_position(position).map_err(|e| e.to_string())?;
        webview.set_size(size).map_err(|e| e.to_string())?;
    }
    if animate.is_some() {
        // Queue the animation before showing so the first frame is already faded.
        self::animate(&webview, "in", animate.as_deref(), started_at);
    } else if reset == Some(true) && !created {
        // Shown as is after the app slid a picture of it in: undo what an
        // earlier exit animation or the hidden preload left behind.
        let _ = webview.eval("window.__radarReset && window.__radarReset()");
    }
    round_corners(&webview);
    if !still(&SEQ, seq) {
        return Ok(());
    }
    webview.show().map_err(|e| e.to_string())
}

/// The DIM tab's page has finished loading once (for the loading screen).
pub(crate) static LOADED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Load DIM hidden in the background so the tab opens instantly.
#[tauri::command]
pub async fn dim_preload(app: AppHandle) -> Result<(), String> {
    let window = app.get_window("main").ok_or(crate::i18n::tr("Hauptfenster nicht gefunden", "Main window not found"))?;
    // Load at roughly the final size so DIM doesn't start in its phone layout.
    let size = window
        .inner_size()
        .map_err(|e| e.to_string())?
        .to_logical::<f64>(window.scale_factor().unwrap_or(1.0));
    // Created off-screen so it never flashes over the page before hide().
    let offscreen = LogicalPosition::new(-(size.width + 100.0), 0.0);
    let (webview, created) = get_or_create(&app, offscreen, size)?;
    if created {
        webview.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Play the page-exit animation inside DIM, then hide the webview, unless it
/// was shown again in the meantime.
#[tauri::command]
pub async fn dim_hide(
    app: AppHandle,
    dir: Option<String>,
    started_at: Option<f64>,
    seq: Option<u64>,
) -> Result<(), String> {
    if !newest(&SEQ, seq) {
        return Ok(());
    }
    let Some(webview) = app.get_webview(LABEL) else { return Ok(()) };
    let generation = SHOW_GENERATION.load(Ordering::SeqCst);
    animate(&webview, "out", dir.as_deref(), started_at);
    // Hide once the animation is over, counted from when it started.
    let elapsed = started_at.map_or(0.0, |t| (chrono::Utc::now().timestamp_millis() as f64 - t).max(0.0));
    tokio::time::sleep(EXIT_ANIMATION.saturating_sub(Duration::from_millis(elapsed as u64))).await;
    if SHOW_GENERATION.load(Ordering::SeqCst) == generation {
        webview.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Ask DIM to reload the inventory from Bungie (see INIT_SCRIPT).
#[tauri::command]
pub fn dim_refresh(app: AppHandle) -> Result<(), String> {
    if let Some(webview) = app.get_webview(LABEL) {
        webview
            .eval("window.__radarRefresh && window.__radarRefresh()")
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn dim_home(app: AppHandle) -> Result<(), String> {
    if let Some(webview) = app.get_webview(LABEL) {
        webview.navigate(dim_url()).map_err(|e| e.to_string())?;
    }
    Ok(())
}
