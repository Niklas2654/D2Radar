import { useEffect, useRef, useState, type CSSProperties } from "react";
import { CopySwap } from "../components/CopySwap";
import { cx, GlassButton, GlassPanel, PanelHeader } from "../components/glass";
import { IconChat, IconClose, IconHome, IconPlus } from "../components/icons";
import type { Direction, Phase } from "../components/PageTransition";
import { useT } from "../lib/i18n";
import { accentColor, useSettings } from "../lib/settings";
import { call, isTauri, nextSeq, subscribe } from "../lib/tauri";

const HOME = "https://discord.com/app";

interface Pin {
  url: string;
  name: string;
}

/** A Discord server as its list shows it (read by the Discord page). */
interface Server {
  name: string;
  icon?: string | null;
}

interface DiscordConfig {
  pins: Pin[];
  noFocus: boolean;
  /** By server id (the first number in a channel's link). */
  servers?: Record<string, Server>;
  /** Destiny's language: its chat commands are translated. */
  gameLanguage?: string;
}

/** The join command in each game language Destiny is known to translate. */
export const JOIN_VERBS: { id: string; label: string; verb: string }[] = [
  { id: "en", label: "EN", verb: "/join" },
  { id: "de", label: "DE", verb: "/beitreten" },
  { id: "fr", label: "FR", verb: "/rejoindre" },
  { id: "zh", label: "中文", verb: "/加入" },
];
const verbFor = (language?: string) => (JOIN_VERBS.find((v) => v.id === language) ?? JOIN_VERBS[0]).verb;

/** The player's own join command (in the game language set in Settings), to
 *  paste into an LFG message. */
function MyJoinCode({ language }: { language?: string }) {
  const t = useT();
  // The account signed in (Bungie login), the one being played on.
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    if (isTauri) void call<string | null>("own_join_name").then((n) => setName(n ?? null)).catch(() => {});
  }, []);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(id);
  }, [copied]);
  if (!name?.includes("#")) return null;
  const verb = verbFor(language);
  const command = `${verb} ${name}`;
  return (
    <div className="mt-3 rounded-xl border border-white/[0.08] bg-white/[0.04] p-2.5">
      <div className="mb-1.5 text-[10px] font-semibold tracking-[0.14em] text-white/40 uppercase">{t("discord.myCode")}</div>
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-display text-[13px] font-semibold tracking-tight text-white" title={command}>
          <span className="mr-1 font-medium text-(--accent-text)">{verb}</span>
          {name}
        </span>
        <GlassButton
          size="sm"
          variant="primary"
          onClick={() => void navigator.clipboard.writeText(command).then(() => setCopied(true))}
        >
          <CopySwap copied={copied} label={t("discord.copy")} done={t("common.copied")} />
        </GlassButton>
      </div>
    </div>
  );
}

/** A channel's name from Discord's page title ("#raids | Destiny 2 LFG" …). */
function channelName(title: string): string {
  const parts = title.split("|").map((p) => p.trim()).filter(Boolean);
  return parts.find((p) => p.startsWith("#")) ?? parts.find((p) => p !== "Discord") ?? title;
}

/** Load Discord hidden in the background, so its tab opens ready. */
export function preloadDiscord(accent: string) {
  if (!isTauri) return;
  // The accent first: the page picks it up when it has loaded.
  void call("discord_set_accent", { color: accent }).then(() => call("discord_preload"));
}

/** The latest picture of Discord (data URL); kept across visits of the tab. */
let lastSnapshot: string | null = null;
/** Pictures are taken when the pointer heads for the navbar; this is only a
 *  fallback (taking one makes the page stutter for a moment). */
const SNAPSHOT_EVERY_MS = 20_000;

/**
 * Discord in a tab: the real Discord web app (the player logs in
 * themselves) with Radar's own bar of pinned channels and a focus mode.
 * Page swaps slide a picture of Discord along, like the DIM tab.
 */
const CLOSED_KEY = "radar.discordClosedServers";

/** The server (its id) a pin's channel is on. */
const serverOf = (pin: Pin) => /\/channels\/(\d+)\//.exec(pin.url)?.[1] ?? "";

/** Pins grouped by their server (the id in the link), in pinned order. */
function groupByServer(pins: Pin[]): [string, Pin[]][] {
  const groups = new Map<string, Pin[]>();
  for (const pin of pins) {
    const server = serverOf(pin);
    groups.set(server, [...(groups.get(server) ?? []), pin]);
  }
  return [...groups];
}

/** A server's icon, or its initials (as Discord shows servers without one). */
function ServerIcon({ server }: { server?: Server }) {
  if (server?.icon) return <img src={server.icon} alt="" className="size-5 shrink-0 rounded-md object-cover" />;
  const initials = (server?.name ?? "?")
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 3);
  return (
    <span className="grid size-5 shrink-0 place-items-center rounded-md bg-(--accent-soft) text-[8.5px] font-bold text-white">
      {initials}
    </span>
  );
}

export function DiscordPage({ phase }: { phase: Phase; dir: Direction }) {
  const t = useT();
  const host = useRef<HTMLDivElement>(null);
  const [config, setConfig] = useState<DiscordConfig>({ pins: [], noFocus: false });
  const [active, setActive] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Discord in Radar's accent color.
  const [settings] = useSettings();
  const accent = accentColor(settings);
  useEffect(() => {
    void call("discord_set_accent", { color: accent });
    // Again once the page is in place (the webview may be new then).
  }, [accent, phase]);
  // Picking a channel to add: all of Discord shows (server and channel
  // lists); otherwise only the chat of the open channel.
  const [picking, setPicking] = useState(false);
  useEffect(() => {
    void call("discord_set_focus", { on: !picking });
  }, [picking]);
  // Back to just the chat when leaving the tab mid-pick.
  useEffect(() => () => void call("discord_set_focus", { on: true }), []);
  const [snapshot, setSnapshot] = useState(lastSnapshot);
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  // The native webview can't slide with the page: it only shows once the
  // page has arrived. Until then its last picture (or, on the first visit,
  // the loading panel) slides in with the page.
  const webviewShown = phase === "active";
  // What lies under the webview (its picture, the loading hint) only shows
  // while the page moves: under the see-through webview it would shine
  // through (and look smeared when scrolling).
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (phase !== "active") {
      setSettled(false);
      return;
    }
    const id = window.setTimeout(() => setSettled(true), 250);
    return () => window.clearTimeout(id);
  }, [phase]);
  const underlay = phase !== "active" || !settled;

  useEffect(() => {
    void call<DiscordConfig>("discord_config").then((c) => {
      if (!c) return;
      setConfig(c);
      // Discord starts in the first pinned channel (see discord.rs).
      setActive((a) => a ?? c.pins[0]?.url ?? HOME);
    });
    // Server names and icons arrive once Discord's server list is there.
    return subscribe<DiscordConfig>("discord-config", setConfig);
  }, []);
  // Servers whose channels are folded away (kept across starts).
  const [closed, setClosed] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(CLOSED_KEY) ?? "[]") as string[];
    } catch {
      return [];
    }
  });
  const toggleServer = (id: string) =>
    setClosed((list) => {
      const next = list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
      try {
        localStorage.setItem(CLOSED_KEY, JSON.stringify(next));
      } catch {
        // Storage unavailable: folding still works for this session.
      }
      return next;
    });

  // The webview sits exactly over the host element.
  useEffect(() => {
    const el = host.current;
    if (!isTauri || !webviewShown || !el) return;
    const show = () => {
      const container = el.offsetParent?.parentElement;
      if (!container) return;
      const base = container.getBoundingClientRect();
      void call("discord_show", {
        bounds: { x: base.left + el.offsetLeft, y: base.top + el.offsetTop, width: el.offsetWidth, height: el.offsetHeight },
        seq: nextSeq(),
      });
    };
    show();
    const observer = new ResizeObserver(show);
    observer.observe(el);
    window.addEventListener("resize", show);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", show);
      void call("discord_hide_now", { seq: nextSeq() });
    };
  }, [webviewShown]);

  // Keep the picture for page swaps fresh while Discord is shown.
  useEffect(() => {
    if (!isTauri || phase !== "active") return;
    let last = 0;
    const take = () => {
      if (document.hidden || Date.now() - last < 400) return;
      last = Date.now();
      void call<string | null>("discord_snapshot")
        .then((url) => {
          if (url) {
            lastSnapshot = url;
            setSnapshot(url);
          }
        })
        .catch(() => {});
    };
    const first = window.setTimeout(take, 900);
    const id = window.setInterval(take, SNAPSHOT_EVERY_MS);
    window.addEventListener("radar:nav-hover", take);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
      window.removeEventListener("radar:nav-hover", take);
    };
  }, [phase]);

  const open = (url: string) => {
    setError(null);
    setActive(url);
    void call("discord_open", { url }).catch((e) => setError(String(e)));
  };

  // A channel dragged to another place in its server's list: where it is
  // dragged from, and the one it is over (and above or below it).
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<{ url: string; below: boolean } | null>(null);
  const drop = () => {
    const from = config.pins.find((p) => p.url === dragging);
    const to = config.pins.find((p) => p.url === over?.url);
    setDragging(null);
    setOver(null);
    if (!from || !to || from === to || serverOf(from) !== serverOf(to)) return;
    const rest = config.pins.filter((p) => p !== from);
    const at = rest.indexOf(to) + (over?.below ? 1 : 0);
    savePins([...rest.slice(0, at), from, ...rest.slice(at)]);
  };

  const savePins = (pins: Pin[]) =>
    void call<DiscordConfig>("discord_save_pins", { pins })
      .then((c) => c && setConfig(c))
      .catch((e) => setError(String(e)));

  const pinCurrent = async () => {
    setError(null);
    try {
      const current = await call<{ url: string; title: string }>("discord_current");
      if (!current) return;
      if (!/\/channels\/\d+\/\d+/.test(current.url)) {
        setError(t("discord.noChannel"));
        return;
      }
      if (!config.pins.some((p) => p.url === current.url)) {
        savePins([...config.pins, { url: current.url, name: channelName(current.title) }]);
      }
      setActive(current.url);
      setPicking(false);
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div className="flex h-full gap-4 p-5">
      <GlassPanel className="flex w-64 shrink-0 flex-col p-4">
        <PanelHeader icon={<IconChat />} title={t("discord.title")} subtitle={t("discord.subtitle")} />
        <div className="-mx-1 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-1 [&>*]:shrink-0">
          <button
            onClick={() => open(HOME)}
            className={cx(
              "flex items-center gap-2 rounded-xl px-2.5 py-2 text-left text-[13px] transition-colors",
              active === HOME ? "bg-(--accent-soft) text-white" : "text-white/70 hover:bg-white/[0.05]",
            )}
          >
            <span className="scale-90 text-white/50">
              <IconHome />
            </span>
            {t("discord.home")}
          </button>
          <div className="mt-2 mb-1 px-1 text-[10.5px] font-semibold tracking-[0.14em] text-white/40 uppercase">
            {t("discord.pins")}
          </div>
          {config.pins.length === 0 && <p className="px-1 text-[12px] leading-relaxed text-white/45">{t("discord.pinHint")}</p>}
          {groupByServer(config.pins).map(([server, pins]) => {
            const info = config.servers?.[server];
            const expanded = !closed.includes(server);
            const here = pins.some((p) => p.url === active);
            return (
              <div
                key={server}
                className={cx("rounded-2xl border bg-white/[0.025] p-1", here ? "border-(--accent-glow)" : "border-white/[0.06]")}
              >
                <button
                  onClick={() => toggleServer(server)}
                  title={info?.name}
                  className="flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-white/[0.05]"
                >
                  <ServerIcon server={info} />
                  <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-white/85">
                    {info?.name ?? t("discord.server")}
                  </span>
                  <span className={cx("text-[10px] text-white/40 transition-transform duration-200", !expanded && "-rotate-90")}>▾</span>
                </button>
                {expanded && (
                  <div className="flex flex-col gap-0.5 pt-0.5 pl-1.5">
                    {pins.map((p) => (
                      <div
                        key={p.url}
                        // Dragged within its server's list to reorder.
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.effectAllowed = "move";
                          e.dataTransfer.setData("text/plain", p.url);
                          setDragging(p.url);
                        }}
                        onDragOver={(e) => {
                          const from = config.pins.find((x) => x.url === dragging);
                          if (!from || serverOf(from) !== serverOf(p)) return;
                          e.preventDefault();
                          const r = e.currentTarget.getBoundingClientRect();
                          const below = e.clientY > r.top + r.height / 2;
                          if (over?.url !== p.url || over.below !== below) setOver({ url: p.url, below });
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          drop();
                        }}
                        onDragEnd={() => {
                          setDragging(null);
                          setOver(null);
                        }}
                        className={cx(
                          "group relative flex cursor-grab items-center gap-1 rounded-xl transition-colors active:cursor-grabbing",
                          active === p.url ? "bg-(--accent-soft)" : "hover:bg-white/[0.05]",
                          dragging === p.url && "opacity-40",
                        )}
                      >
                        {/* Where it lands. */}
                        {over?.url === p.url && dragging !== p.url && (
                          <span
                            aria-hidden
                            className={cx(
                              "pointer-events-none absolute inset-x-2 h-0.5 rounded-full bg-(--accent-text)",
                              over.below ? "-bottom-px" : "-top-px",
                            )}
                          />
                        )}
                        <button onClick={() => open(p.url)} className="flex min-w-0 flex-1 items-center gap-2 px-2.5 py-2 text-left">
                          <span className={cx("text-[15px] leading-none", active === p.url ? "text-(--accent-text)" : "text-white/35")}>
                            #
                          </span>
                          <span className={cx("truncate text-[13px]", active === p.url ? "font-medium text-white" : "text-white/75")}>
                            {p.name.replace(/^#/, "")}
                          </span>
                        </button>
                        <button
                          onClick={() => savePins(config.pins.filter((x) => x.url !== p.url))}
                          title={t("discord.remove")}
                          className="mr-1 grid size-7 shrink-0 place-items-center rounded-lg text-white/35 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-white/10 hover:text-white"
                        >
                          <IconClose />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {error && <p className="mt-2 rounded-lg border border-red-400/20 bg-red-500/10 px-3 py-2 text-[12px] text-red-200">{error}</p>}
        <MyJoinCode language={config.gameLanguage} />
        {picking ? (
          <div className="mt-3 flex flex-col gap-2 rounded-2xl border border-(--accent-glow) bg-(--accent-soft) p-3">
            <p className="text-[12px] leading-relaxed text-white/80">{t("discord.pickHint")}</p>
            <GlassButton size="sm" variant="primary" onClick={() => void pinCurrent()}>
              {t("discord.pinThis")}
            </GlassButton>
            <GlassButton size="sm" onClick={() => setPicking(false)}>
              {t("discord.done")}
            </GlassButton>
          </div>
        ) : (
          <GlassButton size="sm" className="mt-3" onClick={() => setPicking(true)} disabled={!isTauri}>
            <IconPlus /> {t("discord.add")}
          </GlassButton>
        )}
      </GlassPanel>

      {/* The native webview is placed exactly over this element. */}
      <div
        ref={host}
        className="glass glass-subtle relative grid min-h-0 flex-1 place-items-center overflow-hidden"
        style={{ "--glass-radius": "14px" } as CSSProperties}
      >
        {underlay && snapshot && (
          <img src={snapshot} alt="" draggable={false} className="absolute inset-0 z-10 size-full object-cover" />
        )}
        <div className={cx("flex max-w-xs flex-col items-center gap-3 text-center", !underlay && "invisible")}>
          <span className="size-9 animate-spin rounded-full border-2 border-white/10 border-t-(--accent)" />
          <p className="text-[13px] text-white/55">{isTauri ? t("discord.loading") : t("discord.desktopOnly")}</p>
          <p className="text-[12px] text-white/35">{t("discord.loginHint")}</p>
        </div>
      </div>
    </div>
  );
}
