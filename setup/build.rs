//! Embeds the NSIS installer Tauri built for the current version, and Radar's icon.
use std::path::PathBuf;

fn main() {
    let conf = std::fs::read_to_string("../src-tauri/tauri.conf.json").expect("tauri.conf.json");
    let version = conf
        .split("\"version\": \"")
        .nth(1)
        .and_then(|rest| rest.split('"').next())
        .expect("version in tauri.conf.json")
        .to_string();
    let installer = std::env::var("RADAR_INSTALLER").map(PathBuf::from).unwrap_or_else(|_| {
        PathBuf::from(format!("../src-tauri/target/release/bundle/nsis/Radar_{version}_x64-setup.exe"))
    });
    let installer = installer.canonicalize().unwrap_or_else(|_| {
        panic!("{} not found: build the app first (pnpm tauri build)", installer.display())
    });
    println!("cargo:rustc-env=RADAR_VERSION={version}");
    println!("cargo:rustc-env=RADAR_INSTALLER_PATH={}", installer.display());
    println!("cargo:rerun-if-changed=../src-tauri/tauri.conf.json");
    println!("cargo:rerun-if-changed={}", installer.display());
    println!("cargo:rerun-if-env-changed=RADAR_INSTALLER");

    let mut res = winresource::WindowsResource::new();
    res.set_icon("../src-tauri/icons/icon.ico");
    res.set("ProductName", "Radar Setup");
    res.set("FileDescription", "Radar Setup");
    res.compile().expect("windows resources");
}
