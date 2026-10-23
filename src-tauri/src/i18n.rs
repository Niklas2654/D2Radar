//! Language of the strings produced on the Rust side (errors, class names)
//! and of Bungie content (manifest names). Follows the app's language
//! setting, which the frontend sends via `set_language`.

use std::sync::atomic::{AtomicBool, Ordering};

static ENGLISH: AtomicBool = AtomicBool::new(false);

pub fn set_english(english: bool) {
    ENGLISH.store(english, Ordering::Relaxed);
}

pub fn english() -> bool {
    ENGLISH.load(Ordering::Relaxed)
}

/// Bungie locale code, for API requests and manifest files.
pub fn locale() -> &'static str {
    if english() {
        "en"
    } else {
        "de"
    }
}

/// The text for the current language.
pub fn tr(de: &'static str, en: &'static str) -> &'static str {
    if english() {
        en
    } else {
        de
    }
}
