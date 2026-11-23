//! Feedback (the button in the top bar): a bug report or feature
//! request, what the player wrote with the app and Windows version, goes to
//! the website's /api/report, which makes a public issue of it on D2Radar
//! (the GitHub token is kept there, never in the app). No name, id or log
//! goes along. The reported ones are listed from D2Radar's public issues.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::{json, Value};
use tauri::AppHandle;

const REPORT_SERVICE: &str = match option_env!("RADAR_REPORT_SERVICE") {
    Some(url) => url,
    None => "https://d2radar.vercel.app/api/report",
};
/// The newest issues of the public repository (pull requests among them,
/// left out below). Without a token: 60 a hour per address, so kept a while.
const ISSUES: &str = "https://api.github.com/repos/Niklas2654/D2Radar/issues?state=all&per_page=100&sort=created&direction=desc";
const KEEP: Duration = Duration::from_secs(120);

static CACHE: Mutex<Option<(Instant, Vec<Entry>)>> = Mutex::new(None);
/// What was sent from here: GitHub answers without a token from a cache of
/// up to a minute, so a new issue can be missing from the list for a while.
/// Shown until the list has it.
static SENT: Mutex<Vec<Entry>> = Mutex::new(Vec::new());

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .user_agent(concat!("radar/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|_| "network".to_string())
}

/// Sends a report (`kind`: "bug" or "feature"); the issue's address. On
/// failure the reason as a short code for the page: "too_many",
/// "too_short", "network" or another the service gave.
#[tauri::command]
pub async fn report_send(app: AppHandle, kind: String, text: String) -> Result<Option<String>, String> {
    let kind = if kind == "feature" { "feature" } else { "bug" };
    let body = json!({
        "kind": kind,
        "text": text,
        "version": app.package_info().version.to_string(),
        "os": windows_version(),
    });
    let res = client()?.post(REPORT_SERVICE).json(&body).send().await.map_err(|_| "network".to_string())?;
    let status = res.status();
    let answer: Option<Value> = res.json().await.ok();
    if status.is_success() {
        let url = answer.and_then(|v| v["url"].as_str().map(str::to_string));
        if let Some(entry) = url.as_deref().and_then(|url| sent(kind, &text, url)) {
            SENT.lock().unwrap().push(entry);
        }
        return Ok(url);
    }
    Err(answer
        .and_then(|v| v["error"].as_str().map(str::to_string))
        .unwrap_or_else(|| format!("http_{}", status.as_u16())))
}

/// A reported bug or wished feature.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    number: u64,
    /// "bug" or "feature".
    kind: &'static str,
    title: String,
    body: String,
    /// "open", "done" (fixed / built) or "closed" (not planned, a duplicate).
    state: &'static str,
    created: String,
    comments: u64,
    url: String,
}

/// The reported bugs and wished features, newest first. On failure
/// "network" or "rate_limited".
#[tauri::command]
pub async fn report_list(fresh: bool) -> Result<Vec<Entry>, String> {
    if !fresh {
        if let Some((at, list)) = CACHE.lock().unwrap().as_ref() {
            if at.elapsed() < KEEP {
                return Ok(with_sent(list.clone()));
            }
        }
    }
    let res = client()?
        .get(ISSUES)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|_| "network".to_string())?;
    let status = res.status().as_u16();
    if status == 403 || status == 429 {
        return Err("rate_limited".into());
    }
    if !res.status().is_success() {
        return Err(format!("http_{status}"));
    }
    let items: Vec<Value> = res.json().await.map_err(|_| "network".to_string())?;
    let list: Vec<Entry> = items.iter().filter_map(entry).collect();
    *CACHE.lock().unwrap() = Some((Instant::now(), list.clone()));
    Ok(with_sent(list))
}

/// The list with what was sent from here and isn't in it yet, newest first.
fn with_sent(mut list: Vec<Entry>) -> Vec<Entry> {
    let mut sent = SENT.lock().unwrap();
    sent.retain(|e| !list.iter().any(|l| l.number == e.number));
    for entry in sent.iter() {
        list.insert(0, entry.clone());
    }
    list
}

/// An entry for a report just sent, as /api/report made its issue (the
/// number from the issue's address).
fn sent(kind: &'static str, text: &str, url: &str) -> Option<Entry> {
    let number = url.rsplit('/').next()?.parse().ok()?;
    let text = text.trim();
    let first = text.lines().map(str::trim).find(|l| !l.is_empty()).unwrap_or(text);
    let mut title: String = first.chars().take(80).collect();
    if first.chars().count() > 80 {
        title.push('…');
    }
    Some(Entry {
        number,
        kind,
        title,
        body: text.to_string(),
        state: "open",
        created: chrono::Utc::now().to_rfc3339(),
        comments: 0,
        url: url.to_string(),
    })
}

/// An issue as an entry: one of ours by its label (or, if the label
/// couldn't be set, its title's start); not pull requests, not others.
fn entry(issue: &Value) -> Option<Entry> {
    if issue.get("pull_request").is_some() {
        return None;
    }
    let title = issue["title"].as_str()?;
    let labels: Vec<&str> = issue["labels"]
        .as_array()
        .map(|all| all.iter().filter_map(|l| l["name"].as_str()).collect())
        .unwrap_or_default();
    let (kind, title) = if labels.contains(&"feature-request") || title.starts_with("Feature:") {
        ("feature", title.strip_prefix("Feature:").unwrap_or(title))
    } else if labels.contains(&"bug-report") || title.starts_with("Bug:") {
        ("bug", title.strip_prefix("Bug:").unwrap_or(title))
    } else {
        return None;
    };
    let state = match (issue["state"].as_str(), issue["state_reason"].as_str()) {
        (Some("open"), _) => "open",
        (_, Some("not_planned" | "duplicate")) => "closed",
        _ => "done",
    };
    Some(Entry {
        number: issue["number"].as_u64()?,
        kind,
        title: title.trim().to_string(),
        body: without_footer(issue["body"].as_str().unwrap_or("")).to_string(),
        state,
        created: issue["created_at"].as_str().unwrap_or("").to_string(),
        comments: issue["comments"].as_u64().unwrap_or(0),
        url: issue["html_url"].as_str().unwrap_or("").to_string(),
    })
}

/// A report's text without the line /api/report adds ("Radar 1.6.3 · …").
fn without_footer(body: &str) -> &str {
    let body = body.trim_end();
    match body.rsplit_once("\n---\n") {
        Some((text, footer)) if footer.trim_start().starts_with("Radar ") => text.trim_end(),
        _ => body,
    }
}

/// "Windows 11 (10.0.26200)": the real version (RtlGetVersion isn't
/// shimmed like GetVersionEx).
fn windows_version() -> String {
    use windows::Wdk::System::SystemServices::RtlGetVersion;
    use windows::Win32::System::SystemInformation::OSVERSIONINFOW;
    let mut info = OSVERSIONINFOW {
        dwOSVersionInfoSize: std::mem::size_of::<OSVERSIONINFOW>() as u32,
        ..Default::default()
    };
    if unsafe { RtlGetVersion(&mut info) }.is_err() {
        return "Windows".into();
    }
    let (major, minor, build) = (info.dwMajorVersion, info.dwMinorVersion, info.dwBuildNumber);
    let name = if major == 10 && build >= 22000 { "Windows 11" } else if major == 10 { "Windows 10" } else { "Windows" };
    format!("{name} ({major}.{minor}.{build})")
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    #[test]
    fn issues_as_entries() {
        let bug = json!({
            "number": 3, "title": "Bug: Overlay flackert", "labels": [{ "name": "bug-report" }],
            "state": "closed", "state_reason": "completed", "comments": 2,
            "body": "Beim Start.\n\n---\nRadar 1.6.3 · Windows 11 (10.0.26200) · _sent from Radar_",
            "created_at": "2026-11-23T10:00:00Z", "html_url": "https://github.com/x/y/issues/3",
        });
        let e = super::entry(&bug).unwrap();
        assert_eq!((e.kind, e.title.as_str(), e.state, e.body.as_str()), ("bug", "Overlay flackert", "done", "Beim Start."));
        // Not ours: a pull request, an issue without our label or title.
        assert!(super::entry(&json!({ "number": 4, "title": "Bug: x", "pull_request": {} })).is_none());
        assert!(super::entry(&json!({ "number": 5, "title": "Other", "labels": [] })).is_none());
        let wish = json!({ "number": 6, "title": "Feature: Dark mode", "state": "open" });
        assert_eq!(super::entry(&wish).unwrap().kind, "feature");
        // A "---" of the player's own stays.
        assert_eq!(super::without_footer("a\n---\nb"), "a\n---\nb");
    }

    #[test]
    fn sent_until_listed() {
        let e = super::sent("feature", "\n  Dark mode\nfor the overlay ", "https://github.com/x/y/issues/7").unwrap();
        assert_eq!((e.number, e.title.as_str(), e.body.as_str(), e.state), (7, "Dark mode", "Dark mode\nfor the overlay", "open"));
        super::SENT.lock().unwrap().push(e.clone());
        // Not in GitHub's list yet: shown first; once it is, from there.
        assert_eq!(super::with_sent(Vec::new()).len(), 1);
        assert_eq!(super::with_sent(vec![e]).len(), 1);
        assert!(super::SENT.lock().unwrap().is_empty());
    }
}
