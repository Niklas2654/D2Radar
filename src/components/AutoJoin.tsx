import { useEffect, useRef, useState } from "react";
import { useT } from "../lib/i18n";
import { call, isTauri, subscribe } from "../lib/tauri";
import { cx, GlassButton, GlassInput, GlassSwitch } from "./glass";

interface Pin {
  url: string;
  name: string;
}

/** What was last searched for (discord.rs: Watch). */
export interface Watch {
  keywords: string;
  channels: string[];
}

interface Status {
  active: boolean;
  /** The message the last search ended on. */
  found?: { name: string; text: string; typed: boolean } | null;
}

const OPEN_KEY = "radar.autoJoinOpen";

/**
 * The search that joins by itself: the pinned channels ticked are watched in
 * the background for the first new post that holds all keywords (anywhere in
 * its text) and a join code; its command is then sent in Destiny's chat.
 * And the switch for join buttons doing the same on a click.
 */
export function AutoJoin({
  pins,
  watch,
  typeJoin,
  onTypeJoin,
}: {
  pins: Pin[];
  watch?: Watch;
  typeJoin: boolean;
  onTypeJoin: (on: boolean) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(OPEN_KEY) === "1";
    } catch {
      return false;
    }
  });
  const toggle = () => {
    try {
      localStorage.setItem(OPEN_KEY, open ? "0" : "1");
    } catch {
      // Storage unavailable: it still opens for this session.
    }
    setOpen(!open);
  };

  // Kept by Radar, the same as in the bar of Discord over the game: what is
  // ticked comes from there; the keywords are typed here and saved after a
  // pause (taken over from there while the field isn't being typed in).
  const [keywords, setKeywords] = useState("");
  const typing = useRef(false);
  const saveAt = useRef(0);
  useEffect(() => {
    if (watch && !typing.current) setKeywords(watch.keywords);
  }, [watch]);
  const channels = watch?.channels ?? [];
  // Channels unpinned since are no longer searched.
  const picked = channels.filter((c) => pins.some((p) => p.url === c));
  const save = (next: { keywords?: string; channels?: string[] }) => {
    window.clearTimeout(saveAt.current);
    void call("discord_watch_set", { keywords: next.keywords ?? keywords, channels: next.channels ?? picked });
  };

  const [status, setStatus] = useState<Status>({ active: false });
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void call<Status>("discord_watch_state").then((s) => s && setStatus(s));
    return subscribe<Status>("discord-watch", setStatus);
  }, []);

  const start = () => {
    setError(null);
    void call<Status>("discord_watch_start", { keywords, channels: picked })
      .then((s) => s && setStatus(s))
      .catch((e) => setError(String(e)));
  };
  const stop = () => void call<Status>("discord_watch_stop").then((s) => s && setStatus(s));

  const found = status.found;
  return (
    <div className="mt-3 rounded-xl border border-white/[0.08] bg-white/[0.04]">
      <button onClick={toggle} className="flex w-full items-center gap-2 px-2.5 py-2 text-left">
        <span className="flex-1 text-[10px] font-semibold tracking-[0.14em] text-white/40 uppercase">{t("discord.autoJoin")}</span>
        {status.active && <span className="text-[11px] text-(--accent-text)">{t("discord.autoJoinSearching")}</span>}
        <span className={cx("text-[10px] text-white/40 transition-transform duration-200", !open && "-rotate-90")}>▾</span>
      </button>
      {open && (
        <div className="flex flex-col gap-2 px-2.5 pb-2.5">
          <GlassInput
            className="h-9 px-3 text-[12.5px]"
            value={keywords}
            disabled={status.active}
            placeholder={t("discord.autoJoinKeywords")}
            onFocus={() => (typing.current = true)}
            onBlur={() => (typing.current = false)}
            onChange={(e) => {
              const value = e.target.value;
              setKeywords(value);
              window.clearTimeout(saveAt.current);
              saveAt.current = window.setTimeout(() => save({ keywords: value }), 400);
            }}
            onKeyDown={(e) => e.key === "Enter" && !status.active && start()}
          />
          <p className="text-[11px] leading-snug text-white/40">{t("discord.autoJoinHint")}</p>
          {pins.length === 0 ? (
            <p className="text-[11.5px] text-white/45">{t("discord.autoJoinNoPins")}</p>
          ) : (
            <div className="flex max-h-28 flex-col overflow-y-auto">
              {pins.map((p) => {
                const on = picked.includes(p.url);
                return (
                  <button
                    key={p.url}
                    role="checkbox"
                    aria-checked={on}
                    disabled={status.active}
                    onClick={() => save({ channels: on ? picked.filter((c) => c !== p.url) : [...picked, p.url] })}
                    className="flex items-center gap-2 rounded-lg px-1 py-1 text-left hover:bg-white/[0.05] disabled:opacity-60"
                  >
                    <span
                      className={cx(
                        "grid size-3.5 shrink-0 place-items-center rounded-[4px] border text-[9px] leading-none",
                        on ? "border-transparent bg-(--accent) text-black" : "border-white/20",
                      )}
                    >
                      {on && "✓"}
                    </span>
                    <span className="truncate text-[12px] text-white/75">{p.name}</span>
                  </button>
                );
              })}
            </div>
          )}
          {status.active ? (
            <GlassButton size="sm" onClick={stop}>
              {t("discord.autoJoinStop")}
            </GlassButton>
          ) : (
            <GlassButton size="sm" variant="primary" onClick={start} disabled={!isTauri || !keywords.trim() || picked.length === 0}>
              {t("discord.autoJoinStart")}
            </GlassButton>
          )}
          {error && <p className="text-[11.5px] text-red-200">{error}</p>}
          {!status.active && found && (
            <div className="rounded-lg bg-white/[0.04] px-2 py-1.5">
              <div className="text-[12px] font-medium text-white">
                {t(found.typed ? "discord.autoJoinSent" : "discord.autoJoinCopied", { name: found.name })}
              </div>
              <div className="mt-0.5 line-clamp-3 text-[11px] leading-snug break-words text-white/45">{found.text}</div>
            </div>
          )}
          <div className="border-t border-white/[0.06] pt-1 [&_span]:text-[12px]!">
            <GlassSwitch
              checked={typeJoin}
              onChange={onTypeJoin}
              label={t("discord.typeJoin")}
              description={t(typeJoin ? "discord.typeJoinOn" : "discord.typeJoinOff")}
            />
          </div>
        </div>
      )}
    </div>
  );
}
