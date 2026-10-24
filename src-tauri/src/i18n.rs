//! Language of the strings produced on the Rust side (errors, class names)
//! and of Bungie content (manifest names). Follows the app's language
//! setting, which the frontend sends via `set_language`.
//!
//! Rust-side texts exist in German and English; every other language gets
//! the English ones. Bungie content comes in the language itself.

use std::sync::atomic::{AtomicUsize, Ordering};

/// The app's languages and Bungie's locale code for each.
const LANGUAGES: &[(&str, &str)] = &[
    ("de", "de"),
    ("en", "en"),
    ("fr", "fr"),
    ("es", "es"),
    ("it", "it"),
    ("pt", "pt-br"),
    ("pl", "pl"),
    ("ru", "ru"),
];

/// Index into `LANGUAGES` (German until the setting arrives).
static CURRENT: AtomicUsize = AtomicUsize::new(0);

/// Switch to an app language ("de", "en", "fr", …); unknown ones: English.
pub fn set_language(language: &str) {
    let index = LANGUAGES.iter().position(|(id, _)| *id == language).unwrap_or(1);
    CURRENT.store(index, Ordering::Relaxed);
}

/// The current app language's id.
pub fn language() -> &'static str {
    LANGUAGES[CURRENT.load(Ordering::Relaxed)].0
}

/// Whether Rust-side texts are English (every language but German).
pub fn english() -> bool {
    language() != "de"
}

/// Bungie locale code, for API requests and manifest files.
pub fn locale() -> &'static str {
    LANGUAGES[CURRENT.load(Ordering::Relaxed)].1
}

/// The text for the current language.
pub fn tr(de: &'static str, en: &'static str) -> &'static str {
    if english() {
        en
    } else {
        de
    }
}
