//! Discord embedded as a child webview of the main window (the normal Discord
//! web app: the player logs in themselves, e.g. with the QR code), plus
//! Radar's own channel bar: pinned channels (just their address and name)
//! to jump to, and a focus mode that hides Discord's server / channel lists.
//!
//! Radar never acts for the account: it navigates its own webview, looks at
//! its address and title, and reads the messages shown, only locally, to put
//! join buttons on "/join Name#1234" commands. Nothing is sent or stored.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::webview::{NewWindowResponse, WebviewBuilder};
use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, Url, Webview, WebviewUrl};

use crate::i18n::tr;

const LABEL: &str = "discord";

/// Radar's language for the texts the scripts show in Discord.
fn lang_script() -> String {
    let verb = join_verb(&GAME_LANG.lock().unwrap());
    format!("window.__radarLang = '{}'; window.__radarJoinVerb = '{verb}';", crate::i18n::locale())
}

/// Destiny's language on this PC: its chat commands are translated, so a
/// join button copies the command the game understands.
static GAME_LANG: Mutex<String> = Mutex::new(String::new());

fn join_verb(lang: &str) -> &'static str {
    match lang {
        "de" => "/beitreten",
        "fr" => "/rejoindre",
        "zh" => "/加入",
        _ => "/join",
    }
}

/// The language changed in Radar: Discord's texts follow at once.
pub(crate) fn push_language(app: &AppHandle) {
    if let Some(webview) = app.get_webview(LABEL) {
        let _ = webview.eval(lang_script());
    }
    if let Some(window) = app.get_webview_window(GAME_LABEL) {
        let _ = window.eval(lang_script());
        let _ = window.eval(pins_script(app));
    }
}
const HOME: &str = "https://discord.com/app";

/// Focus mode: Discord's own server and channel lists (and the member
/// list) hidden, so only the chat of the open channel shows. Discord's
/// class names are hashed but keep their prefix.
const SCRIPT: &str = r##"
(() => {
  // Width of the voice channels' bar on the right (focus mode).
  const VOICE = 230;
  // Focus mode lives in its own stylesheet, switched on and off (Discord
  // rewrites the classes on <html>, so a class there wouldn't stick).
  const focusCss = `
    :root, .theme-dark, .theme-midnight, .visual-refresh { --custom-app-top-bar-height: 0px !important; }
    div[class*="base__"] { grid-template-rows: [top] 0 [titleBarEnd] min-content [noticeEnd] 1fr [end] !important; }
    div[class*="base__"] > :not([class*="content__"]),
    nav[class*="guilds_"],
    div[class^="membersWrap_"], div[class*=" membersWrap_"] { display: none !important; }
    /* The channel list: out of sight, but still drawn (the voice channels
       on the right are read from it). */
    div[class^="sidebar_"], div[class*=" sidebar_"] {
      position: fixed !important; left: -10000px !important; top: 0 !important;
      /* Tall: Discord draws only the part of its list that fits. */
      height: 40000px !important; width: 260px !important; visibility: hidden !important;
    }
`;
  // Room on the right for the voice channels: only on a server's channel in
  // focus mode (not on the login page, direct messages…); see renderVoice.
  const voiceRoomCss = `
    #app-mount { width: calc(100% - var(--radar-left, 0px) - ${VOICE}px) !important; }
    #radar-voice { display: flex !important; }`;
  const baseCss = `
    /* Discord's own account bar (mute, deafen, settings) at the bottom
       left: not here (it covered the channel list; muting goes through
       Discord itself). */
    section[class*="panels_"] { display: none !important; }
    /* The server bar (shown while picking channels): Radar's dark glass,
       not Discord's own tinted colour. */
    nav[class*="guilds_"], nav[class*="guilds_"] [class*="scroller"], nav[class*="guilds_"] [class*="itemsContainer"] {
      background: rgb(8 10 15 / 0.45) !important;
    }
    /* (Its list paints a tinted gradient of its own.) */
    nav[class*="guilds_"] [class*="tree_"] { background: transparent !important; background-image: none !important; }
    /* Server folders: Radar's quiet panels. */
    nav[class*="guilds_"] [class*="expandedFolderBackground"],
    nav[class*="guilds_"] [class*="folderIconWrapper"] {
      background: rgb(255 255 255 / 0.04) !important;
      border: 1px solid rgb(255 255 255 / 0.07) !important;
      border-radius: 14px !important;
    }
    ::-webkit-scrollbar { width: 10px; height: 10px; }
    ::-webkit-scrollbar-track, ::-webkit-scrollbar-corner { background: transparent; }
    ::-webkit-scrollbar-thumb { border: 3px solid transparent; border-radius: 999px; background: rgb(255 255 255 / 0.18) padding-box; }
    ::-webkit-scrollbar-thumb:hover { border-width: 2px; background: rgb(255 255 255 / 0.42) padding-box; }`;
  // Radar's look: Discord's color variables overridden (a theme, like a
  // userstyle), backgrounds see-through so Radar's glass panel shows, Radar's
  // font, and the accent color (set by the app via __radarAccent).
  const themeCss = `
    :root, .theme-dark, .theme-midnight, .theme-darker, .visual-refresh {
      --font-primary: "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif !important;
      --font-display: "Segoe UI Variable Display", "Segoe UI", system-ui, sans-serif !important;
      --text-normal: rgb(240 242 248);
      --text-default: rgb(240 242 248);
      --header-primary: #fff;
      --text-muted: rgb(255 255 255 / 0.45);
      --border-subtle: rgb(255 255 255 / 0.07);
      --border-faint: rgb(255 255 255 / 0.05);
      --border-normal: rgb(255 255 255 / 0.1);
      --brand-500: var(--radar-accent);
      --brand-560: var(--radar-accent);
      --brand-experiment: var(--radar-accent);
      --brand-experiment-560: var(--radar-accent);
      --control-brand-foreground: var(--radar-accent);
      --control-brand-foreground-new: var(--radar-accent);
      --button-filled-brand-background: var(--radar-accent);
      --button-filled-brand-background-hover: var(--radar-accent);
      --text-link: var(--radar-accent);
      --mention-foreground: var(--radar-accent);
    }
    /* See-through backgrounds only in the main view (chat, header); popups,
       menus and dialogs live in other layers and stay solid. */
    div[class*="baseLayer__"], div[class*="baseLayer__"] [class*="theme-"], div[class*="baseLayer__"] [class*="visual-refresh"] {
      --background-primary: transparent !important;
      --background-secondary: transparent !important;
      --background-secondary-alt: rgb(255 255 255 / 0.03) !important;
      --background-tertiary: transparent !important;
      --background-base-lowest: transparent !important;
      --background-base-lower: transparent !important;
      --background-base-low: transparent !important;
      --background-surface-high: rgb(255 255 255 / 0.05) !important;
      --background-surface-higher: rgb(255 255 255 / 0.07) !important;
      --background-surface-highest: rgb(255 255 255 / 0.09) !important;
      --chat-background: transparent !important;
      /* The player's Discord color theme paints these (the message
         placeholders while a channel loads were teal with one). */
      --background-gradient-chat: transparent !important;
      --background-gradient-lowest: transparent !important;
      --background-gradient-lower: transparent !important;
      --background-gradient-low: transparent !important;
      --background-gradient-high: transparent !important;
      --background-gradient-higher: transparent !important;
      --background-gradient-highest: transparent !important;
      --chat-background-default: transparent !important;
      --channeltextarea-background: rgb(255 255 255 / 0.05) !important;
      --background-message-hover: rgb(255 255 255 / 0.03) !important;
      --background-mod-subtle: rgb(255 255 255 / 0.04) !important;
      --background-mod-normal: rgb(255 255 255 / 0.06) !important;
      --background-mod-strong: rgb(255 255 255 / 0.09) !important;
      --background-floating: #15171c !important;
      --background-nested-floating: #1b1d23 !important;
      --modal-background: #15171c !important;
      --modal-footer-background: #121419 !important;
    }
    html, body, div[class*="bg__"] { background: transparent !important; }
    /* Radar's own window background (dark, a glow in the accent color, a
       cool blue below). Square: cut round, its corners showed the window
       behind in another colour. */
    #app-mount {
      background:
        radial-gradient(60rem 40rem at 85% -10%, color-mix(in oklab, var(--radar-accent) 10%, transparent), transparent 60%),
        radial-gradient(40rem 30rem at -10% 110%, rgb(150 90 255 / 0.07), transparent 60%),
        #05070c !important;
    }
    /* The message box in Radar's glass look (Discord themes and Nitro
       colors would tint it otherwise). */
    div[class*="baseLayer__"] div[class*="channelTextArea_"],
    div[class*="baseLayer__"] div[class*="channelTextArea_"] div[class*="scrollableContainer_"],
    div[class*="baseLayer__"] div[class*="channelTextArea_"] div[class*="themedBackground_"] {
      /* On a solid base: messages scrolling beneath must not show through. */
      background: linear-gradient(145deg, rgb(255 255 255 / 0.06), rgb(255 255 255 / 0.02)), #0b0e14 !important;
    }
    div[class*="baseLayer__"] div[class*="channelTextArea_"] {
      border: 1px solid rgb(255 255 255 / 0.09) !important;
      border-radius: 14px !important;
      box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.06), 0 10px 30px -14px rgb(0 0 0 / 0.9) !important;
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    div[class*="baseLayer__"] div[class*="channelTextArea_"] div[class*="scrollableContainer_"],
    div[class*="baseLayer__"] div[class*="channelTextArea_"] div[class*="themedBackground_"] {
      background: transparent !important;
      border-radius: 14px !important;
    }
    div[class*="baseLayer__"] div[class*="channelTextArea_"]:focus-within {
      border-color: color-mix(in oklab, var(--radar-accent) 55%, transparent) !important;
      box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.08), 0 0 22px -8px color-mix(in oklab, var(--radar-accent) 55%, transparent) !important;
    }
    /* Nothing in the main view paints over that (Discord color themes put
       their gradients on these containers and their pseudo-elements). */
    div[class*="app__"],
    div[class*="baseLayer__"] div[class*="page_"],
    div[class*="baseLayer__"] div[class*="chat_"],
    div[class*="baseLayer__"] div[class*="content_"],
    div[class*="baseLayer__"] main[class*="chatContent_"],
    div[class*="baseLayer__"] div[class*="messagesWrapper_"],
    div[class*="baseLayer__"] div[class*="scroller"],
    div[class*="baseLayer__"] form[class*="form_"],
    div[class*="baseLayer__"] div[class*="container__"],
    div[class*="baseLayer__"] div[class*="base__"],
    div[class*="baseLayer__"] [class*="customTheme"] {
      background-color: transparent !important;
      background-image: none !important;
    }
    div[class*="baseLayer__"] [class*="customTheme"]::before,
    div[class*="baseLayer__"] [class*="customTheme"]::after { display: none !important; }
    /* The player's own Discord color theme (Nitro gradients) paints the chat
       through these overlays; Radar's look replaces it. */
    div[class*="baseLayer__"], div[class*="baseLayer__"] [class*="customTheme"] {
      --custom-theme-background: none !important;
      --bg-overlay-chat: transparent !important;
      --bg-overlay-app-frame: transparent !important;
      --bg-overlay-1: transparent !important;
      --bg-overlay-2: transparent !important;
      --bg-overlay-3: transparent !important;
      --bg-overlay-4: transparent !important;
      --bg-overlay-5: transparent !important;
      --bg-overlay-6: transparent !important;
      --bg-overlay-hover: rgb(255 255 255 / 0.04) !important;
      --bg-overlay-active: rgb(255 255 255 / 0.06) !important;
      --bg-overlay-selected: rgb(255 255 255 / 0.08) !important;
    }
    div[class*="baseLayer__"] [class*="customTheme"], .custom-theme-background, [class*="customThemeBackground"] {
      background: none !important;
      background-image: none !important;
    }
    /* Channel header stays readable over messages scrolling beneath it. */
    section[class*="title_"] { background: rgb(14 16 22 / 0.55) !important; border-bottom: 1px solid rgb(255 255 255 / 0.06) !important; }
    /* Message box: a glass field like Radar's inputs. */
    form[class*="form_"] [class*="channelTextArea_"] {
      border-radius: 14px !important;
      border: 1px solid rgb(255 255 255 / 0.08) !important;
      background: #10131a !important;
    }
    /* The message box covers what scrolls beneath it (it was see-through:
       messages showed through the field). */
    div[class*="baseLayer__"] form[class*="form_"] {
      background-color: #05070c !important;
    }
    /* "New messages since …": a dark glass bar with the accent, not a
       solid bar in it. */
    div[class*="newMessagesBar_"] {
      border-radius: 12px !important;
      background: rgb(14 16 22 / 0.88) !important;
      border: 1px solid color-mix(in oklab, var(--radar-accent) 45%, transparent) !important;
      color: color-mix(in oklab, var(--radar-accent) 58%, white) !important;
      box-shadow: 0 8px 24px -12px rgb(0 0 0 / 0.9) !important;
    }
    div[class*="newMessagesBar_"] * { color: inherit !important; }
    /* Side panels (search results, threads, pins, member list): Radar's
       dark glass, like the chat. Discord paints them in its own (or the
       player's theme) colors otherwise. */
    div[class*="baseLayer__"] [class*="searchResultsWrap"],
    div[class*="baseLayer__"] [class*="sidebarRight"],
    div[class*="baseLayer__"] [class*="threadSidebar"],
    div[class*="baseLayer__"] [class*="membersWrap_"],
    div[class*="baseLayer__"] aside[class*="members"] {
      background: rgb(10 12 18 / 0.72) !important;
      border-left: 1px solid rgb(255 255 255 / 0.07) !important;
    }
    div[class*="baseLayer__"] [class*="searchResultsWrap"] [class*="searchHeader"],
    div[class*="baseLayer__"] [class*="searchResultsWrap"] [class*="scroller"],
    div[class*="baseLayer__"] [class*="searchResultsWrap"] [class*="searchResults_"],
    div[class*="baseLayer__"] [class*="searchResultsWrap"] [class*="channelSeparator"],
    div[class*="baseLayer__"] [class*="searchResultsWrap"] [class*="channelName"],
    div[class*="baseLayer__"] [class*="searchResultsWrap"] [class*="paginationContainer"],
    div[class*="baseLayer__"] [class*="searchResultsWrap"] [class*="container_"],
    div[class*="baseLayer__"] [class*="searchResultsWrap"] [class*="message_"] {
      background-color: transparent !important;
      background-image: none !important;
    }
    /* Each result: a glass card. */
    div[class*="baseLayer__"] [class*="searchResultsWrap"] [class*="searchResult_"] {
      background: linear-gradient(145deg, rgb(255 255 255 / 0.05), rgb(255 255 255 / 0.02)) !important;
      border: 1px solid rgb(255 255 255 / 0.07) !important;
      border-radius: 12px !important;
      box-shadow: none !important;
    }
    div[class*="baseLayer__"] [class*="searchResultsWrap"] [class*="searchResult_"]:hover {
      border-color: rgb(255 255 255 / 0.14) !important;
    }
    div[class*="baseLayer__"] [class*="searchResultsWrap"] [class*="searchHeader"] {
      border-bottom: 1px solid rgb(255 255 255 / 0.07) !important;
    }
    /* Search hits highlighted in the accent, not Discord's yellow. */
    div[class*="baseLayer__"] [class*="searchResultsWrap"] [class*="highlight"] {
      background: color-mix(in oklab, var(--radar-accent) 30%, transparent) !important;
      color: #fff !important;
      border-radius: 4px;
    }
    /* Popups (profiles, menus, dialogs) always solid. */
    div[class*="layerContainer_"] > div > [class*="popout"],
    div[class*="layerContainer_"] [class*="userPopout"],
    div[class*="layerContainer_"] [class*="userProfileOuter"],
    div[class*="layerContainer_"] [role="dialog"] { background-color: #15171c !important; }
    /* Menus and popups: Radar's dark panels. */
    [class*="menu_"], [class*="popout"], [class*="modal_"], [role="dialog"] {
      border: 1px solid rgb(255 255 255 / 0.1) !important;
      border-radius: 14px !important;
    }`;
  const KEY = "radarFocus";
  let focus = true;
  try { focus = localStorage.getItem(KEY) !== "0"; } catch {}
  let focusStyle = null;
  let accentStyle = null;
  let accent = "#ff9f2e";
  try { accent = localStorage.getItem("radarAccent") || accent; } catch {}
  // The look from the very first paint: the styles go in as soon as there
  // is a document (not on DOMContentLoaded: Discord drew its own look
  // first, then switched). Kept after Discord's own stylesheets, which it
  // keeps loading later, so equal rules stay Radar's.
  const base = document.createElement("style");
  base.textContent = baseCss + themeCss;
  accentStyle = document.createElement("style");
  accentStyle.textContent = `:root { --radar-accent: ${accent}; }`;
  focusStyle = document.createElement("style");
  focusStyle.id = "radar-focus";
  focusStyle.textContent = focusCss;
  focusStyle.disabled = !focus;
  const voiceRoom = document.createElement("style");
  voiceRoom.id = "radar-voice-room";
  voiceRoom.textContent = voiceRoomCss;
  voiceRoom.disabled = true;
  // While Discord starts (its loading screen, before the main view exists
  // that themeCss's see-through backgrounds are scoped to): see-through
  // everywhere, so it starts in Radar's look too. Off once the main view
  // is there (popups and menus need their solid backgrounds).
  const loading = document.createElement("style");
  loading.textContent = `
    :root, .theme-dark, .theme-midnight, .theme-darker, .visual-refresh {
      --background-primary: transparent !important;
      --background-secondary: transparent !important;
      --background-tertiary: transparent !important;
      --background-base-lowest: transparent !important;
      --background-base-lower: transparent !important;
      --background-base-low: transparent !important;
      --background-gradient-chat: transparent !important;
    }
    #app-mount *:not(img):not(video):not(canvas) { background-color: transparent !important; }`;
  // (focusStyle last: place() checks for it.)
  const ours = [loading, base, accentStyle, voiceRoom, focusStyle];
  const loaded = () => {
    if (!document.querySelector('div[class*="baseLayer__"]')) return false;
    loading.remove();
    ours.shift();
    return true;
  };
  const place = () => {
    const parent = document.head || document.documentElement;
    if (!parent || parent.lastElementChild === focusStyle) return;
    parent.append(...ours);
    focusStyle.disabled = !focus;
  };
  const watchHead = () => {
    place();
    if (!document.head) return;
    new MutationObserver((changes) => {
      // place() does nothing while ours are still last (its own append).
      if (changes.some((c) => [...c.addedNodes].some((n) => n.nodeName === "STYLE" || n.nodeName === "LINK"))) place();
    }).observe(document.head, { childList: true });
  };
  const start = () => {
    place();
    if (!loaded()) {
      new MutationObserver((_, o) => { if (loaded()) o.disconnect(); }).observe(document.documentElement, { childList: true, subtree: true });
    }
  };
  if (document.documentElement) start();
  else new MutationObserver((_, o) => { if (document.documentElement) { o.disconnect(); start(); } }).observe(document, { childList: true });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", watchHead, { once: true });
  else watchHead();
  window.__radarAccent = (color) => {
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) return;
    accent = color;
    try { localStorage.setItem("radarAccent", color); } catch {}
    if (accentStyle) accentStyle.textContent = `:root { --radar-accent: ${accent}; }`;
  };
  window.__radarFocus = (on) => {
    const was = focus;
    focus = !!on;
    try { localStorage.setItem(KEY, focus ? "1" : "0"); } catch {}
    if (focusStyle) focusStyle.disabled = !focus;
    try { growChannelList(); } catch {}
    // The channel list changes size (hidden it is drawn very tall): its
    // scroller is told, or it keeps the old height (no scrolling until
    // the next channel switch).
    if (was !== focus) {
      const nudge = () => dispatchEvent(new Event("resize"));
      requestAnimationFrame(nudge);
      setTimeout(nudge, 120);
      setTimeout(nudge, 400);
    }
  };

  // Warming the pinned channels: each opened once through Discord's router
  // while Discord is hidden, so it keeps their messages and switching to
  // one later shows them at once instead of loading. Only while hidden;
  // stops (back to where it was) as soon as Discord is shown.
  let warming = false;
  const go = (path) => {
    history.pushState(null, "", path);
    dispatchEvent(new PopStateEvent("popstate", { state: null }));
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  window.__radarWarm = async (paths) => {
    if (warming) return;
    warming = true;
    try {
      // Discord up and signed in (its main view there), and hidden.
      for (let i = 0; i < 60 && !document.querySelector('div[class*="baseLayer__"]'); i++) await sleep(500);
      await sleep(1500);
      if (document.visibilityState !== "hidden") return;
      const home = location.pathname + location.search;
      for (const path of paths) {
        if (document.visibilityState !== "hidden") break;
        if (path === location.pathname) continue;
        const channel = path.split("/")[3];
        if (!channel) continue;
        go(path);
        // Until its messages are there (or a while has passed).
        for (let i = 0; i < 30 && !document.querySelector(`[id^="chat-messages-${channel}-"]`); i++) {
          if (document.visibilityState !== "hidden") break;
          await sleep(200);
        }
        // For checking from outside (devtools): what got warmed.
        (window.__radarWarmed ||= []).push(channel + (document.querySelector(`[id^="chat-messages-${channel}-"]`) ? "" : " (timeout)"));
        await sleep(300);
      }
      if (location.pathname + location.search !== home) go(home);
    } finally {
      warming = false;
    }
  };

  // The servers in Discord's server list (hidden in focus mode, still
  // there): id -> name and icon, for grouping the pinned channels.
  window.__radarGuilds = () => {
    const out = {};
    for (const el of document.querySelectorAll('[data-list-item-id^="guildsnav___"]')) {
      const id = el.getAttribute("data-list-item-id").slice("guildsnav___".length);
      if (!/^\d+$/.test(id)) continue;
      const name = (el.textContent || "").trim();
      const img = el.querySelector("img");
      if (name) out[id] = { name, icon: img && img.src ? img.src.replace(/\?.*$/, "?size=64") : null };
    }
    return out;
  };
  // Told to Radar (radar://servers, caught by the webview) once the list is
  // there, so the app's pin list can show them too.
  (async () => {
    for (let i = 0; i < 60 && !document.querySelector('[data-list-item-id^="guildsnav___"] img'); i++) await sleep(1000);
    await sleep(2000);
    const guilds = window.__radarGuilds();
    if (Object.keys(guilds).length) location.href = "radar://servers?d=" + encodeURIComponent(JSON.stringify(guilds));
    if (window.__radarRenderPins) window.__radarRenderPins();
  })();

  // The voice channels of the open channel's server, in a bar on the right
  // (focus mode only: Discord's own lists are hidden then). Read from
  // Discord's channel list, which focus mode keeps rendered off screen; a
  // click opens the channel in the Discord app (radar://voice).
  const VOICE_KIND = /\(([^()]*(?:sprach|voice|vocal|stage|bühne|語音)[^()]*)\)/i;
  const voiceStyle = () => {
    const style = document.createElement("style");
    style.id = "radar-voice-style";
    style.textContent = `
      #radar-voice {
        display: none; position: fixed; z-index: 2147483000; top: 0; right: 0; bottom: 0; width: ${VOICE}px;
        box-sizing: border-box; padding: 14px 10px; overflow-y: auto; flex-direction: column; gap: 6px;
        background:
          radial-gradient(120% 50% at 100% 0%, color-mix(in oklab, var(--radar-accent, #5b8cff) 18%, transparent), transparent 70%),
          linear-gradient(180deg, #11141e, #0a0c13);
        border-left: 1px solid color-mix(in oklab, var(--radar-accent, #5b8cff) 25%, rgb(255 255 255 / 0.06));
        font: 500 13px/1.3 "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif; color: rgb(255 255 255 / 0.72);
      }
      #radar-voice h2 {
        display: flex; align-items: center; gap: 8px; margin: 2px 6px 6px;
        font-size: 10.5px; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase;
        color: var(--radar-accent, #5b8cff);
      }
      #radar-voice .radar-voice-empty { margin: 4px 6px; font-size: 12px; color: rgb(255 255 255 / 0.4); }
      #radar-voice .radar-vc {
        all: unset; box-sizing: border-box; display: flex; align-items: center; gap: 7px; width: 100%;
        padding: 7px 9px; border-radius: 10px; cursor: pointer; color: rgb(255 255 255 / 0.62);
      }
      #radar-voice .radar-vc:hover { background: rgb(255 255 255 / 0.06); color: #fff; }
      #radar-voice .radar-vc[data-users] { color: rgb(255 255 255 / 0.9); }
      #radar-voice .radar-vc[data-joined] {
        background: linear-gradient(90deg, color-mix(in oklab, var(--radar-accent, #5b8cff) 30%, transparent), transparent);
        color: #fff;
      }
      #radar-voice .radar-vc svg { flex: none; opacity: 0.6; }
      #radar-voice .radar-vc b { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
      #radar-voice .radar-vc small { flex: none; font-size: 10.5px; color: rgb(255 255 255 / 0.4); }
      #radar-voice .radar-vc-users { display: flex; flex-direction: column; gap: 2px; margin: -2px 0 4px 26px; }
      #radar-voice .radar-vu { display: flex; align-items: center; gap: 6px; font-size: 12px; color: rgb(255 255 255 / 0.68); min-width: 0; }
      #radar-voice .radar-vu i { flex: none; width: 16px; height: 16px; border-radius: 50%; background: #2a3040 center / cover; }
      #radar-voice .radar-vu span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      #radar-voice .radar-vu em {
        flex: none; font-style: normal; font-size: 9px; font-weight: 700; padding: 0 4px; border-radius: 4px;
        background: rgb(237 66 69 / 0.85); color: #fff;
      }
`;
    (document.head || document.documentElement).appendChild(style);
  };
  const speaker = () => {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("width", "14");
    svg.setAttribute("height", "14");
    svg.setAttribute("viewBox", "0 0 24 24");
    const path = document.createElementNS(ns, "path");
    path.setAttribute("fill", "currentColor");
    path.setAttribute("d", "M12 3a1 1 0 0 0-1.7-.7L6.6 6H4a2 2 0 0 0-2 2v8c0 1.1.9 2 2 2h2.6l3.7 3.7A1 1 0 0 0 12 21V3Zm3.1 5.3a1 1 0 0 1 1.4 0 5 5 0 0 1 0 7.4 1 1 0 1 1-1.4-1.4 3 3 0 0 0 0-4.6 1 1 0 0 1 0-1.4Z");
    svg.appendChild(path);
    return svg;
  };
  // The voice channels as Discord's list shows them now.
  const readVoice = () => {
    const out = [];
    for (const link of document.querySelectorAll('div[class*="sidebar_"] [data-list-item-id^="channels___"]')) {
      const label = link.getAttribute("aria-label") || "";
      if (!VOICE_KIND.test(label)) continue;
      const item = link.closest("li") || link.parentElement;
      const users = [...item.querySelectorAll('[class*="voiceUser"]')].map((u) => {
        const avatar = u.querySelector('[class*="userAvatar"], [class*="avatar"]');
        const bg = avatar ? getComputedStyle(avatar).backgroundImage : "none";
        return {
          name: (u.querySelector('[class*="usernameFont"], [class*="username"]') || u).textContent.trim(),
          avatar: /^url\(/.test(bg) ? bg : null,
          live: !!u.querySelector('[class*="live_"]'),
        };
      });
      const limit = label.match(/(\d+)\s+(?:von|of|sur|de)\s+(\d+)/i);
      out.push({
        id: link.getAttribute("data-list-item-id").slice("channels___".length),
        name: (link.querySelector('[class*="name__"], [class*="channelName"]') || {}).textContent || label.split(" (")[0],
        count: limit ? `${limit[1]}/${limit[2]}` : users.length ? String(users.length) : "",
        joined: /\b(verbunden|connected|connecté)\b/i.test(label),
        users,
      });
    }
    return out;
  };
  // Discord's list draws only what fits its height: made tall enough for all.
  const growChannelList = () => {
    const first = document.querySelector('div[class*="sidebar_"] [data-list-item-id^="channels___"]');
    let el = first && first.parentElement;
    while (el && !/(auto|scroll)/.test(getComputedStyle(el).overflowY)) el = el.parentElement;
    // Picking channels (the list shown): its own height back, to scroll.
    if (!focus) {
      if (el && el.style.height === "40000px") {
        el.style.removeProperty("height");
        el.style.removeProperty("max-height");
        el.style.removeProperty("flex");
      }
      return;
    }
    if (el && el.style.height !== "40000px") {
      el.style.setProperty("height", "40000px", "important");
      el.style.setProperty("max-height", "none", "important");
      // (A flex child: it would shrink back to the bar's height.)
      el.style.setProperty("flex", "none", "important");
    }
  };
  let lastVoice = "";
  const renderVoice = () => {
    // Only on a server's channel in focus mode: the bar and its room.
    const onServer = focus && /^\/channels\/\d+\//.test(location.pathname);
    voiceRoom.disabled = !onServer;
    if (!document.body || !onServer) return;
    let bar = document.getElementById("radar-voice");
    if (!bar) {
      voiceStyle();
      bar = document.createElement("aside");
      bar.id = "radar-voice";
      document.body.appendChild(bar);
    }
    try { growChannelList(); } catch {}
    const channels = readVoice();
    const key = JSON.stringify([location.pathname.split("/")[2], channels]);
    if (key === lastVoice) return;
    lastVoice = key;
    const de = window.__radarLang === "de";
    bar.replaceChildren();
    const title = document.createElement("h2");
    title.textContent = de ? "Sprachkanäle" : "Voice";
    bar.appendChild(title);
    if (!channels.length) {
      const empty = document.createElement("p");
      empty.className = "radar-voice-empty";
      empty.textContent = de ? "Keine Sprachkanäle (oder noch am Laden)" : "No voice channels (or still loading)";
      bar.appendChild(empty);
    }
    for (const vc of channels) {
      const row = document.createElement("button");
      row.className = "radar-vc";
      if (vc.users.length) row.dataset.users = "";
      if (vc.joined) row.dataset.joined = "";
      const name = document.createElement("b");
      name.textContent = vc.name;
      const count = document.createElement("small");
      count.textContent = vc.count;
      row.append(speaker(), name, count);
      row.title = de ? `${vc.name} in der Discord-App öffnen` : `Open ${vc.name} in the Discord app`;
      // In the Discord app (Radar opens its link): voice stays there, with
      // its own mute, deafen and leave.
      row.addEventListener("click", () => {
        const guild = location.pathname.split("/")[2];
        location.href = `radar://voice/${guild}/${vc.id}`;
      });
      bar.appendChild(row);
      if (vc.users.length) {
        const users = document.createElement("div");
        users.className = "radar-vc-users";
        for (const u of vc.users) {
          const line = document.createElement("div");
          line.className = "radar-vu";
          const face = document.createElement("i");
          if (u.avatar) face.style.backgroundImage = u.avatar;
          const who = document.createElement("span");
          who.textContent = u.name;
          line.append(face, who);
          if (u.live) {
            const live = document.createElement("em");
            live.textContent = "LIVE";
            line.appendChild(live);
          }
          users.appendChild(line);
        }
        bar.appendChild(users);
      }
    }
  };
  // Kept current every 2 s (Discord's list fills in late; nothing is
  // rebuilt while it stays the same).
  let voiceQueued = false;
  const queueVoice = () => {
    if (voiceQueued) return;
    voiceQueued = true;
    setTimeout(() => {
      voiceQueued = false;
      renderVoice();
    }, 400);
  };
  const startVoice = () => {
    renderVoice();
    setInterval(queueVoice, 2000);
    addEventListener("popstate", () => setTimeout(renderVoice));
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", startVoice, { once: true });
  else startVoice();

  // Join buttons: a message on screen with "/join Name#1234" gets a button
  // that copies the command and asks Radar (radar://join, caught by the
  // webview) to bring Destiny 2 to the front. Only what is shown is looked
  // at; nothing is sent anywhere.
  // Codes as written: four digits, or three ("#468") in some messages.
  // The command in every game language Destiny is known to use (it
  // translates its chat commands): /join, /beitreten, /rejoindre, /加入.
  const JOIN = /\/(?:join|beitreten|rejoindre|加入)\s*([^\s#/][^\n#/]{0,39}?#\d{3,4})(?!\d)/gi;
  // The one to copy: the player's game language (set in Radar).
  const verb = () => window.__radarJoinVerb || "/join";
  const fullCode = (name) => name.trim();
  const joinStyle = () => {
    const style = document.createElement("style");
    style.textContent = `
      /* Radar's look (styles.css): glass lit by the accent, light on black. */
      .radar-join {
        --a: var(--radar-accent, #5b8cff);
        --a-text: color-mix(in oklab, var(--a) 58%, white);
        display: inline-flex; align-items: center; gap: 5px;
        margin: 0 2px 0 6px; padding: 1px 10px; vertical-align: 1px;
        border: 1px solid color-mix(in oklab, var(--a) 55%, transparent);
        border-radius: 999px; cursor: pointer;
        background: linear-gradient(180deg, color-mix(in oklab, var(--a) 40%, rgb(255 255 255 / 0.08)), color-mix(in oklab, var(--a) 14%, transparent));
        box-shadow: 0 0 16px -6px color-mix(in oklab, var(--a) 55%, transparent), inset 0 1px 0 rgb(255 255 255 / 0.25);
        color: #fff; font: 600 12px/18px inherit;
        text-shadow: 0 0 10px color-mix(in oklab, var(--a) 55%, transparent);
        transition: filter 0.15s, box-shadow 0.15s;
      }
      .radar-join:hover { filter: brightness(1.15); box-shadow: 0 0 22px -4px color-mix(in oklab, var(--a) 60%, transparent), inset 0 1px 0 rgb(255 255 255 / 0.3); }
      .radar-join[data-done] { border-color: color-mix(in oklab, var(--a-text) 70%, transparent); }
      .radar-join-toast {
        --a: var(--radar-accent, #5b8cff);
        --a-text: color-mix(in oklab, var(--a) 58%, white);
        position: fixed; z-index: 99999; pointer-events: none;
        display: flex; gap: 10px; align-items: flex-start;
        padding: 10px 14px; border-radius: 14px; max-width: 300px;
        background: linear-gradient(145deg, rgb(255 255 255 / 0.05), rgb(255 255 255 / 0.01)), rgb(5 7 12 / 0.96);
        border: 1px solid rgb(255 255 255 / 0.1);
        box-shadow: 0 18px 40px -12px rgb(0 0 0 / 0.9), 0 0 24px -10px color-mix(in oklab, var(--a) 55%, transparent), inset 0 1px 0 rgb(255 255 255 / 0.08);
        color: rgb(255 255 255 / 0.65); font: 500 12px/1.5 inherit;
        backdrop-filter: blur(12px);
        animation: radar-toast 2.8s cubic-bezier(0.2, 0.8, 0.2, 1) forwards;
      }
      .radar-join-toast .check {
        flex: none; display: grid; place-items: center; width: 18px; height: 18px; margin-top: 1px;
        border-radius: 999px; background: var(--a-text); color: #000; font: 700 11px/1 inherit;
        box-shadow: 0 0 12px var(--a);
      }
      .radar-join-toast b { display: block; color: var(--a-text); font-weight: 600; font-size: 12.5px; text-shadow: 0 0 10px color-mix(in oklab, var(--a) 50%, transparent); }
      .radar-join-toast kbd {
        display: inline-block; padding: 0 5px; margin: 0 1px; border-radius: 5px;
        border: 1px solid rgb(255 255 255 / 0.14); background: rgb(255 255 255 / 0.06);
        color: #fff; font: 600 11px/16px ui-monospace, Consolas, monospace;
      }
      @keyframes radar-toast {
        0% { opacity: 0; transform: translateY(6px) scale(0.96); filter: blur(3px); }
        8%, 85% { opacity: 1; transform: none; filter: none; }
        100% { opacity: 0; transform: translateY(-4px); }
      }`;
    (document.head || document.documentElement).appendChild(style);
  };
  // "Copied" next to the button, in Radar's language (set by the app as
  // window.__radarLang).
  const toast = (button) => {
    const de = window.__radarLang === "de";
    document.querySelectorAll(".radar-join-toast").forEach((t) => t.remove());
    const r = button.getBoundingClientRect();
    const t = document.createElement("div");
    t.className = "radar-join-toast";
    t.innerHTML = de
      ? '<span class="check">✓</span><span><b>In die Zwischenablage kopiert</b>In Destiny: <kbd>Enter</kbd> <kbd>Strg+V</kbd> <kbd>Enter</kbd></span>'
      : '<span class="check">✓</span><span><b>Copied to clipboard</b>In Destiny: <kbd>Enter</kbd> <kbd>Ctrl+V</kbd> <kbd>Enter</kbd></span>';
    t.style.left = Math.max(8, Math.min(r.left, innerWidth - 296)) + "px";
    t.style.top = (r.bottom + 8 + 70 > innerHeight ? r.top - 62 : r.bottom + 8) + "px";
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3000);
  };
  // An element's own text, without Radar's buttons in it.
  const ownText = (el, inner) => {
    let text = (inner ? el.innerText : el.textContent) || "";
    for (const b of el.querySelectorAll(".radar-join")) text = text.replace(inner ? b.innerText : b.textContent, "");
    return text;
  };
  // The one-line preview of the message a reply answers: same kind of
  // element, but no room for a button there (it would be cut off).
  const isReplyPreview = (content) =>
    !!content.closest('[class*="repliedMessage"], [class*="repliedTextPreview"], [class*="repliedTextContent"]') ||
    /replied|repliedText/i.test(content.className);
  const addButtons = (root) => {
    const contents = root.querySelectorAll ? root.querySelectorAll('[id^="message-content-"]') : [];
    for (const content of contents) {
      if (isReplyPreview(content)) continue;
      const text = ownText(content);
      if (content.dataset.radarJoin === text) continue;
      content.dataset.radarJoin = text;
      content.querySelectorAll(".radar-join:not(.radar-join-bio)").forEach((b) => b.remove());
      const names = [...text.matchAll(JOIN)].map((m) => fullCode(m[1]));
      for (const name of new Set(names)) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "radar-join";
        button.textContent = "⇢ Join " + name;
        button.title = verb() + " " + name;
        button.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          navigator.clipboard.writeText(verb() + " " + name).catch(() => {});
          button.dataset.done = "";
          button.textContent = verb() + " " + name;
          toast(button);
          location.href = "radar://join/" + encodeURIComponent(name);
        });
        content.appendChild(button);
      }
    }
  };
  // Join codes in profile bios ("code in bio"): read from the profile as
  // Discord shows it (popout or full profile), nothing fetched.
  const joinWith = (button, name) => {
    navigator.clipboard.writeText(verb() + " " + name).catch(() => {});
    button.dataset.done = "";
    button.textContent = verb() + " " + name;
    toast(button);
    location.href = "radar://join/" + encodeURIComponent(name);
  };
  // The Bungie name in a bio: "/join Name#1234", or a line like
  // "Bungie: Name#1234" (the label before a colon is not part of it).
  const codeInBio = (text) => {
    const join = [...text.matchAll(JOIN)].map((m) => fullCode(m[1]));
    if (join.length) return join[0];
    for (const line of text.split("\n")) {
      const m = line.match(/([^\n#]{1,40}?#\d{3,4})(?!\d)/);
      if (!m) continue;
      // A label before it ("Bungie: …", "ID - …", "IGN | …") is not part of it.
      const name = m[1].split(/[:|=–—→]| - /).pop().replace(/^[^\p{L}\p{N}]+/u, "").trim();
      if (name.length > 5) return fullCode(name);
    }
    return null;
  };
  // A profile on screen: popout or full profile (a dialog).
  const PROFILE = '[class*="userPopout"], [class*="Popout"], [class*="popout"], [class*="userProfile"], [class*="UserProfile"], [role="dialog"]';
  const bioOf = (root) => {
    const bios = [...root.querySelectorAll('[class*="bio"], [class*="Bio"], [class*="aboutMe"]')].filter((el) => el.closest(PROFILE));
    // The innermost (the text itself, not a section around it).
    return bios.filter((el) => !bios.some((o) => o !== el && el.contains(o)));
  };
  const addBioButtons = (root) => {
    if (!root.querySelectorAll) return;
    for (const bio of bioOf(root)) {
      const text = ownText(bio, true);
      if (bio.dataset.radarBio === text) continue;
      bio.dataset.radarBio = text;
      bio.querySelectorAll(".radar-join").forEach((b) => b.remove());
      const name = codeInBio(text);
      if (!name) continue;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "radar-join";
      button.textContent = "⇢ Join " + name;
      button.title = verb() + " " + name;
      button.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        joinWith(button, name);
      });
      bio.appendChild(button);
    }
  };
  // Profiles opened by a "Join (Bio)" button stay invisible: Discord opens
  // them as usual, only nothing of it shows while the bio is read.
  const hideProfiles = (on) => {
    let style = document.getElementById("radar-hide-profiles");
    if (!style) {
      style = document.createElement("style");
      style.id = "radar-hide-profiles";
      style.textContent = `html.radar-reading-bio [class*="layerContainer"] > *,
        html.radar-reading-bio [class*="userPopout"], html.radar-reading-bio [class*="Popout"] {
          opacity: 0 !important; pointer-events: none !important; transition: none !important; animation: none !important;
        }`;
      (document.head || document.documentElement).appendChild(style);
    }
    document.documentElement.classList.toggle("radar-reading-bio", on);
  };
  // A message pointing to the bio for the join code, said as such: "join
  // code in bio", "keep join in bio", "code in my profile", "bio for join",
  // "join im Profil". Not just any "bio" / "profile" (a clan link
  // ".../Clan/Profile/…", "join our server … link in bio").
  const BIO_JOIN = /\b(join|code|joincode|bungie ?(?:name|id)?)\b[^.!?\n]{0,20}?\b(?:in|on|at|from|im|in der|in meiner|auf)\s+(?:my\s+|the\s+|meiner\s+|meinem\s+|der\s+|dem\s+)?(?:bio|about ?me|profil|profile)\b|\b(?:bio|profil|profile)\b[^.!?\n]{0,10}?\b(?:for|für|zum)\s+(?:the\s+|den\s+)?(?:join|code)\b/i;
  const HAS_JOIN = new RegExp(JOIN.source, "i");
  // Not a game join: ads for a Discord server.
  const NOT_GAME = /discord\.gg|\b(?:server|discord)\b/i;
  const addBioHintButtons = (root) => {
    const contents = root.querySelectorAll ? root.querySelectorAll('[id^="message-content-"]') : [];
    for (const content of contents) {
      if (isReplyPreview(content)) continue;
      const text = ownText(content);
      if (content.dataset.radarBioHint === text) continue;
      content.dataset.radarBioHint = text;
      content.querySelectorAll(".radar-join-bio").forEach((b) => b.remove());
      if (!BIO_JOIN.test(text.replace(/https?:\/\/\S+/g, " ")) || HAS_JOIN.test(text) || NOT_GAME.test(text)) continue;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "radar-join radar-join-bio";
      const de = window.__radarLang === "de";
      button.textContent = "⇢ Join (Bio)";
      button.title = de ? "Öffnet das Profil und liest den Join-Code aus der Bio" : "Opens the profile and reads the join code from the bio";
      button.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        // The author: the avatar of the message's group (follow-up messages
        // have none; it is on the first of the group).
        let row = content.closest('li, [id^="chat-messages-"]');
        let avatar = null;
        while (row && !(avatar = row.querySelector('img[class*="avatar"], [class*="avatar"] img'))) row = row.previousElementSibling;
        if (!avatar) {
          button.textContent = de ? "Profil nicht gefunden" : "Profile not found";
          return;
        }
        // As if the player clicked the avatar: Discord opens the profile,
        // kept invisible (see hideProfiles) while the bio is read.
        hideProfiles(true);
        avatar.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
        button.textContent = de ? "Lese Bio …" : "Reading bio …";
        const started = Date.now();
        const close = () => {
          document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, bubbles: true }));
          // Shown again once it is gone.
          setTimeout(() => hideProfiles(false), 150);
        };
        const look = () => {
          const name = bioOf(document).map((b) => codeInBio(ownText(b, true))).find(Boolean);
          if (name) {
            close();
            joinWith(button, name);
          } else if (Date.now() - started < 3000) {
            setTimeout(look, 150);
          } else {
            close();
            button.textContent = de ? "Kein Join-Code in der Bio" : "No join code in the bio";
          }
        };
        setTimeout(look, 200);
      });
      content.appendChild(button);
    }
  };
  const watchMessages = () => {
    joinStyle();
    addButtons(document);
    addBioHintButtons(document);
    addBioButtons(document);
    let queued = false;
    new MutationObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        addButtons(document);
        addBioHintButtons(document);
        addBioButtons(document);
      });
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  };
  const startJoin = () => {
    try {
      watchMessages();
      window.__radarJoinState = "watching";
    } catch (e) {
      window.__radarJoinState = "error: " + e;
    }
  };
  window.__radarJoinState = "loaded";
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", startJoin, { once: true });
  else startJoin();
})();
"##;

static FOCUS: AtomicBool = AtomicBool::new(true);
static CREATE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Pin {
    /// https://discord.com/channels/<server>/<channel>
    url: String,
    name: String,
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DiscordConfig {
    pins: Vec<Pin>,
    /// Focus mode on (default) / off.
    no_focus: bool,
    /// Destiny's language ("en", "de", "fr", "zh"; empty: English).
    game_language: String,
    /// The Discord servers by id (from the pins' links): name and icon, as
    /// Discord's server list shows them (sent by SCRIPT, see `servers_seen`).
    servers: std::collections::HashMap<String, Server>,
}

/// A Discord server as its list shows it, for grouping the pins.
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Server {
    name: String,
    icon: Option<String>,
}

/// A voice channel picked in the bar on the right (radar://voice/<server>/
/// <channel>): opened in the Discord app, where voice runs (one voice
/// connection per account; muting and leaving stay the app's), and the app
/// brought to the front (Windows keeps it behind the game otherwise). True
/// if it was such a link.
fn open_voice(url: &Url) -> bool {
    let ids: Vec<&str> = url.path().trim_matches('/').split('/').collect();
    let server = url.host_str().filter(|h| *h == "voice").and(ids.first().copied());
    let (Some(server), Some(channel)) = (server, ids.get(1)) else { return false };
    if ![server, *channel].iter().all(|id| !id.is_empty() && id.chars().all(|c| c.is_ascii_digit())) {
        return false;
    }
    // Radar has the focus (the click): it may hand it on.
    unsafe {
        let _ = windows::Win32::UI::WindowsAndMessaging::AllowSetForegroundWindow(
            windows::Win32::UI::WindowsAndMessaging::ASFW_ANY,
        );
    }
    let _ = tauri_plugin_opener::open_url(format!("discord://-/channels/{server}/{channel}"), None::<&str>);
    std::thread::spawn(|| {
        // Discord switches to the channel first; then its window up.
        std::thread::sleep(std::time::Duration::from_millis(600));
        crate::screen::focus_discord_app();
    });
    true
}

/// Discord's server list, read by SCRIPT (radar://servers?d=<json>): names
/// and icons kept, the app told (its pin list groups by server).
fn servers_seen(app: &AppHandle, url: &Url) {
    use tauri::Emitter;
    let Some((_, data)) = url.query_pairs().find(|(k, _)| k == "d") else { return };
    let Ok(seen) = serde_json::from_str::<std::collections::HashMap<String, Server>>(&data) else { return };
    let mut c = config(app);
    let before = serde_json::to_string(&c.servers).unwrap_or_default();
    for (id, server) in seen {
        // Only real ids, and only what is plausible to show.
        if id.chars().all(|c| c.is_ascii_digit()) && !server.name.trim().is_empty() {
            let icon = server.icon.filter(|i| i.starts_with("https://cdn.discordapp.com/"));
            c.servers.insert(id, Server { name: server.name.trim().chars().take(100).collect(), icon });
        }
    }
    if serde_json::to_string(&c.servers).unwrap_or_default() != before {
        if let Ok(c) = store(app, c) {
            let _ = app.emit("discord-config", c);
        }
    }
}

static CONFIG: Mutex<Option<DiscordConfig>> = Mutex::new(None);

fn path(app: &AppHandle) -> PathBuf {
    app.path().app_config_dir().unwrap_or_else(|_| PathBuf::from(".")).join("discord.json")
}

fn config(app: &AppHandle) -> DiscordConfig {
    CONFIG
        .lock()
        .unwrap()
        .get_or_insert_with(|| {
            let c: DiscordConfig =
                std::fs::read_to_string(path(app)).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
            *GAME_LANG.lock().unwrap() = c.game_language.clone();
            c
        })
        .clone()
}

fn store(app: &AppHandle, c: DiscordConfig) -> Result<DiscordConfig, String> {
    if let Some(dir) = path(app).parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    std::fs::write(path(app), serde_json::to_string_pretty(&c).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    *CONFIG.lock().unwrap() = Some(c.clone());
    Ok(c)
}

/// Only Discord's own pages open inside; other links go to the browser.
fn is_discord(url: &Url) -> bool {
    url.scheme() == "https"
        && url.host_str().is_some_and(|h| h == "discord.com" || h.ends_with(".discord.com"))
}

/// Radar's accent color for the theme ("#rrggbb").
static ACCENT: Mutex<String> = Mutex::new(String::new());

/// Focus mode and accent color into the page (again after every load).
fn focus_script() -> String {
    let on = FOCUS.load(Ordering::SeqCst);
    let accent = ACCENT.lock().unwrap().clone();
    let accent = if accent.is_empty() { "null".to_string() } else { format!("'{accent}'") };
    format!("window.__radarFocus && window.__radarFocus({on}); {accent} && window.__radarAccent && window.__radarAccent({accent})")
}

fn apply_focus(webview: &Webview) {
    let _ = webview.eval(focus_script());
}

/* ---------- Discord over the game (hotkey) ---------- */

const GAME_LABEL: &str = "discord-game";

/// Discord over the game: only the chat, on a solid dark backdrop of its
/// own (the theme is see-through for the tab, where Radar's panel is
/// behind it; over the game that would be unreadable), with the opacity of
/// its setting.
const GAME_SCRIPT: &str = r##"
(() => {
  const backdrop = () => {
    const style = document.createElement("style");
    style.textContent = `
      html {
        background:
          radial-gradient(60rem 30rem at 85% -10%, color-mix(in oklab, var(--radar-accent, #5b8cff) 14%, transparent), transparent 60%),
          linear-gradient(160deg, #0d1018, #07080c 70%) !important;
      }
      body { background: transparent !important; }`;
    (document.head || document.documentElement).appendChild(style);
  };
  // From the first paint, like the theme (see SCRIPT).
  if (document.documentElement) backdrop();
  else new MutationObserver((_, o) => { if (document.documentElement) { o.disconnect(); backdrop(); } }).observe(document, { childList: true });
  // In a stylesheet of its own: Discord rewrites the <html> element's
  // inline style, which would drop an opacity set there.
  window.__radarOpacity = (value) => {
    window.__radarOpacityValue = value;
    const apply = () => {
      let style = document.getElementById("radar-game-opacity");
      if (!style) {
        style = document.createElement("style");
        style.id = "radar-game-opacity";
        (document.head || document.documentElement).appendChild(style);
      }
      style.textContent = `html { opacity: ${value} !important; }`;
    };
    if (document.documentElement) apply();
    else document.addEventListener("DOMContentLoaded", apply, { once: true });
  };
  // Discord may replace <head> while starting: put it back once loaded.
  addEventListener("load", () => window.__radarOpacity(window.__radarOpacityValue ?? 0.8), { once: true });
  window.__radarOpacity(window.__radarOpacityValue ?? 0.8);

  // The pinned channels in a bar on the left (Discord's own lists stay
  // hidden); a click switches channel through Discord's router.
  const BAR = 210;
  const barStyle = () => {
    const style = document.createElement("style");
    style.textContent = `
      :root { --radar-left: ${BAR}px; }
      #app-mount { left: ${BAR}px !important; width: calc(100% - ${BAR}px) !important; }
      #radar-pins {
        position: fixed; z-index: 2147483000; top: 0; left: 0; bottom: 0; width: ${BAR}px;
        box-sizing: border-box; padding: 14px 10px; overflow-y: auto;
        background:
          radial-gradient(120% 50% at 0% 0%, color-mix(in oklab, var(--radar-accent, #5b8cff) 22%, transparent), transparent 70%),
          linear-gradient(180deg, #11141e, #0a0c13);
        border-right: 1px solid color-mix(in oklab, var(--radar-accent, #5b8cff) 25%, rgb(255 255 255 / 0.06));
        font: 500 13px/1.3 "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif; color: rgb(255 255 255 / 0.72);
      }
      #radar-pins h2 {
        display: flex; align-items: center; gap: 8px;
        margin: 2px 6px 12px; font-size: 10.5px; font-weight: 700; letter-spacing: 0.16em;
        text-transform: uppercase; color: var(--radar-accent, #5b8cff);
      }
      #radar-pins h2::before {
        content: ""; width: 8px; height: 8px; border-radius: 50%;
        background: var(--radar-accent, #5b8cff); box-shadow: 0 0 10px var(--radar-accent, #5b8cff);
      }
      #radar-pins button {
        all: unset; box-sizing: border-box; display: flex; align-items: center; gap: 8px; width: 100%;
        padding: 7px 10px; margin-bottom: 2px; border-radius: 10px; cursor: pointer;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      #radar-pins button:hover { background: rgb(255 255 255 / 0.06); color: #fff; }
      #radar-pins button { position: relative; }
      #radar-pins button[data-active] {
        background: linear-gradient(90deg, color-mix(in oklab, var(--radar-accent, #5b8cff) 30%, transparent), transparent);
        color: #fff; font-weight: 600;
      }
      #radar-pins button[data-active]::before {
        content: ""; position: absolute; left: 0; top: 7px; bottom: 7px; width: 3px; border-radius: 3px;
        background: var(--radar-accent, #5b8cff); box-shadow: 0 0 10px var(--radar-accent, #5b8cff);
      }
      #radar-pins button span { color: rgb(255 255 255 / 0.35); font-size: 15px; }
      #radar-pins { display: flex; flex-direction: column; }
      #radar-pins .radar-me {
        margin-top: auto; padding: 10px; border-radius: 12px;
        background: rgb(255 255 255 / 0.04); border: 1px solid rgb(255 255 255 / 0.08);
      }
      #radar-pins .radar-me small {
        display: block; margin-bottom: 6px; font-size: 10px; font-weight: 600; letter-spacing: 0.14em;
        text-transform: uppercase; color: rgb(255 255 255 / 0.4);
      }
      #radar-pins .radar-me code {
        display: block; margin-bottom: 8px; font: 600 13px/1.3 "Segoe UI Variable Display", "Segoe UI", system-ui, sans-serif; color: #fff;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      #radar-pins .radar-me button {
        justify-content: center; margin: 0; padding: 6px 10px; font-weight: 600; color: #fff;
        background: color-mix(in oklab, var(--radar-accent, #5b8cff) 40%, transparent);
      }
      #radar-pins .radar-me button:hover { background: color-mix(in oklab, var(--radar-accent, #5b8cff) 60%, transparent); }
      #radar-pins .radar-me button[data-done] { background: rgb(52 211 153 / 0.35); }
      #radar-pins button[data-active] span { color: var(--radar-accent, #5b8cff); }
      /* A server's channels as one package: its icon and name on top (a
         click folds them away), the channels inside. */
      #radar-pins .radar-server {
        margin-bottom: 8px; padding: 4px; border-radius: 12px;
        background: rgb(255 255 255 / 0.025); border: 1px solid rgb(255 255 255 / 0.06);
      }
      #radar-pins .radar-server > button.radar-server-head {
        gap: 8px; padding: 6px 8px; margin: 0; color: rgb(255 255 255 / 0.85); font-weight: 600; font-size: 12px;
      }
      #radar-pins .radar-server-head img,
      #radar-pins .radar-server-head i {
        flex: none; width: 20px; height: 20px; border-radius: 6px; object-fit: cover;
        display: grid; place-items: center; font: 700 9px/1 "Segoe UI", sans-serif; font-style: normal;
        background: color-mix(in oklab, var(--radar-accent, #5b8cff) 30%, #1b1f2b); color: #fff;
      }
      #radar-pins .radar-server-head b { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; font-weight: 600; }
      #radar-pins .radar-server-head em {
        flex: none; font-style: normal; font-size: 10px; color: rgb(255 255 255 / 0.4);
        transition: transform 0.2s;
      }
      #radar-pins .radar-server[data-closed] .radar-server-head em { transform: rotate(-90deg); }
      #radar-pins .radar-server[data-closed] .radar-server-channels { display: none; }
      #radar-pins .radar-server-channels { padding: 2px 0 0 6px; }
      #radar-pins .radar-server[data-here] { border-color: color-mix(in oklab, var(--radar-accent, #5b8cff) 35%, transparent); }`;
    (document.head || document.documentElement).appendChild(style);
  };
  let pins = [];
  let me = null;
  let knownServers = {};
  // Servers folded away (shared with the tab: same Discord storage).
  const closed = new Set();
  try { JSON.parse(localStorage.getItem("radarClosedServers") || "[]").forEach((id) => closed.add(id)); } catch {}
  const render = () => {
    if (!document.body) return;
    let bar = document.getElementById("radar-pins");
    if (!bar) {
      barStyle();
      bar = document.createElement("nav");
      bar.id = "radar-pins";
      document.body.appendChild(bar);
    }
    const here = location.pathname;
    bar.replaceChildren();
    const title = document.createElement("h2");
    title.textContent = "Channels";
    bar.appendChild(title);
    // By server (the id in the link), in the order they were pinned.
    const guilds = { ...knownServers, ...(window.__radarGuilds ? window.__radarGuilds() : {}) };
    const groups = new Map();
    for (const pin of pins) {
      const guild = new URL(pin.url).pathname.split("/")[2] || "";
      if (!groups.has(guild)) groups.set(guild, []);
      groups.get(guild).push(pin);
    }
    for (const [guild, list] of groups) {
      const info = guilds[guild] || {};
      const box = document.createElement("div");
      box.className = "radar-server";
      if (closed.has(guild)) box.dataset.closed = "";
      if (here.split("/")[2] === guild) box.dataset.here = "";
      const head = document.createElement("button");
      head.className = "radar-server-head";
      head.title = info.name || "";
      let badge;
      if (info.icon) {
        badge = document.createElement("img");
        badge.src = info.icon;
        badge.alt = "";
      } else {
        // Initials, as Discord shows a server without an icon (blank while
        // the name isn't known yet).
        badge = document.createElement("i");
        badge.textContent = (info.name || "").split(/\s+/).map((w) => w[0] || "").join("").slice(0, 3);
      }
      const name = document.createElement("b");
      name.textContent = info.name || "";
      const fold = document.createElement("em");
      fold.textContent = "▾";
      head.append(badge, name, fold);
      head.addEventListener("click", () => {
        if (closed.has(guild)) closed.delete(guild);
        else closed.add(guild);
        try { localStorage.setItem("radarClosedServers", JSON.stringify([...closed])); } catch {}
        render();
      });
      const channels = document.createElement("div");
      channels.className = "radar-server-channels";
      for (const pin of list) {
        const path = new URL(pin.url).pathname;
        const button = document.createElement("button");
        if (path === here) button.dataset.active = "";
        const hash = document.createElement("span");
        hash.textContent = "#";
        button.append(hash, pin.name.replace(/^#/, ""));
        button.title = pin.name;
        button.addEventListener("click", () => {
          if (location.pathname === path) return;
          history.pushState(null, "", path);
          dispatchEvent(new PopStateEvent("popstate", { state: null }));
          render();
        });
        channels.appendChild(button);
      }
      box.append(head, channels);
      bar.appendChild(box);
    }
    // The player's own join code, to paste into a message.
    if (me) {
      const de = window.__radarLang === "de";
      const box = document.createElement("div");
      box.className = "radar-me";
      const label = document.createElement("small");
      label.textContent = de ? "Dein Join-Code" : "Your join code";
      const code = document.createElement("code");
      const cmd = document.createElement("span");
      cmd.textContent = (window.__radarJoinVerb || "/join") + " ";
      cmd.style.cssText = "font-weight: 500; color: color-mix(in oklab, var(--radar-accent, #5b8cff) 58%, white);";
      code.append(cmd, me);
      code.title = (window.__radarJoinVerb || "/join") + " " + me;
      const copy = document.createElement("button");
      copy.textContent = de ? "Kopieren" : "Copy";
      copy.addEventListener("click", () => {
        const done = () => (location.href = "radar://copied");
        navigator.clipboard.writeText((window.__radarJoinVerb || "/join") + " " + me).then(done, done);
        copy.dataset.done = "";
        copy.textContent = de ? "✓ Kopiert" : "✓ Copied";
        setTimeout(() => {
          delete copy.dataset.done;
          copy.textContent = de ? "Kopieren" : "Copy";
        }, 1800);
      });
      box.append(label, code, copy);
      bar.appendChild(box);
    }
  };
  // Again once Discord's server list is there (names and icons).
  window.__radarRenderPins = () => render();
  window.__radarPins = (list, player, servers) => {
    pins = list;
    me = player || null;
    if (servers) knownServers = servers;
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render, { once: true });
    else render();
  };
  // Discord's own navigation (links in messages) moves the highlight too.
  addEventListener("popstate", () => setTimeout(render));
  setInterval(() => {
    const bar = document.getElementById("radar-pins");
    if (!bar || !document.body.contains(bar)) render();
  }, 2000);
})();
"##;

/// The Bungie name of the account signed in (login), once looked up.
static OWN_NAME: Mutex<Option<String>> = Mutex::new(None);

/// The join name ("Name#1234") of the account signed in to Radar (Bungie
/// login): the one being played on, for "/join" in LFG messages.
#[tauri::command]
pub async fn own_join_name(app: AppHandle) -> Result<Option<String>, String> {
    let s = crate::inventory::session(&app).await?;
    let key = app.state::<crate::bungie::BungieState>().api_key()?;
    let http = app.state::<crate::bungie::BungieState>().http.clone();
    let me = crate::bungie::api_as_user(&http, &key, s.token(), "/User/GetMembershipsForCurrentUser/").await?;
    let user = &me["bungieNetUser"];
    let name = user["cachedBungieGlobalDisplayName"]
        .as_str()
        .zip(user["cachedBungieGlobalDisplayNameCode"].as_u64())
        .map(|(n, c)| format!("{n}#{c:04}"));
    *OWN_NAME.lock().unwrap() = name.clone();
    Ok(name)
}

/// The pinned channels for the bar in Discord over the game.
fn pins_script(app: &AppHandle) -> String {
    let c = config(app);
    let pins = serde_json::to_string(&c.pins).unwrap_or_else(|_| "[]".into());
    // The signed-in account's name, for its join code under the channels.
    let me = OWN_NAME.lock().unwrap().clone();
    let me = serde_json::to_string(&me).unwrap_or_else(|_| "null".into());
    // The servers as last seen: names and icons from the start, before
    // Discord's own server list has loaded.
    let servers = serde_json::to_string(&c.servers).unwrap_or_else(|_| "{}".into());
    format!("window.__radarPins && window.__radarPins({pins}, {me}, {servers})")
}

/// Open each pinned channel once in the background while Discord is hidden
/// (see __radarWarm in SCRIPT), so switching to one is instant.
fn warm_script(app: &AppHandle) -> String {
    let paths: Vec<String> = config(app)
        .pins
        .iter()
        .filter_map(|p| p.url.parse::<Url>().ok())
        .map(|u| u.path().to_string())
        .collect();
    let paths = serde_json::to_string(&paths).unwrap_or_else(|_| "[]".into());
    format!("window.__radarWarm && window.__radarWarm({paths})")
}

/// Apply the opacity to Discord over the game, if it's open.
pub fn apply_game_opacity(app: &AppHandle, opacity: f64) {
    if let Some(window) = app.get_webview_window(GAME_LABEL) {
        let _ = window.eval(format!("window.__radarOpacity && window.__radarOpacity({opacity})"));
    }
}

/// Hotkey: Discord (the channel open in the tab, else the first pin) over
/// the game, or close it and hand the focus back to the game. A join button
/// in it copies the command, closes it and brings the game to the front.
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

/// A new window over the game waiting for its page: shown once loaded, so
/// it doesn't flash the bare webview before Discord and Radar's look are in.
static SHOW_WHEN_LOADED: AtomicBool = AtomicBool::new(false);

/// Show Discord's window over the game, in front, with the focus.
fn show_game_window(app: &AppHandle, window: &tauri::WebviewWindow) {
    // One window over the game at a time: DIM's goes.
    crate::dim::hide_in_game(app);
    crate::inspect::hide_in_game(app);
    crate::sleep::wake_window(window);
    let _ = window.show();
    let _ = window.set_focus();
}

/// Discord's window over the game: the one there is, or a new one, hidden.
fn game_window(app: &AppHandle) -> Option<tauri::WebviewWindow> {
    if let Some(window) = app.get_webview_window(GAME_LABEL) {
        return Some(window);
    }
    let opacity = crate::hotkeys::discord_opacity(app);
    let app = app.clone();
    let start = app
        .get_webview(LABEL)
        .and_then(|w| w.url().ok())
        .filter(|u| u.path().starts_with("/channels/"))
        .map(|u| u.to_string())
        .or_else(|| config(&app).pins.first().map(|p| p.url.clone()))
        .unwrap_or_else(|| HOME.to_string());
    let Ok(url) = start.parse::<Url>() else { return None };
    // Pins and accent go in with the page, not only once it has
    // loaded (the bar and the colors came in late).
    let script = format!(
        "{}\n{SCRIPT}\nwindow.__radarOpacityValue = {opacity};\n{GAME_SCRIPT}\n{}\n{}",
        lang_script(),
        focus_script(),
        pins_script(&app)
    );
    let handle = app.clone();
    let built = tauri::WebviewWindowBuilder::new(&app, GAME_LABEL, WebviewUrl::External(url))
        .title("Radar – Discord")
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        .disable_drag_drop_handler()
            .initialization_script(&script)
        .on_page_load(|window, payload| {
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
                let _ = window.eval(lang_script());
                let _ = window.eval(focus_script());
                let _ = window.eval(pins_script(&window.app_handle().clone()));
                let opacity = crate::hotkeys::discord_opacity(window.app_handle());
                let _ = window.eval(format!("window.__radarOpacity && window.__radarOpacity({opacity})"));
                if SHOW_WHEN_LOADED.swap(false, Ordering::SeqCst) {
                    let app = window.app_handle().clone();
                    if let Some(window) = app.get_webview_window(GAME_LABEL) {
                        show_game_window(&app, &window);
                    }
                }
            }
        })
        .on_navigation(move |url| {
            // A join button: the command is copied; back to the game.
            if url.scheme() == "radar" {
                // A voice channel: opened in the Discord app, this window
                // out of its way.
                if open_voice(url) {
                    if let Some(window) = handle.get_webview_window(GAME_LABEL) {
                        let _ = window.hide();
                    }
                }
                // Also the own join code, copied: back to the game to paste it.
                if matches!(url.host_str(), Some("join" | "copied")) {
                    // The game first, while this window has the front.
                    crate::screen::focus_game();
                    if let Some(window) = handle.get_webview_window(GAME_LABEL) {
                        let _ = window.hide();
                    }
                }
                return false;
            }
            if is_discord(url) || url.scheme() == "about" {
                true
            } else {
                let _ = tauri_plugin_opener::open_url(url.as_str(), None::<&str>);
                false
            }
        })
        .on_new_window(|url, _features| {
            let _ = tauri_plugin_opener::open_url(url.as_str(), None::<&str>);
            NewWindowResponse::Deny
        })
        .build();
    match built {
        Ok(window) => Some(window),
        Err(e) => {
            eprintln!("[discord] in-game window: {e}");
            None
        }
    }
}

pub fn toggle_in_game(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let opacity = crate::hotkeys::discord_opacity(&app);
        if OWN_NAME.lock().unwrap().is_none() {
            let _ = own_join_name(app.clone()).await;
        }
        if let Some(window) = app.get_webview_window(GAME_LABEL).filter(|w| w.is_visible().unwrap_or(false)) {
            // The game first, while this window still has the front.
            crate::screen::focus_game();
            let _ = window.hide();
            return;
        }
        // A new one is shown when its page has loaded (SHOW_WHEN_LOADED);
        // marked before it exists, in case that's quick.
        let created = app.get_webview_window(GAME_LABEL).is_none();
        SHOW_WHEN_LOADED.store(created, Ordering::SeqCst);
        let Some(window) = game_window(&app) else { return };
        crate::dim::place_over_game(&app, &window);
        apply_game_opacity(&app, opacity);
        let _ = window.eval(focus_script());
        let _ = window.eval(pins_script(&app));
        if !created {
            show_game_window(&app, &window);
        }
    });
}

fn get_or_create(app: &AppHandle, position: LogicalPosition<f64>, size: LogicalSize<f64>) -> Result<(Webview, bool), String> {
    let _guard = CREATE_LOCK.lock().unwrap();
    if let Some(webview) = app.get_webview(LABEL) {
        return Ok((webview, false));
    }
    let window = app.get_window("main").ok_or(tr("Hauptfenster nicht gefunden", "Main window not found"))?;
    // Straight into the first pinned channel (else Discord's home).
    let start: Url = config(app)
        .pins
        .first()
        .and_then(|p| p.url.parse().ok())
        .unwrap_or_else(|| HOME.parse().expect("valid url"));
    let handle = app.clone();
    let builder = WebviewBuilder::new(LABEL, WebviewUrl::External(start))
        .disable_drag_drop_handler()
        // See-through, so Radar's panel shows behind the themed Discord.
        .transparent(true)
        .initialization_script(format!("{}\n{SCRIPT}", lang_script()))
        // Settings sent before a page finished loading would be lost.
        .on_page_load(|webview, payload| {
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
                LOADED.store(true, Ordering::SeqCst);
                apply_focus(&webview);
                let _ = webview.eval(lang_script());
                let _ = webview.eval(warm_script(webview.app_handle()));
            }
        })
        .on_navigation(move |url| {
            // A join button (see SCRIPT): the command is copied already;
            // Destiny 2 comes to the front, the page stays.
            if url.scheme() == "radar" {
                if url.host_str() == Some("join") && crate::screen::destiny_running() {
                    crate::screen::focus_game();
                }
                if url.host_str() == Some("servers") {
                    servers_seen(&handle, url);
                }
                let _ = open_voice(url);
                return false;
            }
            if is_discord(url) || url.scheme() == "about" {
                true
            } else {
                let _ = tauri_plugin_opener::open_url(url.as_str(), None::<&str>);
                false
            }
        })
        .on_new_window(|url, _features| {
            let _ = tauri_plugin_opener::open_url(url.as_str(), None::<&str>);
            NewWindowResponse::Deny
        });
    let webview = window.add_child(builder, position, size).map_err(|e| e.to_string())?;
    Ok((webview, true))
}

#[derive(Deserialize)]
pub struct Bounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

/// Run a script in the webview and get its (JSON) result.
async fn evaluate(webview: &Webview, script: &str) -> Option<String> {
    use std::sync::{Arc, Mutex as StdMutex};
    use webview2_com::ExecuteScriptCompletedHandler;
    let (tx, rx) = tokio::sync::oneshot::channel::<Option<String>>();
    let tx = Arc::new(StdMutex::new(Some(tx)));
    let send = move |value: Option<String>| {
        if let Some(tx) = tx.lock().unwrap().take() {
            let _ = tx.send(value);
        }
    };
    let on_error = send.clone();
    let script = webview2_com::pwstr_from_str(script);
    let script = script.0 as usize;
    webview
        .with_webview(move |platform| {
            let started = (|| -> windows::core::Result<()> {
                let core = unsafe { platform.controller().CoreWebView2()? };
                let handler = ExecuteScriptCompletedHandler::create(Box::new(move |result, json| {
                    send(result.ok().map(|_| json));
                    Ok(())
                }));
                let script = windows::core::PCWSTR(script as *const u16);
                unsafe { core.ExecuteScript(script, &handler)? };
                Ok(())
            })();
            if started.is_err() {
                on_error(None);
            }
        })
        .ok()?;
    tokio::time::timeout(std::time::Duration::from_secs(3), rx).await.ok()?.ok()?
}

/// Diagnosis for the focus mode: the outline of Discord's page layout
/// (tags, class prefixes, aria labels, sizes – no content), logged once.
const LAYOUT_PROBE: &str = r#"(() => {
  const out = [];
  const walk = (el, depth) => {
    if (depth > 17 || out.length > 220) return;
    const r = el.getBoundingClientRect();
    if (r.width < 40 || r.height < 30) return;
    const cls = [...el.classList].slice(0, 3).join(".");
    const label = el.getAttribute("aria-label") || "";
    const cs = getComputedStyle(el);
    const paint = [cs.backgroundColor !== "rgba(0, 0, 0, 0)" ? cs.backgroundColor : "", cs.backgroundImage !== "none" ? cs.backgroundImage.slice(0, 60) : ""].filter(Boolean).join(" ");
    out.push(`${"  ".repeat(depth)}${el.tagName.toLowerCase()}${cls ? "." + cls : ""}${label ? ` [${label}]` : ""} ${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}${paint ? "  BG " + paint : ""}`);
    for (const child of el.children) walk(child, depth + 1);
  };
  const root = document.getElementById("app-mount") || document.body;
  if (root) walk(root, 0);
  const focus = document.getElementById("radar-focus");
  out.unshift("focus style: " + (focus ? (focus.disabled ? "off" : "on") : "missing"));
  return out.join("\n");
})()"#;

static PROBED: AtomicBool = AtomicBool::new(false);

/// The newest show or hide the page asked for (as DIM's).
pub(crate) static SEQ: AtomicU64 = AtomicU64::new(0);

/// DIM shows: Discord goes (and an older show of it coming in late is
/// dropped).
pub(crate) fn hide_for_other(app: &AppHandle, seq: Option<u64>) {
    if let Some(s) = seq {
        SEQ.fetch_max(s, Ordering::SeqCst);
    }
    if let Some(webview) = app.get_webview(LABEL) {
        let _ = webview.hide();
    }
}

/// Place and show Discord (created on first use).
#[tauri::command]
pub async fn discord_show(app: AppHandle, bounds: Bounds, seq: Option<u64>) -> Result<(), String> {
    if !crate::dim::newest(&SEQ, seq) {
        return Ok(());
    }
    crate::dim::hide_for_other(&app, seq);
    config(&app);
    let position = LogicalPosition::new(bounds.x, bounds.y);
    let size = LogicalSize::new(bounds.width.max(1.0), bounds.height.max(1.0));
    let (webview, created) = get_or_create(&app, position, size)?;
    if !created {
        webview.set_position(position).map_err(|e| e.to_string())?;
        webview.set_size(size).map_err(|e| e.to_string())?;
    }
    apply_focus(&webview);
    crate::dim::round_corners(&webview);
    if !crate::dim::still(&SEQ, seq) {
        return Ok(());
    }
    webview.show().map_err(|e| e.to_string())?;
    // Once per run, after Discord has rendered: log its layout outline.
    if !PROBED.swap(true, Ordering::SeqCst) || std::env::var("RADAR_DISCORD_PROBE").is_ok() {
        let webview = webview.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_secs(8)).await;
            match evaluate(&webview, LAYOUT_PROBE).await {
                Some(json) => {
                    let text: String = serde_json::from_str(&json).unwrap_or(json);
                    println!("[discord-layout]\n{text}\n[/discord-layout]");
                }
                None => println!("[discord-layout] probe failed"),
            }
        });
    }
    Ok(())
}

/// Radar's accent color for the Discord theme ("#rrggbb").
#[tauri::command]
pub fn discord_set_accent(app: AppHandle, color: String) {
    let valid = color.len() == 7 && color.starts_with('#') && color[1..].chars().all(|c| c.is_ascii_hexdigit());
    if !valid {
        return;
    }
    *ACCENT.lock().unwrap() = color;
    if let Some(webview) = app.get_webview(LABEL) {
        apply_focus(&webview);
    }
}

/// The Discord tab's page has finished loading once (for the loading screen).
pub(crate) static LOADED: AtomicBool = AtomicBool::new(false);

/// Which of the embedded pages have finished loading.
#[derive(Serialize)]
pub struct WebviewsReady {
    dim: bool,
    discord: bool,
}

#[tauri::command]
pub fn webviews_ready() -> WebviewsReady {
    WebviewsReady {
        dim: crate::dim::LOADED.load(Ordering::SeqCst),
        discord: LOADED.load(Ordering::SeqCst),
    }
}

/// Load Discord hidden at app start, so its tab opens ready.
#[tauri::command]
pub async fn discord_preload(app: AppHandle) -> Result<(), String> {
    let window = app.get_window("main").ok_or(tr("Hauptfenster nicht gefunden", "Main window not found"))?;
    // Roughly the final size, so Discord doesn't start in its phone layout.
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

/// Radar's page (re)loads (F5): the tab's webview, which lies over the page
/// and isn't part of it, goes too; the page opens it again when wanted.
pub fn hide_tab(app: &AppHandle) {
    if let Some(webview) = app.get_webview(LABEL) {
        let _ = webview.hide();
    }
}

#[tauri::command]
pub async fn discord_hide_now(app: AppHandle, seq: Option<u64>) -> Result<(), String> {
    if !crate::dim::newest(&SEQ, seq) {
        return Ok(());
    }
    if let Some(webview) = app.get_webview(LABEL) {
        webview.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// A picture of Discord (data URL) for the page swap, like DIM's.
#[tauri::command]
pub async fn discord_snapshot(app: AppHandle) -> Result<Option<String>, String> {
    use base64::Engine;
    let Some(webview) = app.get_webview(LABEL) else { return Ok(None) };
    // PNG: the page is see-through, a JPEG would turn that black.
    let jpeg = crate::dim::capture(&webview, true).await?;
    Ok((!jpeg.is_empty())
        .then(|| format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(jpeg))))
}

/// Open a Discord address (a pinned channel, or home).
#[tauri::command]
pub async fn discord_open(app: AppHandle, url: String) -> Result<(), String> {
    let url: Url = url.parse().map_err(|_| tr("Ungültige Adresse", "Invalid address"))?;
    if !is_discord(&url) {
        return Err(tr("Nur Discord-Adressen", "Discord addresses only").into());
    }
    let webview = app.get_webview(LABEL).ok_or(tr("Discord ist noch nicht geladen", "Discord isn't loaded yet"))?;
    // Discord is one page that switches channels itself: told through its
    // router (as its own links do), not by loading the page anew.
    if webview.url().is_ok_and(|u| is_discord(&u)) {
        let path = serde_json::to_string(&format!("{}{}", url.path(), url.query().map_or(String::new(), |q| format!("?{q}"))))
            .map_err(|e| e.to_string())?;
        return webview
            .eval(format!("history.pushState(null, '', {path}); dispatchEvent(new PopStateEvent('popstate', {{ state: null }}));"))
            .map_err(|e| e.to_string());
    }
    webview.navigate(url).map_err(|e| e.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Current {
    url: String,
    title: String,
}

/// The webview's own document title (Discord shows the channel there).
async fn title(webview: &Webview) -> Option<String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    webview
        .with_webview(move |platform| {
            let title = (|| -> windows::core::Result<String> {
                let core = unsafe { platform.controller().CoreWebView2()? };
                let mut title = windows::core::PWSTR::null();
                unsafe { core.DocumentTitle(&mut title)? };
                Ok(webview2_com::take_pwstr(title))
            })();
            let _ = tx.send(title.ok());
        })
        .ok()?;
    rx.await.ok().flatten()
}

/// Where Discord is right now (to pin the open channel).
#[tauri::command]
pub async fn discord_current(app: AppHandle) -> Result<Current, String> {
    let webview = app.get_webview(LABEL).ok_or(tr("Discord ist noch nicht geladen", "Discord isn't loaded yet"))?;
    let url = webview.url().map_err(|e| e.to_string())?.to_string();
    Ok(Current { url, title: title(&webview).await.unwrap_or_default() })
}

#[tauri::command]
pub fn discord_config(app: AppHandle) -> DiscordConfig {
    config(&app)
}

/// Destiny's language, for the command join buttons copy.
#[tauri::command]
pub fn discord_set_game_language(app: AppHandle, language: String) -> Result<DiscordConfig, String> {
    let mut c = config(&app);
    c.game_language = language;
    let c = store(&app, c)?;
    *GAME_LANG.lock().unwrap() = c.game_language.clone();
    push_language(&app);
    Ok(c)
}

#[tauri::command]
pub fn discord_save_pins(app: AppHandle, pins: Vec<Pin>) -> Result<DiscordConfig, String> {
    let pins = pins
        .into_iter()
        .filter(|p| p.url.parse::<Url>().is_ok_and(|u| is_discord(&u)))
        .collect();
    let saved = store(&app, DiscordConfig { pins, ..config(&app) })?;
    // New pins: warmed too.
    if let Some(webview) = app.get_webview(LABEL) {
        let _ = webview.eval(warm_script(&app));
    }
    Ok(saved)
}

#[tauri::command]
pub fn discord_set_focus(app: AppHandle, on: bool) {
    FOCUS.store(on, Ordering::SeqCst);
    if let Some(webview) = app.get_webview(LABEL) {
        apply_focus(&webview);
        // Picking channels: Discord gets the keyboard and wheel focus (the
        // click on "add" left it with Radar's page, so the wheel scrolled
        // nothing until something in Discord was clicked).
        if !on {
            let _ = webview.set_focus();
        }
    }
}
