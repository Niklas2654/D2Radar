// Radar's own Bungie app (API key, OAuth client id) is built into the
// binary, so players don't register one themselves. From the environment
// (GitHub Actions: the repo's secrets) or, locally, from bungie.local.json
// next to this file (not in git). Without them the app asks for its own.
// The client secret is never in a released build: its logins go through the
// website's token service (oauth.rs). Only a local build may have it, to log
// in without the service (clientSecret in bungie.local.json).
const KEYS: [(&str, &str); 4] = [
    ("RADAR_BUNGIE_API_KEY", "apiKey"),
    ("RADAR_BUNGIE_CLIENT_ID", "clientId"),
    ("RADAR_BUNGIE_CLIENT_SECRET", "clientSecret"),
    ("RADAR_TOKEN_SERVICE", "tokenService"),
];

fn main() {
    println!("cargo:rerun-if-changed=bungie.local.json");
    let local: Option<serde_json::Value> = std::fs::read_to_string("bungie.local.json")
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok());
    for (env, field) in KEYS {
        println!("cargo:rerun-if-env-changed={env}");
        let value = std::env::var(env)
            .ok()
            .filter(|v| !v.is_empty())
            .or_else(|| local.as_ref()?.get(field)?.as_str().map(String::from));
        if let Some(value) = value {
            println!("cargo:rustc-env={env}={value}");
        }
    }
    tauri_build::build()
}
