//! Radar's setup: a dark window in Radar's look that runs the bundled NSIS
//! installer silently. Updates from inside the app keep using the NSIS
//! installer directly; this window is only for installs from the website.
#![windows_subsystem = "windows"]

use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use std::process::Command;
use std::sync::{Arc, Mutex};

use eframe::egui::{
    self, Align, Align2, Color32, CornerRadius, FontData, FontDefinitions, FontFamily, FontId, Layout, Pos2, Rect, RichText, Sense,
    Stroke, TextureHandle, Vec2,
};

const VERSION: &str = env!("RADAR_VERSION");
const INSTALLER: &[u8] = include_bytes!(env!("RADAR_INSTALLER_PATH"));
const LOGO: &[u8] = include_bytes!("../../src-tauri/icons/128x128.png");
const PRIVACY_URL: &str = "https://d2radar.vercel.app/privacy";
const REPO_URL: &str = "https://github.com/Niklas2654/D2Radar";
const UNINSTALL_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Uninstall\Radar";
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

// The app's colors (src/styles.css).
const BG: Color32 = Color32::from_rgb(2, 3, 7);
const PANEL: Color32 = Color32::from_rgb(12, 14, 20);
const TEXT: Color32 = Color32::from_rgb(240, 242, 248);
const MUTED: Color32 = Color32::from_rgb(140, 145, 160);
const ACCENT: Color32 = Color32::from_rgb(255, 159, 46);
/// The accent mixed with white, like --accent-text.
const ACCENT_TEXT: Color32 = Color32::from_rgb(255, 199, 134);
const LINE: Color32 = Color32::from_rgb(28, 31, 40);

const W: f32 = 540.0;
const H: f32 = 400.0;
const BAR: f32 = 38.0;
const PAD: f32 = 32.0;

struct Texts {
    subtitle: &'static str,
    privacy: &'static str,
    privacy_link: &'static str,
    open_source: &'static str,
    desktop: &'static str,
    install: &'static str,
    update: &'static str,
    reinstall: &'static str,
    installed: &'static str,
    installing: &'static str,
    done: &'static str,
    launch: &'static str,
    close: &'static str,
    failed: &'static str,
    retry: &'static str,
    language: &'static str,
}

/// Radar's languages (code as the app has them, name in that language).
const LANGUAGES: [(&str, &str); 8] = [
    ("de", "Deutsch"),
    ("en", "English"),
    ("fr", "Français"),
    ("es", "Español"),
    ("it", "Italiano"),
    ("pt", "Português"),
    ("pl", "Polski"),
    ("ru", "Русский"),
];

const EN: Texts = Texts {
    subtitle: "Your companion app for Destiny 2",
    privacy: "Radar reads parts of your screen while Destiny 2 runs; that stays on your PC. It connects to Bungie for your data, to its \
              login service (which counts users anonymously) and to GitHub for updates. Both can be turned off in Settings → Privacy.",
    privacy_link: "Privacy policy",
    open_source: "Open source (GPL-3.0)",
    desktop: "Create a desktop shortcut",
    install: "Install",
    update: "Update",
    reinstall: "Reinstall",
    installed: "is installed",
    installing: "Installing Radar …",
    done: "Radar is installed.",
    launch: "Start Radar",
    close: "Close",
    failed: "The installation failed",
    retry: "Try again",
    language: "Language (game data for it comes with the first start)",
};

const DE: Texts = Texts {
    subtitle: "Deine Begleit-App für Destiny 2",
    privacy: "Radar liest, während Destiny 2 läuft, Teile deines Bildschirms; das bleibt auf deinem PC. Es verbindet sich mit Bungie für \
              deine Daten, mit seinem Login-Dienst (der anonym mitzählt) und mit GitHub für Updates. Beides lässt sich unter \
              Einstellungen → Datenschutz abschalten.",
    privacy_link: "Datenschutzerklärung",
    open_source: "Open Source (GPL-3.0)",
    desktop: "Desktop-Verknüpfung erstellen",
    install: "Installieren",
    update: "Aktualisieren",
    reinstall: "Neu installieren",
    installed: "ist installiert",
    installing: "Radar wird installiert …",
    done: "Radar ist installiert.",
    launch: "Radar starten",
    close: "Schließen",
    failed: "Die Installation ist fehlgeschlagen",
    retry: "Erneut versuchen",
    language: "Sprache (ihre Spieldaten kommen beim ersten Start)",
};

#[derive(Clone)]
enum Step {
    Ready,
    Installing,
    Done,
    Failed(String),
}

struct Setup {
    t: &'static Texts,
    logo: TextureHandle,
    /// The version already installed, if any.
    installed: Option<String>,
    desktop: bool,
    /// The language Radar starts in (index into LANGUAGES).
    language: usize,
    step: Arc<Mutex<Step>>,
}

fn main() -> eframe::Result {
    let icon = image::load_from_memory(LOGO).expect("logo").to_rgba8();
    let (w, h) = icon.dimensions();
    let options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default()
            .with_title("Radar Setup")
            .with_inner_size([W, H])
            .with_resizable(false)
            .with_decorations(false)
            .with_icon(egui::IconData { rgba: icon.into_raw(), width: w, height: h }),
        centered: true,
        ..Default::default()
    };
    eframe::run_native("Radar Setup", options, Box::new(|cc| Ok(Box::new(Setup::new(cc)))))
}

impl Setup {
    fn new(cc: &eframe::CreationContext) -> Self {
        fonts(&cc.egui_ctx);
        let logo = image::load_from_memory(LOGO).expect("logo").to_rgba8();
        let size = [logo.width() as usize, logo.height() as usize];
        let logo = cc.egui_ctx.load_texture(
            "logo",
            egui::ColorImage::from_rgba_unmultiplied(size, logo.as_raw()),
            egui::TextureOptions::LINEAR,
        );
        let system = sys_locale::get_locale().unwrap_or_default().to_lowercase();
        let german = system.starts_with("de");
        // Windows' language if Radar has it, else English.
        let language = LANGUAGES.iter().position(|(code, _)| system.starts_with(code)).unwrap_or(1);
        Self {
            t: if german { &DE } else { &EN },
            logo,
            installed: registry("DisplayVersion"),
            desktop: true,
            language,
            step: Arc::new(Mutex::new(Step::Ready)),
        }
    }

    fn install(&self, ctx: &egui::Context) {
        *self.step.lock().unwrap() = Step::Installing;
        let step = self.step.clone();
        let ctx = ctx.clone();
        let desktop = self.desktop;
        let language = LANGUAGES[self.language].0;
        std::thread::spawn(move || {
            let result = run_installer(desktop).map(|()| remember_language(language));
            *step.lock().unwrap() = match result {
                Ok(()) => Step::Done,
                Err(e) => Step::Failed(e),
            };
            ctx.request_repaint();
        });
    }
}

/// Writes the bundled installer to the temp folder and runs it silently.
fn run_installer(desktop: bool) -> Result<(), String> {
    let path = std::env::temp_dir().join(format!("radar-{VERSION}-{}-setup.exe", std::process::id()));
    std::fs::write(&path, INSTALLER).map_err(|e| e.to_string())?;
    let mut cmd = Command::new(&path);
    cmd.arg("/S");
    if !desktop {
        cmd.arg("/NS");
    }
    let status = cmd.creation_flags(CREATE_NO_WINDOW).status().map_err(|e| e.to_string());
    let _ = std::fs::remove_file(&path);
    match status? {
        s if s.success() => Ok(()),
        s => Err(format!("code {}", s.code().unwrap_or(-1))),
    }
}

/// The language picked, for Radar's first start (it takes it over once:
/// %APPDATA%\app.radar.overlay\install-language.txt).
fn remember_language(code: &str) {
    if let Ok(appdata) = std::env::var("APPDATA") {
        let dir = PathBuf::from(appdata).join("app.radar.overlay");
        let _ = std::fs::create_dir_all(&dir);
        let _ = std::fs::write(dir.join("install-language.txt"), code);
    }
}

/// A value of Radar's entry under Windows' installed apps (per-user install).
fn registry(name: &str) -> Option<String> {
    let key = winreg::RegKey::predef(winreg::enums::HKEY_CURRENT_USER).open_subkey(UNINSTALL_KEY).ok()?;
    let value: String = key.get_value(name).ok()?;
    Some(value.trim_matches('"').to_string()).filter(|v| !v.is_empty())
}

fn launch_radar() {
    let dir = registry("InstallLocation").map(PathBuf::from);
    let exe = registry("MainBinaryName").unwrap_or_else(|| "radar.exe".into());
    if let Some(dir) = dir {
        let _ = Command::new(dir.join(exe)).current_dir(dir).spawn();
    }
}

fn open_url(url: &str) {
    let _ = Command::new("rundll32").args(["url.dll,FileProtocolHandler", url]).creation_flags(CREATE_NO_WINDOW).spawn();
}

/// Segoe UI like the app, falling back to egui's own font where it is missing.
fn fonts(ctx: &egui::Context) {
    let mut defs = FontDefinitions::default();
    let dir = PathBuf::from(std::env::var("WINDIR").unwrap_or_else(|_| r"C:\Windows".into())).join("Fonts");
    for (name, file, family) in [
        ("segoe", "segoeui.ttf", FontFamily::Proportional),
        ("segoe-semibold", "seguisb.ttf", FontFamily::Name("semibold".into())),
    ] {
        let fallback = defs.families.get(&FontFamily::Proportional).cloned().unwrap_or_default();
        let list = defs.families.entry(family).or_insert(fallback);
        if let Ok(bytes) = std::fs::read(dir.join(file)) {
            defs.font_data.insert(name.into(), Arc::new(FontData::from_owned(bytes)));
            list.insert(0, name.into());
        }
    }
    ctx.set_fonts(defs);
}

fn semibold(size: f32) -> FontId {
    FontId::new(size, FontFamily::Name("semibold".into()))
}

/// A flat button: filled with the accent, or quiet for the secondary one.
fn button(ui: &mut egui::Ui, label: &str, primary: bool, width: f32) -> bool {
    let (rect, response) = ui.allocate_exact_size(Vec2::new(width, 42.0), Sense::click());
    let hovered = response.hovered();
    let (fill, text) = if primary {
        (if hovered { Color32::from_rgb(255, 178, 92) } else { ACCENT }, BG)
    } else {
        (if hovered { Color32::from_rgb(30, 33, 42) } else { PANEL }, TEXT)
    };
    ui.painter().rect_filled(rect, CornerRadius::same(6), fill);
    ui.painter().text(rect.center(), Align2::CENTER_CENTER, label, semibold(15.0), text);
    if hovered {
        ui.ctx().set_cursor_icon(egui::CursorIcon::PointingHand);
    }
    response.clicked()
}

/// A flat checkbox in the app's style.
fn checkbox(ui: &mut egui::Ui, on: &mut bool, label: &str) {
    let (rect, response) = ui.allocate_exact_size(Vec2::new(ui.available_width(), 22.0), Sense::click());
    if response.clicked() {
        *on = !*on;
    }
    let bx = Rect::from_min_size(Pos2::new(rect.left(), rect.center().y - 8.0), Vec2::splat(16.0));
    if *on {
        ui.painter().rect_filled(bx, CornerRadius::same(4), ACCENT);
        let p = |x: f32, y: f32| Pos2::new(bx.left() + x, bx.top() + y);
        ui.painter().line(vec![p(4.0, 8.5), p(7.0, 11.5), p(12.5, 5.0)], Stroke::new(2.0, BG));
    } else {
        ui.painter().rect_filled(bx, CornerRadius::same(4), PANEL);
    }
    let color = if response.hovered() { TEXT } else { Color32::from_rgb(200, 204, 215) };
    ui.painter().text(Pos2::new(bx.right() + 10.0, rect.center().y), Align2::LEFT_CENTER, label, FontId::proportional(14.0), color);
    if response.hovered() {
        ui.ctx().set_cursor_icon(egui::CursorIcon::PointingHand);
    }
}

/// The languages as a row of small buttons, the picked one in the accent.
fn languages(ui: &mut egui::Ui, picked: &mut usize) {
    ui.horizontal_wrapped(|ui| {
        ui.spacing_mut().item_spacing = Vec2::new(6.0, 6.0);
        for (i, (_, name)) in LANGUAGES.iter().enumerate() {
            let font = FontId::proportional(13.0);
            let size = ui.painter().layout_no_wrap(name.to_string(), font.clone(), TEXT).size();
            let (rect, response) = ui.allocate_exact_size(Vec2::new(size.x + 18.0, 26.0), Sense::click());
            let on = *picked == i;
            let fill = if on { ACCENT } else if response.hovered() { Color32::from_rgb(30, 33, 42) } else { PANEL };
            ui.painter().rect_filled(rect, CornerRadius::same(5), fill);
            ui.painter().text(rect.center(), Align2::CENTER_CENTER, *name, font, if on { BG } else { TEXT });
            if response.hovered() {
                ui.ctx().set_cursor_icon(egui::CursorIcon::PointingHand);
            }
            if response.clicked() {
                *picked = i;
            }
        }
    });
}

fn link(ui: &mut egui::Ui, label: &str, url: &str) {
    let response = ui.add(egui::Label::new(RichText::new(label).size(13.0).color(ACCENT_TEXT)).sense(Sense::click()));
    if response.hovered() {
        ui.ctx().set_cursor_icon(egui::CursorIcon::PointingHand);
    }
    if response.clicked() {
        open_url(url);
    }
}

impl eframe::App for Setup {
    fn ui(&mut self, root: &mut egui::Ui, _frame: &mut eframe::Frame) {
        let ctx = &root.ctx().clone();
        let step = self.step.lock().unwrap().clone();
        let busy = matches!(step, Step::Installing);
        egui::CentralPanel::default().frame(egui::Frame::NONE.fill(BG)).show(root, |ui| {
            let full = ui.max_rect();
            ui.painter().rect_stroke(full.shrink(0.5), CornerRadius::ZERO, Stroke::new(1.0, LINE), egui::StrokeKind::Inside);

            // Title bar: drag to move, × to close.
            let bar = Rect::from_min_size(full.min, Vec2::new(full.width(), BAR));
            let close = Rect::from_min_size(Pos2::new(full.right() - 46.0, full.top()), Vec2::new(46.0, BAR));
            let drag = ui.interact(Rect::from_min_max(bar.min, Pos2::new(close.left(), bar.bottom())), ui.scope_id().with("drag"), Sense::drag());
            if drag.drag_started() {
                ctx.send_viewport_cmd(egui::ViewportCommand::StartDrag);
            }
            ui.painter().text(Pos2::new(full.left() + 16.0, bar.center().y), Align2::LEFT_CENTER, "Radar Setup", FontId::proportional(12.5), MUTED);
            let x = ui.interact(close, ui.scope_id().with("close"), Sense::click());
            if x.hovered() && !busy {
                ui.painter().rect_filled(close, CornerRadius::ZERO, Color32::from_rgb(196, 43, 28));
            }
            let c = close.center();
            let xs = Stroke::new(1.2, if busy { LINE } else if x.hovered() { Color32::WHITE } else { MUTED });
            ui.painter().line_segment([c + Vec2::new(-5.0, -5.0), c + Vec2::new(5.0, 5.0)], xs);
            ui.painter().line_segment([c + Vec2::new(5.0, -5.0), c + Vec2::new(-5.0, 5.0)], xs);
            if x.clicked() && !busy {
                ctx.send_viewport_cmd(egui::ViewportCommand::Close);
            }

            let inner = Rect::from_min_max(Pos2::new(full.left() + PAD, bar.bottom() + 10.0), Pos2::new(full.right() - PAD, full.bottom() - PAD));
            let mut ui = ui.new_child(egui::UiBuilder::new().max_rect(inner).layout(Layout::top_down(Align::Min)));

            // Header: logo, name, what it is, version.
            ui.horizontal(|ui| {
                ui.add(egui::Image::new(&self.logo).fit_to_exact_size(Vec2::splat(60.0)));
                ui.add_space(14.0);
                ui.vertical(|ui| {
                    ui.add_space(4.0);
                    ui.label(RichText::new("Radar").font(semibold(28.0)).color(TEXT));
                    ui.label(RichText::new(self.t.subtitle).size(14.0).color(MUTED));
                });
            });
            ui.add_space(6.0);
            let version = match &self.installed {
                Some(v) if v != VERSION && matches!(step, Step::Ready) => format!("{v} {} · Version {VERSION}", self.t.installed),
                _ => format!("Version {VERSION}"),
            };
            ui.label(RichText::new(version).size(12.5).color(ACCENT_TEXT));
            ui.add_space(18.0);

            let width = ui.available_width();
            match step {
                Step::Ready => {
                    ui.label(RichText::new(self.t.privacy).size(13.0).color(Color32::from_rgb(170, 175, 188)));
                    ui.add_space(6.0);
                    ui.horizontal(|ui| {
                        link(ui, self.t.privacy_link, PRIVACY_URL);
                        ui.label(RichText::new("·").size(13.0).color(MUTED));
                        link(ui, self.t.open_source, REPO_URL);
                    });
                    ui.with_layout(Layout::bottom_up(Align::Min), |ui| {
                        let label = match &self.installed {
                            Some(v) if v == VERSION => self.t.reinstall,
                            Some(_) => self.t.update,
                            None => self.t.install,
                        };
                        if button(ui, label, true, width) {
                            self.install(ctx);
                        }
                        ui.add_space(14.0);
                        checkbox(ui, &mut self.desktop, self.t.desktop);
                        ui.add_space(12.0);
                        // (Bottom-up: the buttons, then their label above.)
                        ui.with_layout(Layout::top_down(Align::Min), |ui| {
                            ui.label(RichText::new(self.t.language).size(12.5).color(MUTED));
                            ui.add_space(4.0);
                            languages(ui, &mut self.language);
                        });
                    });
                }
                Step::Installing => {
                    ui.with_layout(Layout::bottom_up(Align::Min), |ui| {
                        // A segment sliding along a flat track.
                        let (track, _) = ui.allocate_exact_size(Vec2::new(width, 4.0), Sense::hover());
                        ui.painter().rect_filled(track, CornerRadius::same(2), PANEL);
                        let t = (ctx.input(|i| i.time) * 0.7).fract() as f32;
                        let seg = width * 0.28;
                        let left = track.left() - seg + t * (width + seg);
                        let piece = Rect::from_min_max(
                            Pos2::new(left.max(track.left()), track.top()),
                            Pos2::new((left + seg).min(track.right()), track.bottom()),
                        );
                        ui.painter().rect_filled(piece, CornerRadius::same(2), ACCENT);
                        ui.add_space(14.0);
                        ui.label(RichText::new(self.t.installing).size(14.0).color(TEXT));
                    });
                    ctx.request_repaint();
                }
                Step::Done => {
                    ui.with_layout(Layout::bottom_up(Align::Min), |ui| {
                        let half = (width - 12.0) / 2.0;
                        ui.horizontal(|ui| {
                            if button(ui, self.t.launch, true, half) {
                                launch_radar();
                                ctx.send_viewport_cmd(egui::ViewportCommand::Close);
                            }
                            ui.add_space(12.0 - ui.spacing().item_spacing.x);
                            if button(ui, self.t.close, false, half) {
                                ctx.send_viewport_cmd(egui::ViewportCommand::Close);
                            }
                        });
                        ui.add_space(14.0);
                        ui.label(RichText::new(self.t.done).size(15.0).color(TEXT));
                    });
                }
                Step::Failed(why) => {
                    ui.with_layout(Layout::bottom_up(Align::Min), |ui| {
                        if button(ui, self.t.retry, true, width) {
                            self.install(ctx);
                        }
                        ui.add_space(14.0);
                        ui.label(RichText::new(format!("{} ({why}).", self.t.failed)).size(14.0).color(TEXT));
                    });
                }
            }
        });
    }
}
