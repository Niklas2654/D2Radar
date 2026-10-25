import { openUrl } from "@tauri-apps/plugin-opener";
import { StatHover } from "../components/StatEffects";
import { statIdOf } from "../lib/statEffects";
import { ClarityCredit, CompendiumCredit, ExoticArmorPerks } from "../components/Clarity";
import { useScrollTopOn } from "../lib/scrollTop";
import { CopySwap } from "../components/CopySwap";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { cx, GlassButton, GlassInput, GlassPanel, PanelHeader, StatTile } from "../components/glass";
import { IconClose, IconCrown, IconExternal, IconRefresh, IconSearch, IconUsers } from "../components/icons";
import { useNow } from "../components/widgets";
import { formatAgo, type Snapshot } from "../lib/bungie";
import { LOCALES, useLanguage, useT, type Translate } from "../lib/i18n";
import {
  type CharacterBuild,
  BUNGIE,
  formatClock,
  loadPlayer,
  profileLinks,
  searchPlayer,
  playerCard,
  suggestPlayers,
  usePlayer,
  usePlayers,
  type ArmorSet,
  type CharacterInfo,
  type Clears,
  type ItemInfo,
  type PlayerDetail,
  type PlayerCard,
  type PlayerSuggestion,
} from "../lib/fireteam";
import { call, isTauri, OPEN_PLAYER_EVENT } from "../lib/tauri";
import { ActivityRuns } from "../components/ActivityRuns";
import { ClassIcon } from "../components/ClassIcon";
import { RunReport } from "../components/RunReport";
import { CountUp } from "../components/CountUp";
import { FULL_CLEARS_STUCK, useFullClears, type RaidFullClears, type RaidTag } from "../lib/fullclears";
import { useSessionTeam, type TeamPlayer } from "../lib/session";
import { bestTier, tierFor, type Tier } from "../lib/tiers";

interface ListEntry {
  id: string;
  name: string | null;
  isLeader?: boolean;
  isSelf?: boolean;
  /** Shown until the full profile is loaded (session team rows). */
  preview?: Pick<TeamPlayer, "className" | "light" | "emblemPath" | "completed">;
}

const open = (url: string) => (isTauri ? void openUrl(url) : window.open(url));

/** The last players looked up (see lib/preload: loaded at start too). */
export const SEARCHED_KEY = "radar.searchedPlayers";
function readSearched(): ListEntry[] {
  try {
    return JSON.parse(localStorage.getItem(SEARCHED_KEY) ?? "[]") as ListEntry[];
  } catch {
    return [];
  }
}

/** Session activities the player removed from the list (instance ids). */
const HIDDEN_KEY = "radar.hiddenSessionActivities";
function readHidden(): string[] {
  try {
    return JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
}

/** A list row with a remove button (on hover). */
function Removable({ label, onRemove, children }: { label: string; onRemove: () => void; children: ReactNode }) {
  return (
    // Full width like the other rows; the remove button a small round one on
    // the top-right corner, shown on hover (over nothing in the row).
    <div className="group/rm relative flex flex-col">
      {children}
      <button
        onClick={onRemove}
        title={label}
        aria-label={label}
        className="absolute -top-1 -right-1 z-10 grid size-5 scale-90 place-items-center rounded-full border border-white/15 bg-[#0b0e16] text-white/60 opacity-0 shadow-[0_2px_8px_rgb(0_0_0/0.6)] transition-[opacity,scale] duration-150 group-hover/rm:scale-100 group-hover/rm:opacity-100 hover:border-red-400/60 hover:bg-red-500/80 hover:text-white focus-visible:opacity-100 [&_svg]:size-2.5"
      >
        <IconClose />
      </button>
    </div>
  );
}

export function FireteamPage({ snapshot }: { snapshot: Snapshot }) {
  const t = useT();
  // The fireteam from the live poll; offline it's just the player themself.
  const party: ListEntry[] =
    snapshot.party.length > 0
      ? snapshot.party.map((m) => ({ id: m.membershipId, name: m.displayName, isLeader: m.isLeader, isSelf: m.isSelf }))
      : snapshot.player
        ? [{ id: snapshot.player.membershipId, name: snapshot.player.displayName, isSelf: true }]
        : [];
  // The last players looked up, kept across starts (and loaded at start).
  const [searched, setSearchedState] = useState<ListEntry[]>(readSearched);
  const setSearched = (update: (list: ListEntry[]) => ListEntry[]) =>
    setSearchedState((list) => {
      const next = update(list);
      try {
        localStorage.setItem(SEARCHED_KEY, JSON.stringify(next));
      } catch {
        // Storage unavailable: just not kept.
      }
      return next;
    });
  const [selected, setSelected] = useState<string | null>(null);
  // A player clicked in a run's report: shown, and kept as one searched.
  useEffect(() => {
    const open = (e: Event) => {
      const { membershipId, name } = (e as CustomEvent<{ membershipId: string; name: string }>).detail;
      setSearched((list) => [{ id: membershipId, name }, ...list.filter((m) => m.id !== membershipId)].slice(0, 5));
      setSelected(membershipId);
    };
    window.addEventListener(OPEN_PLAYER_EVENT, open);
    return () => window.removeEventListener(OPEN_PLAYER_EVENT, open);
    // setSearched keeps its identity enough: the list is read inside.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [tab, setTab] = useState<StatsTab>("pve");
  const current = selected ?? party[0]?.id ?? null;
  // Another player: from the top.
  const playerScroll = useScrollTopOn(current);

  const [hidden, setHiddenState] = useState<string[]>(readHidden);
  const hide = (ids: string[]) =>
    setHiddenState((list) => {
      // Only the newest ones are kept (activity ids don't come back).
      const next = [...new Set([...ids, ...list])].slice(0, 100);
      try {
        localStorage.setItem(HIDDEN_KEY, JSON.stringify(next));
      } catch {
        // Storage unavailable: hidden until the next start.
      }
      return next;
    });
  const sessionTeam = useSessionTeam(snapshot.updatedAt).filter((a) => !hidden.includes(a.instanceId));

  // Matchmade players in the running activity aren't known until it ends.
  const matchmade = Math.max(0, (snapshot.online ? snapshot.activityPlayers ?? 0 : 0) - Math.max(1, party.length));

  // As soon as an activity's report is in, load its players' full profiles,
  // so a click shows raids, PvP and build right away.
  const latestTeam = sessionTeam[0]?.players.map((p) => p.membershipId).join(",") ?? "";
  useEffect(() => {
    latestTeam.split(",").filter(Boolean).forEach((id) => void loadPlayer(id));
  }, [latestTeam]);

  // Warm the cache for everyone in the fireteam so the list shows class/light.
  const partyKey = party.map((p) => p.id).join(",");
  useEffect(() => {
    partyKey.split(",").filter(Boolean).forEach((id) => void loadPlayer(id));
  }, [partyKey]);

  return (
    <div className="grid h-full grid-cols-[300px_minmax(0,1fr)] gap-4 p-5">
      <div className="flex min-h-0 flex-col gap-4">
        <GlassPanel className="flex min-h-0 flex-col p-4">
          <PanelHeader
            icon={<IconUsers />}
            title={t("nav.fireteam")}
            subtitle={
              snapshot.party.length > 1
                ? t("fireteam.guardians", { n: snapshot.party.length })
                : snapshot.online
                  ? t("fireteam.alone")
                  : t("common.notInGame")
            }
          />
          {/* Rows keep their height (shrink-0): a long list scrolls instead of squeezing them. */}
          <div className="-mx-1 flex min-h-0 flex-col gap-1.5 overflow-y-auto px-1 [&>*]:shrink-0">
            {party.map((m) => (
              <MemberRow key={m.id} entry={m} selected={current === m.id} onSelect={() => setSelected(m.id)} />
            ))}
            {matchmade > 0 && (
              <div
                className="animate-widget-in rounded-xl border border-dashed border-white/15 px-3 py-2.5"
                title={t("fireteam.matchmadeHint")}
              >
                <div className="text-[13px] font-medium text-white/80">{t("fireteam.matchmade", { n: matchmade })}</div>
                <div className="text-[11.5px] text-white/40">{t("fireteam.matchmadeHint")}</div>
              </div>
            )}

            {sessionTeam.length > 0 && (
              <div className="mt-3 mb-0.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10.5px] font-semibold tracking-[0.14em] text-white/40 uppercase">
                    {t("fireteam.sessionTeam")}
                  </span>
                  <button
                    onClick={() => hide(sessionTeam.map((a) => a.instanceId))}
                    className="text-[11px] text-white/35 hover:text-white/80"
                  >
                    {t("fireteam.clearAll")}
                  </button>
                </div>
                <div className="text-[11px] text-white/30">{t("fireteam.sessionTeamHint")}</div>
              </div>
            )}
            {sessionTeam.map((activity) => (
              <div key={activity.instanceId} className="flex flex-col gap-1.5">
                <div className="group/act mt-1 flex items-center gap-1.5">
                  <span className="min-w-0 flex-1 truncate text-[11px] text-white/45">
                    {t("fireteam.activityEnded", {
                      name: activity.name ?? "—",
                      ago: formatAgo(activity.endedAt, Date.now(), t),
                    })}
                  </span>
                  <button
                    onClick={() => hide([activity.instanceId])}
                    title={t("fireteam.hideActivity")}
                    aria-label={t("fireteam.hideActivity")}
                    className="grid size-5 shrink-0 place-items-center rounded text-white/35 opacity-0 transition-opacity group-hover/act:opacity-100 hover:bg-white/10 hover:text-white focus-visible:opacity-100 [&_svg]:size-3"
                  >
                    <IconClose />
                  </button>
                </div>
                {activity.players.map((p) => (
                  <MemberRow
                    key={`${activity.instanceId}-${p.membershipId}`}
                    entry={{ id: p.membershipId, name: p.displayName, preview: p }}
                    selected={current === p.membershipId}
                    onSelect={() => setSelected(p.membershipId)}
                  />
                ))}
              </div>
            ))}
            {searched.length > 0 && (
              <div className="mt-3 mb-1 flex items-center justify-between gap-2">
                <span className="text-[10.5px] font-semibold tracking-[0.14em] text-white/40 uppercase">
                  {t("fireteam.searched")}
                </span>
                <button
                  onClick={() => {
                    if (searched.some((m) => m.id === selected)) setSelected(null);
                    setSearched(() => []);
                  }}
                  className="text-[11px] text-white/35 hover:text-white/80"
                >
                  {t("fireteam.clearAll")}
                </button>
              </div>
            )}
            {searched.map((m) => (
              <Removable
                key={m.id}
                label={t("fireteam.removeSearched")}
                onRemove={() => {
                  if (selected === m.id) setSelected(null);
                  setSearched((list) => list.filter((e) => e.id !== m.id));
                }}
              >
                <MemberRow entry={m} selected={current === m.id} onSelect={() => setSelected(m.id)} />
              </Removable>
            ))}
          </div>
        </GlassPanel>

        <SearchBox
          onFound={(id, name) => {
            setSearched((list) => [{ id, name }, ...list.filter((e) => e.id !== id)].slice(0, 5));
            setSelected(id);
          }}
        />
      </div>

      <div ref={playerScroll} className="-m-4 min-h-0 overflow-y-auto p-4 pr-5">
        {current ? (
          <PlayerView key={current} id={current} tab={tab} onTab={setTab} />
        ) : (
          <GlassPanel className="grid h-full place-items-center p-8 text-center text-[13px] text-white/50">
            {t("fireteam.connectHint")}
          </GlassPanel>
        )}
      </div>
    </div>
  );
}

/* ---------- Left column ---------- */

function MemberRow({ entry, selected, onSelect }: { entry: ListEntry; selected: boolean; onSelect: () => void }) {
  const t = useT();
  const { detail, loading } = usePlayers()(entry.id);
  const active = detail?.characters[0] ?? (entry.preview?.className ? {
    className: entry.preview.className,
    light: entry.preview.light ?? 0,
    emblemPath: entry.preview.emblemPath,
  } : undefined);
  const raid = detail ? tierFor(detail.totals.raidClears) : null;
  const dungeon = detail ? tierFor(detail.totals.dungeonClears) : null;
  // The whole row takes the color of the account's better rank.
  const tier = raid && dungeon ? bestTier(raid, dungeon) : null;
  return (
    <button
      onClick={onSelect}
      style={tier ? ({ "--tier": tier.color } as CSSProperties) : undefined}
      className={cx(
        // Rows are keyed by member, so only someone who just joined animates in.
        "group animate-widget-in relative flex items-center gap-3 overflow-hidden rounded-xl border p-2 text-left transition-[background-color,border-color,box-shadow] duration-200",
        // With clears, the card wears their tier color (border and background).
        tier
          ? selected
            ? "border-[color-mix(in_oklab,var(--tier)_70%,transparent)] bg-[linear-gradient(90deg,color-mix(in_oklab,var(--tier)_32%,transparent),color-mix(in_oklab,var(--tier)_8%,transparent))] shadow-[0_0_10px_-3px_var(--tier)]"
            : "border-[color-mix(in_oklab,var(--tier)_30%,transparent)] bg-[linear-gradient(90deg,color-mix(in_oklab,var(--tier)_20%,transparent),transparent_70%)] hover:border-[color-mix(in_oklab,var(--tier)_55%,transparent)]"
          : selected
            ? "border-(--accent-glow) bg-(--accent-soft) shadow-[0_0_10px_-3px_var(--accent-halo)]"
            : "border-white/[0.06] bg-white/[0.03] hover:border-white/15 hover:bg-white/[0.06]",
      )}
    >
      <div
        className={cx(
          "size-10 shrink-0 overflow-hidden rounded-lg bg-white/[0.06]",
          tier && "ring-2 ring-(--tier) shadow-[0_0_6px_-1px_var(--tier)]",
        )}
      >
        {active?.emblemPath && <img src={BUNGIE + active.emblemPath} alt="" className="size-full object-cover" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[13.5px] font-medium">{detail?.displayName ?? entry.name ?? t("common.loading")}</span>
          {entry.isLeader && (
            <span className="text-[#f5dc56]" title={t("fireteam.leader")}>
              <IconCrown />
            </span>
          )}
        </div>
        <div className="truncate text-[11.5px] text-white/45">
          {active ? `${active.className} · ◆ ${active.light}` : loading ? t("common.loading") : "—"}
          {entry.isSelf && ` · ${t("fireteam.you")}`}
          {entry.preview && !entry.preview.completed && ` · ${t("fireteam.leftEarly")}`}
        </div>
      </div>
      {raid && dungeon && detail && (
        <div className="flex shrink-0 flex-col gap-1">
          <TierChip letter="R" tier={raid} clears={detail.totals.raidClears} title={t("fireteam.raidClears")} />
          <TierChip letter="D" tier={dungeon} clears={detail.totals.dungeonClears} title={t("fireteam.dungeonClears")} />
        </div>
      )}
    </button>
  );
}

/** "5 hours ago", "3 days ago" … in the app's language. */
function playedAgo(iso: string, locale: string) {
  const minutes = Math.max(1, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (minutes < 60) return rtf.format(-minutes, "minute");
  if (minutes < 48 * 60) return rtf.format(-Math.round(minutes / 60), "hour");
  if (minutes < 60 * 24 * 60) return rtf.format(-Math.round(minutes / 1440), "day");
  if (minutes < 60 * 24 * 730) return rtf.format(-Math.round(minutes / 43_200), "month");
  return rtf.format(-Math.round(minutes / 525_600), "year");
}

/** How long typing has to pause before names are suggested. */
const SUGGEST_DELAY_MS = 250;

function SearchBox({ onFound }: { onFound: (id: string, name: string) => void }) {
  const t = useT();
  const locale = LOCALES[useLanguage()];
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Suggestions while typing; arrow keys pick one, Enter opens it.
  const [raw, setSuggestions] = useState<PlayerSuggestion[]>([]);
  const [active, setActive] = useState(-1);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  // Each suggested player's emblem and online status, loaded as they
  // appear; players online come first.
  const [cards, setCards] = useState<Record<string, PlayerCard>>({});
  useEffect(() => {
    for (const s of raw) {
      if (s.membershipId in cards) continue;
      void playerCard(s).then((c) => setCards((m) => ({ ...m, [s.membershipId]: c })));
    }
  }, [raw, cards]);
  // Accounts without a Destiny 2 profile left out (once their card says so).
  const suggestions = raw
    .filter((s) => !cards[s.membershipId]?.noDestiny)
    .sort((a, b) => Number(!!cards[b.membershipId]?.online) - Number(!!cards[a.membershipId]?.online));

  useEffect(() => {
    const prefix = name.trim();
    if (prefix.replace(/#.*/, "").length < 2) {
      setSuggestions([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const id = window.setTimeout(() => {
      suggestPlayers(prefix)
        .then((list) => {
          if (cancelled) return;
          setSuggestions(list);
          setActive(list.length > 0 ? 0 : -1);
        })
        .catch(() => !cancelled && setSuggestions([]))
        .finally(() => !cancelled && setSearching(false));
    }, SUGGEST_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [name]);

  const pick = (s: PlayerSuggestion) => {
    onFound(s.membershipId, s.name);
    setName("");
    setSuggestions([]);
    setOpen(false);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const chosen = open ? suggestions[active] : undefined;
    if (chosen) return pick(chosen);
    if (!name.includes("#")) return;
    setBusy(true);
    setError(null);
    try {
      const id = await searchPlayer(name);
      if (id) {
        onFound(id, name.trim());
        setName("");
        setOpen(false);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!open || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (a + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (a - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  const showList = open && name.trim().replace(/#.*/, "").length >= 2;

  return (
    <GlassPanel className="relative z-20 p-4">
      <form onSubmit={submit} className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <GlassInput
            placeholder={t("fireteam.searchPlaceholder")}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setOpen(true);
              setError(null);
            }}
            onKeyDown={onKey}
            onFocus={() => setOpen(true)}
            onClear={() => {
              setName("");
              setSuggestions([]);
              setError(null);
            }}
            clearLabel={t("common.clear")}
            onBlur={() => window.setTimeout(() => setOpen(false), 120)}
            role="combobox"
            aria-expanded={showList}
            aria-autocomplete="list"
          />
          {showList && (
            <ul
              role="listbox"
              className="animate-fade-in absolute inset-x-0 top-full z-50 mt-1.5 max-h-72 overflow-y-auto overscroll-contain rounded-xl border border-white/10 bg-[#0d1220]/97 py-1 shadow-[0_16px_40px_rgba(0,0,0,0.55)] backdrop-blur-md"
            >
              {suggestions.length === 0 ? (
                <li className="px-3 py-2 text-[12px] text-white/40">{searching ? t("fireteam.suggestSearching") : t("fireteam.suggestNone")}</li>
              ) : (
                suggestions.map((s, i) => {
                  const [base, code] = s.name.split("#");
                  return (
                    <li
                      key={s.membershipId}
                      role="option"
                      aria-selected={i === active}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => pick(s)}
                      onMouseEnter={() => setActive(i)}
                      className={cx(
                        "flex cursor-pointer items-center gap-2 px-3 py-1.5 text-[13px] transition-colors",
                        i === active ? "bg-(--accent-soft) text-white" : "text-white/75",
                      )}
                    >
                      <span
                        className={cx(
                          "grid size-7 shrink-0 place-items-center overflow-hidden rounded-md border bg-white/[0.06]",
                          i === active ? "border-(--accent-glow)" : "border-white/10",
                        )}
                      >
                        {cards[s.membershipId]?.emblem ? (
                          <img src={BUNGIE + cards[s.membershipId].emblem} alt="" className="animate-fade-in size-full object-cover" draggable={false} />
                        ) : !(s.membershipId in cards) ? (
                          <span className="skeleton size-full" />
                        ) : null}
                      </span>
                      <span className="truncate">{base}</span>
                      <span className="text-white/40">#{code}</span>
                      {cards[s.membershipId]?.online ? (
                        <span className="ml-auto flex shrink-0 items-center gap-1.5 text-[11px] font-medium text-emerald-300">
                          <span className="size-1.5 animate-pulse-dot rounded-full bg-emerald-400 shadow-[0_0_3px_rgb(52_211_153)]" />
                          {t("fireteam.online")}
                        </span>
                      ) : (
                        s.lastPlayed && (
                          <span className="ml-auto shrink-0 text-[11px] text-white/40">{playedAgo(s.lastPlayed, locale)}</span>
                        )
                      )}
                    </li>
                  );
                })
              )}
            </ul>
          )}
        </div>
        <GlassButton
          type="submit"
          disabled={busy || !(name.includes("#") || (open && suggestions[active]))}
          aria-label={t("fireteam.search")}
        >
          <IconSearch />
        </GlassButton>
      </form>
      {error && <p className="mt-2 text-[12px] text-red-300">{error}</p>}
    </GlassPanel>
  );
}

/**
 * Join someone's fireteam: Bungie has no way for apps to do it, but the
 * game's chat on PC does ("/join Name#1234"). The command goes to the
 * clipboard; the player pastes it in game (Radar never types into the game).
 */
function JoinButton({ name }: { name: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  // The hint is placed over everything (the banner it sits in clips).
  const [at, setAt] = useState<{ top: number; right: number } | null>(null);
  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 6000);
    return () => window.clearTimeout(id);
  }, [copied]);
  if (!name.includes("#")) return null;
  return (
    <div className="relative">
      <GlassButton
        size="sm"
        variant="primary"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setAt({ top: r.bottom + 8, right: window.innerWidth - r.right });
          void navigator.clipboard.writeText(`/join ${name}`).then(() => {
            setCopied(true);
            // Straight into the game: Enter, Ctrl+V, Enter are the player's.
            if (isTauri) void call("focus_destiny");
          });
        }}
      >
        <IconUsers /> <CopySwap copied={copied} label={t("join.button")} done={t("join.copied")} />
      </GlassButton>
      {copied &&
        at &&
        createPortal(
          <div
            className="animate-fade-in fixed z-[90] w-72 rounded-xl border border-white/10 bg-[#0d1220]/97 p-3 text-[12px] leading-relaxed text-white/80 shadow-[0_12px_32px_rgba(0,0,0,0.5)] backdrop-blur-md"
            style={{ top: at.top, right: at.right }}
          >
            <div className="mb-1.5 rounded-md bg-white/[0.06] px-2 py-1 font-mono text-[12px] text-white">/join {name}</div>
            {t("join.howto")}
          </div>,
          document.body,
        )}
    </div>
  );
}

/* ---------- Player view ---------- */

export type StatsTab = "pve" | "pvp";

/** A player as Fireteam shows them (also on the inspect page over the game). */
export function PlayerView({ id, tab, onTab }: { id: string; tab: StatsTab; onTab: (tab: StatsTab) => void }) {
  // A character picked: its build is shown instead of the overview.
  const [character, setCharacter] = useState<string | null>(null);
  // Back from a character: the overview comes in from its side.
  const [cameBack, setCameBack] = useState(false);
  const t = useT();
  const { detail, loading, error } = usePlayer(id);
  const now = useNow(15_000);
  // PvE and PvP: each kept once opened (switching back doesn't load it
  // again); on a switch the outgoing one's height stays the least, so the
  // page doesn't get shorter and the scroll stays where it was.
  const [opened, setOpened] = useState<StatsTab[]>([tab]);
  const [tabsHeight, setTabsHeight] = useState(0);
  const tabsBox = useRef<HTMLDivElement>(null);
  if (!opened.includes(tab)) setOpened([...opened, tab]);
  const [shownFor, setShownFor] = useState(id);
  if (shownFor !== id) {
    // Another player: from nothing.
    setShownFor(id);
    setOpened([tab]);
    setTabsHeight(0);
  }
  const switchTab = (next: StatsTab) => {
    setTabsHeight(tabsBox.current?.offsetHeight ?? 0);
    onTab(next);
  };

  if (!detail) {
    return error ? (
      <GlassPanel className="p-6 text-[13px] text-red-300">{error}</GlassPanel>
    ) : (
      <Skeleton />
    );
  }

  const active = detail.characters[0];

  const shownCharacter =
    detail && detail.characters.some((c) => c.id === character) ? character : (detail?.characters[0]?.id ?? null);
  const build: CharacterBuild = detail?.builds?.find((b) => b.characterId === shownCharacter) ?? {
    characterId: shownCharacter ?? "",
    subclass: detail?.subclass ?? null,
    weapons: detail?.weapons ?? [],
    armor: detail?.armor ?? [],
    armorSets: detail?.armorSets ?? [],
    stats: detail?.stats ?? [],
  };
  return (
    <div className="flex flex-col gap-4">
      {/* Banner */}
      <GlassPanel className="overflow-hidden p-0">
        <div className="relative h-[132px] overflow-hidden rounded-[20px] [--banner-h:132px]">
          {active && <EmblemHeader character={active} />}
          {/* Only a light shade on the right, behind the buttons: the emblem keeps its own brightness. */}
          <div className="absolute inset-0 bg-gradient-to-r from-transparent from-50% to-black/35" />
          {/* Links in the corner, so the name keeps the full width even in a narrow window. */}
          <div className="absolute top-3 right-3 flex max-w-[75%] flex-wrap justify-end gap-1.5">
            <JoinButton name={detail.displayName} />
            {profileLinks(detail).map((l) => (
              <GlassButton key={l.label} size="sm" onClick={() => open(l.url)}>
                {l.label} <IconExternal />
              </GlassButton>
            ))}
          </div>
          <div className="absolute right-4 bottom-3.5 left-[132px] min-w-0">
            <h1 className="truncate font-display text-[24px] leading-tight font-semibold">
              {detail.displayName}
            </h1>
            <p className="truncate text-[12.5px] text-white/65">
              {active ? `${active.className} · ◆ ${active.light}` : t("fireteam.noCharacters")}
            </p>
          </div>
        </div>
      </GlassPanel>

      <div className="flex items-center justify-between gap-3 px-1 text-[12px] text-white/45">
        {/* The characters: a click shows one's build (below); the one
            played last in the accent. */}
        <div className="flex flex-wrap gap-1.5">
          {detail.characters.map((c, i) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setCharacter(character === c.id ? null : c.id)}
              title={i === 0 ? t("fireteam.lastPlayed") : undefined}
              className={cx(
                "inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-2 py-1 transition-colors",
                i === 0
                  ? "border-(--accent-glow) bg-(--accent-soft) text-(--accent-text)"
                  : "border-white/[0.07] bg-white/[0.04] hover:text-white/75",
                character === c.id && "ring-1 ring-white/60",
              )}
            >
              {i === 0 && <span aria-hidden className="size-1.5 rounded-full bg-(--accent-text)" />}
              {c.className} <span className="text-[#f5dc56]">◆ {c.light}</span>
            </button>
          ))}
        </div>
        <button
          onClick={() => void loadPlayer(id, true)}
          className="inline-flex items-center gap-1.5 hover:text-white/80"
          disabled={loading}
        >
          <span className={loading ? "animate-spin" : undefined}>
            <IconRefresh />
          </span>
          {loading ? t("common.refreshing") : t("fireteam.updated", { ago: formatAgo(detail.fetchedAt, now, t) })}
        </button>
      </div>

      {character && shownCharacter ? (
        // A character picked: its build instead of the overview, a way back.
        <div key={shownCharacter} className="zoom-in-deeper flex flex-col gap-3">
          <button
            type="button"
            onClick={() => {
              setCharacter(null);
              setCameBack(true);
            }}
            className="inline-flex w-fit cursor-pointer items-center gap-1.5 rounded-lg px-1 text-[12.5px] font-semibold text-white/55 transition-colors hover:text-white"
          >
            <svg viewBox="0 0 24 24" width={15} height={15} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M15 18l-6-6 6-6" />
            </svg>
            {t("fireteam.overview")}
          </button>
          <Build build={build} />
        </div>
      ) : (
        <div className={cx("flex flex-col gap-4", cameBack && "zoom-in-back")}>
          <TabSwitch
            value={tab}
            onChange={switchTab}
            options={[
              { value: "pve", label: t("fireteam.pve") },
              { value: "pvp", label: t("fireteam.pvp") },
            ]}
          />

          {/* (Shown again, one replays the entrance animation.) */}
          <div ref={tabsBox} style={{ minHeight: tabsHeight }}>
            {opened.includes("pve") && (
              <div className={cx("animate-widget-in flex flex-col gap-4", tab !== "pve" && "hidden")}>
                <PveStats id={id} detail={detail} />
              </div>
            )}
            {opened.includes("pvp") && (
              <div className={cx("animate-widget-in flex flex-col gap-4", tab !== "pvp" && "hidden")}>
                <PvpStats detail={detail} />
              </div>
            )}
          </div>
        </div>
      )}

      {detail.warnings.length > 0 && (
        <p className="px-1 text-[12px] text-white/40">{t("fireteam.note", { text: detail.warnings.join(" · ") })}</p>
      )}
    </div>
  );
}

/** Small "R 648" chip in the tier's color. */
function TierChip({ letter, tier, clears, title }: { letter: string; tier: Tier; clears: number | null; title: string }) {
  const t = useT();
  return (
    <span
      title={`${title}: ${t(tier.label)}`}
      className="inline-flex min-w-[52px] items-center justify-between gap-1.5 rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold text-white tabular-nums shadow-[inset_0_1px_0_rgb(255_255_255/0.25)]"
      style={{ background: tier.color }}
    >
      <span className="opacity-75">{letter}</span>
      {clears ?? "—"}
    </span>
  );
}

/** raid.report-style colored card: label, tier name, number of clears. */
/**
 * raid.report-style card: label, rank name, value line. Without a tier
 * (loading, error) it stays neutral glass.
 */
function TierCard({
  label,
  tier,
  title,
  detail,
  hint,
  progress,
}: {
  label: string;
  tier: Tier | null;
  title: string;
  detail: string;
  hint?: string;
  /** 0..1, shows a loading bar along the bottom edge. */
  progress?: number;
}) {
  return (
    <div
      className={cx(
        "relative min-w-0 overflow-hidden rounded-2xl px-3.5 py-3",
        tier
          ? "text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.25),0_10px_30px_-12px_var(--tier)]"
          : "border border-white/[0.07] bg-white/[0.035] text-white/80",
      )}
      style={
        tier
          ? ({
              "--tier": tier.color,
              background: `linear-gradient(145deg, color-mix(in oklab, ${tier.color} 100%, white 12%), ${tier.color})`,
            } as CSSProperties)
          : undefined
      }
      title={hint}
    >
      <div className="truncate text-[11.5px] font-semibold opacity-85">{label}</div>
      <div className="mt-0.5 truncate font-display text-[20px] leading-tight font-semibold">
        {title}
      </div>
      <div className="mt-0.5 truncate text-[12px] font-semibold tabular-nums opacity-90">{detail}</div>
      {progress !== undefined && (
        <div className="absolute inset-x-0 bottom-0 h-1 bg-white/[0.06]">
          <div
            className="h-full bg-[linear-gradient(90deg,var(--accent),var(--accent-text))] shadow-[0_0_4px_var(--accent-halo)] shadow-[0_0_5px_var(--accent-halo)] transition-[width] duration-300"
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}

/** Raid / dungeon clears from Bungie, ranked by fixed thresholds. */
function ClearsTierCard({ label, clears }: { label: string; clears: number | null }) {
  const t = useT();
  const tier = tierFor(clears);
  return (
    <TierCard
      label={label}
      tier={tier}
      title={t(tier.label)}
      detail={clears === null ? "—" : t("fireteam.clearsCount", { n: clears })}
      hint={t("fireteam.tierHint")}
    />
  );
}

type FullClearsEntry = ReturnType<typeof useFullClears>;

/** Sum of the player's best full-clear times (raids). While the raid
 *  reports load: how far. */
function SpeedCard({ label, entry }: { label: string; entry: FullClearsEntry }) {
  const t = useT();
  const stats = entry.stats;
  if (!stats) {
    const { done = 0, total = 0 } = entry.progress ?? {};
    return (
      <TierCard
        label={label}
        tier={null}
        title={entry.error ? "—" : "…"}
        detail={
          entry.error === FULL_CLEARS_STUCK
            ? t("fireteam.fullClearsStuck")
            : (entry.error ?? (total ? t("fireteam.loadingReports", { done, total }) : t("common.loading")))
        }
        progress={!entry.error && total ? done / total : undefined}
      />
    );
  }
  return (
    <TierCard
      label={label}
      tier={null}
      title={stats.sumOfBestSeconds ? formatClock(stats.sumOfBestSeconds * 1000) : "—"}
      detail={t("fireteam.speedSum", { n: stats.raidsWithBest })}
    />
  );
}

/** Sum of the player's best full-clear times in dungeons (those with one). */
function DungeonSpeedCard({ label, entry, dungeons }: { label: string; entry: FullClearsEntry; dungeons: string[] }) {
  const t = useT();
  const stats = entry.stats;
  if (!stats) {
    const detail = entry.error === FULL_CLEARS_STUCK ? t("fireteam.fullClearsStuck") : (entry.error ?? t("common.loading"));
    return <TierCard label={label} tier={null} title={entry.error ? "—" : "…"} detail={detail} />;
  }
  const best = dungeons.map((d) => stats.bestFullSeconds?.[d]).filter((s): s is number => !!s);
  const sum = best.reduce((a, b) => a + b, 0);
  return (
    <TierCard
      label={label}
      tier={null}
      title={sum ? formatClock(sum * 1000) : "—"}
      detail={t("fireteam.dungeonSpeedSum", { n: best.length })}
    />
  );
}

function TabSwitch<V extends string>({
  value,
  onChange,
  options,
}: {
  value: V;
  onChange: (value: V) => void;
  options: { value: V; label: string }[];
}) {
  return (
    <div className="flex w-fit gap-1 rounded-xl border border-white/[0.07] bg-white/[0.04] p-1">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={cx(
            "h-8 rounded-lg px-4 text-[12.5px] font-semibold transition-[background-color,color,box-shadow] duration-200",
            value === o.value
              ? "bg-(--accent-soft) text-white shadow-[inset_0_0_0_1px_var(--accent-halo)]"
              : "text-white/50 hover:text-white/85",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function PveStats({ id, detail }: { id: string; detail: PlayerDetail }) {
  const t = useT();
  const fullClears = useFullClears(id);
  // The result, or while loading what's known so far; the items still
  // waiting shimmer (all of them before anything is known).
  const view = fullClears.stats ?? fullClears.partial;
  const waiting = fullClears.stats
    ? null
    : fullClears.partial
      ? new Set(fullClears.partial.pending ?? [])
      : fullClears.loading
        ? "all"
        : null;
  const isLoading = (name: string) => waiting === "all" || (waiting !== null && waiting.has(name));
  const perRaid = new Map((view?.raids ?? []).map((r) => [r.name, r]));
  // A tag's run, shown in its report.
  const [run, setRun] = useState<{ ids: string[]; classes?: RaidTag["runs"]; title: string; raid: boolean } | null>(null);
  // A lowman made on several classes: each class's newest run of it.
  const openRun = (raid: boolean) => (tag: RaidTag, name: string) =>
    setRun({
      ids: tag.runs && tag.runs.length > 1 ? tag.runs.map((r) => r.instanceId) : [tag.instanceId],
      classes: tag.runs,
      title: `${name} · ${tag.label}`,
      raid,
    });
  // A raid / dungeon clicked: all its runs.
  const [activity, setActivity] = useState<{ name: string; raid: boolean; exotic?: boolean; title?: string } | null>(
    null,
  );
  // Dungeons: their tags in the same shape (no full clears counted there).
  // Their fastest full clears too (also of those without a tag).
  const bestFull = view?.bestFullSeconds ?? {};
  const perOf = (list: { name: string; tags: RaidTag[] }[]) => {
    const map = new Map<string, RaidFullClears>(
      list.map((d) => [d.name, { name: d.name, fullClears: 0, bestSeconds: bestFull[d.name] ?? null, tags: d.tags }]),
    );
    for (const [name, seconds] of Object.entries(bestFull))
      if (!map.has(name)) map.set(name, { name, fullClears: 0, bestSeconds: seconds, tags: [] });
    return map;
  };
  const perDungeon = perOf(view?.dungeons ?? []);
  const perExotic = perOf(view?.exotics ?? []);
  // Every tab's artwork loaded up front: a switched-to list slides in
  // complete, nothing popping in after.
  useEffect(() => {
    for (const c of [...detail.raids, ...detail.dungeons, ...(detail.exotics ?? []), ...(detail.pantheon ?? [])]) {
      if (c.image) new Image().src = c.image;
    }
  }, [detail]);
  // Each panel's tabs (switched, not below one another: no long
  // scrolling): raids or the Pantheon, dungeons or exotic missions.
  const [left, setLeftTab] = useState<"raids" | "pantheon">("raids");
  const [right, setRightTab] = useState<"dungeons" | "exotics">("dungeons");
  // Which way a list slides in: from the right going to the later tab.
  const [slide, setSlide] = useState<{ left?: "forward" | "back"; right?: "forward" | "back" }>({});
  const setLeft = (k: "raids" | "pantheon") => {
    if (k === left) return;
    setSlide((s) => ({ ...s, left: k === "pantheon" ? "forward" : "back" }));
    setLeftTab(k);
  };
  const setRight = (k: "dungeons" | "exotics") => {
    if (k === right) return;
    setSlide((s) => ({ ...s, right: k === "exotics" ? "forward" : "back" }));
    setRightTab(k);
  };
  const pantheonShown = left === "pantheon" && !!detail.pantheon?.length;
  const exoticsShown = right === "exotics" && !!detail.exotics?.length;
  const leftTabs = detail.pantheon?.length ? (
    <Tabs
      value={left}
      onChange={setLeft}
      options={[
        ["raids", t("fireteam.raids")],
        ["pantheon", t("fireteam.pantheon")],
      ]}
    />
  ) : undefined;
  const rightTabs = detail.exotics?.length ? (
    <Tabs
      value={right}
      onChange={setRight}
      options={[
        ["dungeons", t("fireteam.dungeons")],
        ["exotics", t("fireteam.exotics")],
      ]}
    />
  ) : undefined;
  return (
    <>
      {/* Raids: clears and time; dungeons: the same. */}
      <div className="grid grid-cols-4 gap-3">
        <ClearsTierCard label={t("fireteam.raidClears")} clears={detail.totals.raidClears} />
        <SpeedCard label={t("fireteam.raidTime")} entry={fullClears} />
        <ClearsTierCard label={t("fireteam.dungeonClears")} clears={detail.totals.dungeonClears} />
        <DungeonSpeedCard
          label={t("fireteam.dungeonTime")}
          entry={fullClears}
          dungeons={detail.dungeons.map((d) => d.name)}
        />
      </div>
      {fullClears.stats && <p className="-mt-2 px-1 text-[11px] text-white/35">{t("fireteam.fullClearsSource")}</p>}

      <div className="grid grid-cols-2 gap-4">
        <ClearsList
          heading={pantheonShown ? t("fireteam.pantheon") : t("fireteam.raids")}
          tabs={leftTabs}
          items={pantheonShown ? detail.pantheon! : detail.raids}
          fullClears={perRaid}
          onOpenRun={openRun(true)}
          onOpenActivity={(name) => setActivity({ name, raid: true, title: pantheonShown ? bossOf(name) : undefined })}
          shown={pantheonShown ? bossOf : undefined}
          loading={isLoading}
          view={left}
          slide={slide.left}

        />
        <ClearsList
          heading={exoticsShown ? t("fireteam.exotics") : t("fireteam.dungeons")}
          tabs={rightTabs}
          items={exoticsShown ? detail.exotics! : detail.dungeons}
          fullClears={exoticsShown ? perExotic : perDungeon}
          onOpenRun={openRun(false)}
          onOpenActivity={(name) => setActivity({ name, raid: false, exotic: exoticsShown })}
          loading={isLoading}
          view={right}
          slide={slide.right}

        />
      </div>
      {run && (
        <RunReport
          instanceIds={run.ids}
          classOf={Object.fromEntries((run.classes ?? []).map((r) => [r.instanceId, r.class]))}
          title={run.title}
          raid={run.raid}
          onClose={() => setRun(null)}
        />
      )}
      {activity && (
        <ActivityRuns
          membershipId={id}
          name={activity.name}
          raid={activity.raid}
          exotic={activity.exotic}
          title={activity.title}
          onClose={() => setActivity(null)}
        />
      )}
    </>
  );
}

function PvpStats({ detail }: { detail: PlayerDetail }) {
  const t = useT();
  const language = useLanguage();
  const { totals } = detail;
  const num = (v: number | null, digits = 0) =>
    v === null ? "—" : v.toLocaleString(LOCALES[language], { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const rate = (wins: number | null, matches: number | null) =>
    wins === null || !matches ? "—" : `${num((wins / matches) * 100, 1)} %`;

  return (
    <>
      <GlassPanel className="p-4">
        <h3 className="mb-3 font-display text-[14px] font-semibold">{t("fireteam.crucible")}</h3>
        <div className="grid grid-cols-4 gap-2">
          <StatTile label={t("fireteam.kd")} value={num(totals.pvpKd, 2)} emphasis />
          <StatTile label={t("fireteam.kda")} value={num(totals.pvpKda, 2)} />
          <StatTile
            label={t("fireteam.winRate")}
            value={rate(totals.pvpWins, totals.pvpMatches)}
            hint={t("fireteam.wins", { n: num(totals.pvpWins) })}
          />
          <StatTile label={t("fireteam.matches")} value={num(totals.pvpMatches)} />
          <StatTile label={t("fireteam.kills")} value={num(totals.pvpKills)} />
          <StatTile label={t("fireteam.deaths")} value={num(totals.pvpDeaths)} />
          <StatTile label={t("fireteam.bestGame")} value={num(totals.pvpBestGameKills)} hint={t("fireteam.kills")} />
          <StatTile label={t("fireteam.longestSpree")} value={num(totals.pvpLongestSpree)} />
        </div>
      </GlassPanel>
      <GlassPanel className="p-4">
        <h3 className="mb-3 font-display text-[14px] font-semibold">{t("fireteam.trials")}</h3>
        <div className="grid grid-cols-4 gap-2">
          <StatTile label={t("fireteam.kd")} value={num(totals.trialsKd, 2)} emphasis />
          <StatTile
            label={t("fireteam.winRate")}
            value={rate(totals.trialsWins, totals.trialsMatches)}
            hint={t("fireteam.wins", { n: num(totals.trialsWins) })}
          />
          <StatTile label={t("fireteam.matches")} value={num(totals.trialsMatches)} />
          <StatTile label={t("fireteam.kills")} value={num(totals.trialsKills)} />
        </div>
      </GlassPanel>
    </>
  );
}

/**
 * The emblem the way the character screen shows it: its wide banner from the
 * left, the emblem's icon (cut out, with its glow) on top on the left.
 * Without those (old emblems): the small banner.
 */
function EmblemHeader({ character }: { character: CharacterInfo }) {
  if (character.emblemBanner) {
    return (
      <>
        <img src={BUNGIE + character.emblemBanner} alt="" className="absolute inset-0 size-full object-cover object-left" />
        {character.emblemOverlay && (
          <img
            src={BUNGIE + character.emblemOverlay}
            alt=""
            className="absolute top-1/2 left-4 size-[104px] -translate-y-1/2 drop-shadow-[0_2px_8px_rgb(0_0_0/0.6)]"
          />
        )}
      </>
    );
  }
  return character.emblemBackgroundPath ? (
    <img src={BUNGIE + character.emblemBackgroundPath} alt="" className="absolute inset-0 size-full object-cover object-left" />
  ) : null;
}

/** A raid's tags as RaidHub shows them: lowmans and flawless runs, the
 *  best this raid allows with a diamond; checkpoint ones dimmed. */
function RaidTags({ raid, onOpen }: { raid?: RaidFullClears; onOpen?: (tag: RaidTag) => void }) {
  if (!raid?.tags.length) return null;
  return (
    <>
      {raid.tags.map((tag, i) => (
        <RaidTagChip key={tag.instanceId || tag.label} tag={tag} onOpen={onOpen} delay={i * 50} />
      ))}
    </>
  );
}

function RaidTagChip({ tag, onOpen, delay = 0 }: { tag: RaidTag; onOpen?: (tag: RaidTag) => void; delay?: number }) {
  const t = useT();
  const language = useLanguage();
  // No date: known from Bungie's triumph only.
  const date = tag.date ? new Date(tag.date).toLocaleDateString(LOCALES[language]) : t("fireteam.fromTriumph");
  // Its colour goes by what it is, not by its feat count ("· 2 Feats").
  const base = tag.label.replace(/ · \d+ Feats?$/, "");
  // The run with the most feats ("5 Feats"): the accent.
  const featsOnly = /^\d+ Feats?$/.test(tag.label);
  const lit = !tag.checkpoint && (base.includes("Flawless") || featsOnly);
  // The harder difficulties (master, Leviathan's prestige, the dungeons'
  // eternity and ultimatum): red; the normal ones keep the accent.
  const master = /(Master|Prestige|Eternity|Ultimatum)/.test(base);
  // A run behind it: a click shows its report.
  const openable = !!onOpen && !!tag.instanceId;
  return (
    <button
      type="button"
      disabled={!openable}
      onClick={(e) => {
        // Only its run, not the raid's list of runs too.
        e.stopPropagation();
        if (openable) onOpen(tag);
      }}
      title={[tag.checkpoint ? `${t("fireteam.checkpointClear")} · ${date}` : date, ...(tag.feats ?? []).map((f) => f.name)].join(
        "\n",
      )}
      style={{ animationDelay: `${delay}ms` }}
      className={cx(
        "tag-pop inline-flex items-center gap-1 rounded px-1.5 text-[10.5px] font-semibold whitespace-nowrap transition-[filter,border-color]",
        openable && "cursor-pointer hover:brightness-125",
        // A race alone ("Day One"), a lowman in a race window ("Week One
        // Solo Flawless", merged into the race tag or not).
        RACE_RANKS.includes(base)
          ? raceColor(base, tag.raceBest)
          : raceRank(base) >= 0
            ? windowedColor(base, tag.raceBest)
            : lit && master
              ? "border border-[#e2626b]/55 bg-[#e2626b]/15 text-[#f5a3a8]"
              : lit
                ? "border border-(--accent-glow) bg-(--accent-soft) text-(--accent-text)"
                : tag.checkpoint
                  ? "border border-white/[0.08] text-white/45"
                  : master
                    ? "bg-[#e2626b]/12 text-[#f0b4b8]"
                    : "bg-white/[0.07] text-white/75",
      )}
    >
      {tag.label}
      {/* A lowman's classes: each one it was made on. */}
      {!!tag.classes?.length && (
        <span className="ml-0.5 inline-flex items-center gap-0.5 opacity-85">
          {tag.classes.map((c) => (
            <ClassIcon key={c} kind={c} title={t(`class.${c}`)} className="size-3" />
          ))}
        </span>
      )}
      {/* Its run's feats, as small icons (named in the tooltip). */}
      {!!tag.feats?.length && (
        <span className="-mr-0.5 ml-0.5 inline-flex items-center gap-px">
          {tag.feats.map((f) =>
            f.icon ? <img key={f.name} src={f.icon} alt={f.name} className="size-3.5 rounded-[2px] opacity-90" /> : null,
          )}
        </span>
      )}
    </button>
  );
}

/** Race tags from the lowest to the highest. */
const RACE_RANKS = ["Week One", "Contest", "Day One", "Contest Challenge", "Day One Contest", "Day One Contest Challenge"];
const raceRank = (label: string) =>
  RACE_RANKS.reduce((rank, name, i) => (label === name || label.startsWith(`${name} `) ? i : rank), -1);

/** A race tag's colours: gold, the stronger the closer it is to the
 *  highest its activity had (a raid without a challenge tops out at its day
 *  one contest, an old dungeon at its day one); week one neutral. */
/** The races an activity had, from its highest down (its gold steps). */
const RACE_LADDERS: Record<string, string[]> = {
  "Day One Contest Challenge": ["Day One Contest Challenge", "Day One Contest", "Contest Challenge", "Day One", "Contest"],
  "Day One Contest": ["Day One Contest", "Contest", "Day One"],
  "Day One": ["Day One"],
};

const raceColor = (label: string, best?: string) => {
  if (raceRank(label) <= 0) return "border border-[#808691]/40 bg-[#808691]/[0.07] text-[#9aa0ab]";
  // How many steps below the highest its activity had (not there: faint).
  const ladder = RACE_LADDERS[best ?? "Day One Contest Challenge"] ?? RACE_LADDERS["Day One Contest Challenge"];
  const step = ladder.indexOf(label);
  const gap = step < 0 ? 3 : step;
  return gap <= 0
    ? "border border-[#e8c547] bg-[#e8c547] text-[#1a1405]"
    : gap === 1
      ? "border border-[#e8c547]/65 bg-[#e8c547]/20 text-[#f5dc75]"
      : gap === 2
        ? "border border-[#e8c547]/40 bg-[#e8c547]/[0.08] text-[#e9d48a]"
        : "border border-[#bfae72]/25 text-[#cdbf8f]";
};

/** A lowman in a race window ("Week One Solo Flawless", "Day One Solo
 *  Flawless"): gold always, full in the activity's highest window, strong
 *  in any other (week one too). */
const windowedColor = (label: string, best?: string) =>
  raceRank(best ?? "Day One Contest Challenge") - raceRank(label) <= 0
    ? "border border-[#e8c547] bg-[#e8c547] text-[#1a1405]"
    : "border border-[#e8c547]/70 bg-[#e8c547]/25 text-[#f7e08a]";

/** A Pantheon version as its tab shows it: the boss alone ("The Pantheon:
 *  Atraks Sovereign", "Pantheon: Calus Resplendent" -> the part after). */
const bossOf = (name: string) => name.split(": ").slice(1).join(": ") || name;

/** A panel's tabs in its heading ("Raids | Pantheon"). */
function Tabs<K extends string>({
  value,
  onChange,
  options,
}: {
  value: K;
  onChange: (k: K) => void;
  options: [K, string][];
}) {
  // The light behind the active tab slides over to a new one (measured, so
  // tabs of any width).
  const box = useRef<HTMLSpanElement>(null);
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const active = box.current?.querySelector<HTMLElement>(`[data-tab="${value}"]`);
    if (active) setPill({ left: active.offsetLeft, width: active.offsetWidth });
  }, [value, options.length]);
  return (
    <span ref={box} className="relative inline-flex rounded-lg border border-white/[0.07] bg-white/[0.03] p-0.5">
      {pill && (
        <span
          aria-hidden
          className="absolute top-0.5 bottom-0.5 left-0 rounded-md bg-white/[0.09] transition-[transform,width] duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]"
          style={{ width: pill.width, transform: `translateX(${pill.left}px)` }}
        />
      )}
      {options.map(([k, label]) => (
        <button
          key={k}
          type="button"
          data-tab={k}
          onClick={() => onChange(k)}
          className={cx(
            "relative cursor-pointer rounded-md px-2.5 py-1 text-[12.5px] font-semibold transition-colors duration-300",
            value === k ? "text-white" : "text-white/45 hover:text-white/75",
            !pill && value === k && "bg-white/[0.09]",
          )}
        >
          {label}
        </button>
      ))}
    </span>
  );
}

function ClearsList({
  heading,
  tabs,
  items,
  fullClears,
  onOpenRun,
  onOpenActivity,
  shown = (name: string) => name,
  loading,
  view,
  slide,
}: {
  /** Its title, or its tabs in its place. */
  heading: string;
  tabs?: ReactNode;
  items: Clears[];
  /** Per raid name, when full-clear data is loaded. */
  fullClears?: Map<string, RaidFullClears>;
  /** A tag clicked: its run's report. */
  onOpenRun?: (tag: RaidTag, raid: string) => void;
  /** A raid / dungeon clicked: all its runs. */
  onOpenActivity?: (name: string) => void;
  /** Its names as shown (the Pantheon's without "Pantheon:"). */
  shown?: (name: string) => string;
  /** Whether an item's reports are still loading (a shimmer along it). */
  loading?: (name: string) => boolean;
  /** The tab shown: a new one pushes the old list out, like a page does
   *  (`slide`: from where it comes). */
  view?: string;
  slide?: "forward" | "back";
}) {
  const t = useT();
  // Newest release first (none known: at the end), then most clears; a
  // tie by full clears, then by name, so the order stays the same on every
  // reload.
  const sorted = [...items].sort(
    (a, b) =>
      (b.released ?? "").localeCompare(a.released ?? "") ||
      b.clears - a.clears ||
      (fullClears?.get(b.name)?.fullClears ?? 0) - (fullClears?.get(a.name)?.fullClears ?? 0) ||
      a.name.localeCompare(b.name),
  );
  // A tab switched: the list shown before slides out while the new one
  // slides in, side by side in one cell (the app's page push).
  const [outgoing, setOutgoing] = useState<{
    view?: string;
    items: Clears[];
    fullClears?: Map<string, RaidFullClears>;
    shown: (name: string) => string;
    dir: "forward" | "back";
  } | null>(null);
  const last = useRef({ view, items: sorted, fullClears, shown });
  useLayoutEffect(() => {
    if (last.current.view !== view && slide && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setOutgoing({ ...last.current, dir: slide });
    }
    last.current = { view, items: sorted, fullClears, shown };
  });
  // Gone once its slide is over (its animationend may not come: a paused
  // window, a switch back mid-way).
  useEffect(() => {
    if (!outgoing) return;
    const id = window.setTimeout(() => setOutgoing(null), 600);
    return () => window.clearTimeout(id);
  }, [outgoing]);

  const tile = (
    i: Clears,
    fc: Map<string, RaidFullClears> | undefined,
    named: (name: string) => string,
    // The list sliding out (a copy): nothing in it counts up.
    still = false,
  ) => (
    <li
      key={i.name}
      role={onOpenActivity && i.clears ? "button" : undefined}
      tabIndex={onOpenActivity && i.clears ? 0 : undefined}
      onClick={() => onOpenActivity && i.clears && onOpenActivity(i.name)}
      onKeyDown={(e) => e.key === "Enter" && onOpenActivity && i.clears && onOpenActivity(i.name)}
      className={cx(
        "spotlight group relative isolate overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5",
        i.clears === 0 && "opacity-70",
        onOpenActivity && i.clears > 0 && "cursor-pointer transition-colors hover:border-white/[0.16] hover:bg-white/[0.04]",
      )}
    >
      {/* Its artwork, dark and fading out towards the text. */}
      {/* Hovered: it drifts a little closer. */}
      {i.image && (
        <div className="pointer-events-none absolute inset-y-0 right-0 -z-10 w-3/4 transition-transform duration-[600ms] ease-[cubic-bezier(0.22,0.8,0.2,1)] group-hover:scale-[1.04]">
          <img
            src={i.image}
            alt=""
            draggable={false}
            className={cx(
              "size-full object-cover opacity-50 [mask-image:linear-gradient(90deg,transparent,black_70%)]",
              // Shared with an older one: mirrored, another part of
              // it, a hotter tint.
              i.imageVariant && "-scale-x-100 object-[20%_30%] saturate-150 hue-rotate-[-25deg]",
            )}
          />
        </div>
      )}
      <div className="flex items-baseline gap-2 text-[12.5px]">
        <span className="min-w-0 flex-1 truncate font-semibold text-white/90" title={i.name}>
          {named(i.name)}
        </span>
        {/* Only a full clear's (Bungie's fastest counts checkpoint runs). */}
        {!!fc?.get(i.name)?.bestSeconds && (
          <span className="text-[11px] text-white/40 tabular-nums" title={t("fireteam.bestFullClear")}>
            ⏱ {formatClock(fc!.get(i.name)!.bestSeconds! * 1000)}
          </span>
        )}
        <span className="w-9 text-right font-semibold tabular-nums">
          {still ? i.clears : <CountUp text={String(i.clears)} />}
        </span>
      </div>
      {/* Tags on a line of their own, always there (empty too);
          they wrap. */}
      {/* Its reports still loading: a shimmer along the bottom. */}
      {/* Done: it fades out (the tags pop in meanwhile). */}
      <span
        aria-hidden
        className={cx("tile-loading", !loading?.(i.name) && "done")}
      />
      {/* Room for two lines of tags on every tile, in every list:
          all of them as tall. */}
      <div className="mt-1.5 flex min-h-[38px] flex-wrap content-start items-center gap-1">
        <RaidTags raid={fc?.get(i.name)} onOpen={onOpenRun && ((tag) => onOpenRun(tag, i.name))} />
      </div>
    </li>
  );

  return (
    <GlassPanel className="overflow-hidden p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="font-display text-[14px] font-semibold">{tabs ?? heading}</h3>
        <span className="text-[11px] text-white/40">{t("fireteam.clears")}</span>
      </div>
      {items.length === 0 && !outgoing ? (
        <p className="text-[12.5px] text-white/40">{t("fireteam.noClears")}</p>
      ) : (
        <div className="grid [&>*]:[grid-area:1/1]">
          {outgoing && (
            <ul
              key={`out-${outgoing.view}`}
              aria-hidden
              className={cx(
                "pointer-events-none grid auto-rows-fr gap-2 self-start will-change-transform",
                outgoing.dir === "forward" ? "tab-exit-forward" : "tab-exit-back",
              )}
              onAnimationEnd={(e) => e.target === e.currentTarget && setOutgoing(null)}
            >
              {outgoing.items.map((i) => tile(i, outgoing.fullClears, outgoing.shown, true))}
            </ul>
          )}
          {/* Every tile as tall as the tallest (tags wrap, none cut off). */}
          <ul
            key={view}
            className={cx(
              // Its own height, not stretched to the other list's.
              // Always on its own layer (as while it slides): it looks
              // the same before, during and after a switch.
              "stagger-in grid auto-rows-fr gap-2 self-start will-change-transform",
              outgoing && (outgoing.dir === "forward" ? "tab-enter-forward" : "tab-enter-back"),
            )}
          >
            {sorted.map((i) => tile(i, fullClears, shown))}
          </ul>
        </div>
      )}
    </GlassPanel>
  );
}

/* ---------- Build ---------- */

function ItemIcon({ item, size = 44 }: { item: ItemInfo; size?: number }) {
  return (
    <div
      className={cx(
        "shrink-0 overflow-hidden rounded-lg border bg-black/30",
        item.exotic ? "border-[#e8c547]/70 shadow-[0_0_7px_-1px_rgb(232_197_71/0.5)]" : "border-white/10",
      )}
      style={{ width: size, height: size }}
      title={`${item.name} – ${item.typeName}`}
    >
      {item.icon && <img src={BUNGIE + item.icon} alt="" className="size-full object-cover" />}
    </div>
  );
}

/** A plugged perk or mod: small icon, name and description on hover. */
function PlugIcon({ plug, round }: { plug: ItemInfo; round: boolean }) {
  return (
    <span
      title={`${plug.name} – ${plug.typeName}`}
      className={cx(
        "grid size-7 shrink-0 place-items-center overflow-hidden border border-white/15 bg-black/30",
        round ? "rounded-full bg-[#1d4a6b]/70" : "rounded-md",
      )}
    >
      {plug.icon ? (
        <img src={BUNGIE + plug.icon} alt="" className="size-full object-cover" />
      ) : (
        <span className="text-[9px] text-white/50">{plug.name.slice(0, 2)}</span>
      )}
    </span>
  );
}

function ItemCard({ item }: { item: ItemInfo }) {
  const perks = item.perks ?? [];
  const mods = item.mods ?? [];
  return (
    <div className="flex min-w-0 items-center gap-2.5 rounded-xl border border-white/[0.06] bg-white/[0.03] p-2">
      <ItemIcon item={item} />
      <div className="min-w-0 flex-1">
        <div className={cx("truncate text-[12.5px] font-medium", item.exotic && "text-[#f0d66b]")}>{item.name}</div>
        <div className="truncate text-[11px] text-white/45">{item.typeName}</div>
      </div>
      {(perks.length > 0 || mods.length > 0) && (
        <div className="flex shrink-0 items-center gap-1">
          {perks.map((p, i) => (
            <PlugIcon key={`p${p.hash}-${i}`} plug={p} round />
          ))}
          {perks.length > 0 && mods.length > 0 && <span className="mx-0.5 h-5 w-px bg-white/10" />}
          {mods.map((m, i) => (
            <PlugIcon key={`m${m.hash}-${i}`} plug={m} round={false} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Subclass plugs grouped by what they are (super, aspects, fragments, …).
 *  Type names come from Bungie in the app language, so match both. */
function groupPlugs(plugs: ItemInfo[], t: Translate) {
  const groups: [string, (p: ItemInfo) => boolean][] = [
    [t("fireteam.super"), (p) => /super/i.test(p.typeName)],
    [t("fireteam.aspects"), (p) => /aspekt|aspect/i.test(p.typeName)],
    [t("fireteam.fragments"), (p) => /fragment/i.test(p.typeName)],
  ];
  const used = new Set<ItemInfo>();
  const result: { title: string; items: ItemInfo[] }[] = groups.map(([title, test]) => {
    const items = plugs.filter((p) => !used.has(p) && test(p));
    items.forEach((p) => used.add(p));
    return { title, items };
  });
  result.splice(1, 0, { title: t("fireteam.abilities"), items: plugs.filter((p) => !used.has(p)) });
  return result.filter((g) => g.items.length > 0);
}

function Build({ build }: { build: CharacterBuild }) {
  const t = useT();
  const { subclass, weapons, armor, armorSets, stats } = build;
  if (!subclass && weapons.length === 0 && armor.length === 0) return null;
  const maxStat = Math.max(200, ...stats.map((s) => s.value));

  return (
    <GlassPanel className="p-4">
      <h3 className="mb-3 font-display text-[14px] font-semibold">{t("fireteam.build")}</h3>
      <div className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] gap-4">
        <div className="flex flex-col gap-3">
          {subclass && (
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-3">
              <div className="mb-3 flex items-center gap-3">
                <ItemIcon item={subclass.item} size={48} />
                <div>
                  <div className="text-[14px] font-semibold">{subclass.item.name}</div>
                  <div className="text-[11.5px] text-white/45">{subclass.item.typeName}</div>
                </div>
              </div>
              <div className="space-y-2.5">
                {groupPlugs(subclass.plugs, t).map((g) => (
                  <PlugGroup key={g.title} title={g.title}>
                    {g.items.map((p, i) => (
                      <ItemIcon key={`${p.hash}-${i}`} item={p} size={36} />
                    ))}
                  </PlugGroup>
                ))}
              </div>
            </div>
          )}
          {stats.length > 0 && (
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-3">
              <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                {stats.map((s) => {
                  const id = statIdOf(s.hash);
                  const row = (
                    <div className="flex items-center gap-2">
                      {s.icon && <img src={BUNGIE + s.icon} alt="" className="size-4 opacity-70" />}
                      <span className="w-16 truncate text-[11.5px] text-white/60">{s.name}</span>
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                        <div className="bar-grow h-full rounded-full bg-white/60" style={{ width: `${(s.value / maxStat) * 100}%` }} />
                      </div>
                      <span className="w-8 text-right text-[12px] font-semibold tabular-nums">{s.value}</span>
                    </div>
                  );
                  return id ? (
                    <StatHover key={s.name} id={id} stat={s.value} name={s.name}>
                      {row}
                    </StatHover>
                  ) : (
                    <div key={s.name}>{row}</div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <div className="text-[10.5px] font-semibold tracking-[0.14em] text-white/40 uppercase">{t("fireteam.weapons")}</div>
          {weapons.map((w) => (
            <ItemCard key={w.hash} item={w} />
          ))}
          <div className="mt-2 text-[10.5px] font-semibold tracking-[0.14em] text-white/40 uppercase">{t("fireteam.armor")}</div>
          {armor.map((a) => (
            <div key={a.hash} className="flex flex-col gap-1.5">
              <ItemCard item={a} />
              {a.exotic && <ExoticArmorPerks item={a} compact />}
            </div>
          ))}
          {armor.some((a) => a.exotic) && <ClarityCredit className="mt-0.5" />}
        </div>
      </div>
      {/* Set bonuses below, over the full width: two sets side by side. */}
      {armorSets.length > 0 && (
        <div className="mt-4">
          <div className="mb-2 text-[10.5px] font-semibold tracking-[0.14em] text-white/40 uppercase">{t("fireteam.armorSets")}</div>
          <div className={cx("grid items-start gap-3", armorSets.length > 1 && "grid-cols-2")}>
            {armorSets.map((set) => (
              <ArmorSetCard key={set.name} set={set} />
            ))}
          </div>
        </div>
      )}
    </GlassPanel>
  );
}

/** An armor set with its 2- and 4-piece bonuses; inactive ones dimmed. */
/** `neutral`: a single piece (inspected in game), every bonus shown alike. */
export function ArmorSetCard({ set, neutral = false }: { set: ArmorSet; neutral?: boolean }) {
  const t = useT();
  const active = !neutral && set.perks.some((p) => p.active);
  return (
    <div
      className={cx(
        "rounded-xl border p-2.5",
        active ? "border-(--accent-glow) bg-(--accent-soft)" : "border-white/[0.06] bg-white/[0.03]",
      )}
    >
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="truncate text-[13px] font-semibold">{set.name}</span>
        {!neutral && <span className="shrink-0 text-[11px] text-white/50">{t("fireteam.setPieces", { n: set.pieces })}</span>}
      </div>
      <div className="flex flex-col gap-2">
        {set.perks.map((p) => (
          <div key={p.required} className={cx("flex gap-2", !p.active && !neutral && "opacity-40")} title={p.description}>
            <span
              className={cx(
                "mt-px grid h-5 shrink-0 place-items-center rounded-md px-1.5 text-[10.5px] font-bold tabular-nums",
                p.active && !neutral ? "bg-(--accent-text) text-black" : "bg-white/10 text-white/70",
              )}
            >
              {p.required}×
            </span>
            {p.icon && <img src={BUNGIE + p.icon} alt="" className="mt-px size-5 shrink-0" />}
            <div className="min-w-0">
              <div className="text-[12px] font-medium">{p.name}</div>
              <div className="text-[11px] leading-snug text-white/55">{p.description}</div>
              {p.exact && (
                <div className="mt-1.5 rounded-lg border border-(--accent-glow) bg-black/25 px-2 py-1.5">
                  <div className="mb-0.5 text-[9px] font-semibold tracking-[0.14em] text-(--accent-text) uppercase">{t("clarity.title")}</div>
                  <p className="text-[11px] leading-relaxed whitespace-pre-line text-white/80">{p.exact}</p>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
      {set.perks.some((p) => p.exact) && <CompendiumCredit className="mt-2" />}
    </div>
  );
}

function PlugGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-[10.5px] font-semibold tracking-[0.14em] text-white/40 uppercase">{title}</div>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="shimmer skeleton h-[132px] rounded-[20px]" />
      <div className="grid grid-cols-3 gap-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="shimmer skeleton h-[84px] rounded-2xl" style={{ animationDelay: `${i * 0.1}s` }} />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="shimmer skeleton h-[260px] rounded-[20px]" />
        <div className="shimmer skeleton h-[260px] rounded-[20px]" style={{ animationDelay: "0.15s" }} />
      </div>
    </div>
  );
}
