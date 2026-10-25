//! A page whose process went (WebView2's render process ended or hung:
//! Windows short of memory after hours in the background, a crash) left a
//! white window until Radar was started again. Now it is loaded anew, or
//! with the whole browser gone, Radar restarts; each time in detect.log.

use tauri::{AppHandle, Manager};
use webview2_com::Microsoft::Web::WebView2::Win32::{
    COREWEBVIEW2_PROCESS_FAILED_KIND, COREWEBVIEW2_PROCESS_FAILED_KIND_BROWSER_PROCESS_EXITED,
    COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED, COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_UNRESPONSIVE,
};
use webview2_com::ProcessFailedEventHandler;

/// Radar's own windows: the app and the overlay over the game.
const LABELS: [&str; 2] = ["main", "overlay"];

pub fn watch(app: &AppHandle) {
    for label in LABELS {
        let Some(window) = app.get_webview_window(label) else { continue };
        let app = app.clone();
        let _ = window.with_webview(move |platform| unsafe {
            let Ok(core) = platform.controller().CoreWebView2() else { return };
            let handler = ProcessFailedEventHandler::create(Box::new(move |sender, args| {
                let mut kind = COREWEBVIEW2_PROCESS_FAILED_KIND::default();
                if let Some(args) = args {
                    let _ = args.ProcessFailedKind(&mut kind);
                }
                crate::weapons::log_to_file(&format!("[webview] {label}: process failed (kind {})", kind.0));
                if kind == COREWEBVIEW2_PROCESS_FAILED_KIND_BROWSER_PROCESS_EXITED {
                    // Every page gone with it: a fresh start.
                    app.restart();
                } else if kind == COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED
                    || kind == COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_UNRESPONSIVE
                {
                    if let Some(page) = sender {
                        let _ = page.Reload();
                    }
                }
                Ok(())
            }));
            let mut token = 0i64;
            let _ = core.add_ProcessFailed(&handler, &mut token);
        });
    }
}
