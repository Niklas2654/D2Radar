import { useEffect, useRef, useState } from "react";
import { useScrollTopOn } from "../lib/scrollTop";
import { cx, GlassInput, GlassPanel, PanelHeader } from "../components/glass";
import { IconCrosshair } from "../components/icons";
import { WeaponUsage } from "../components/WeaponUsage";
import { WeaponIcon, WeaponView } from "../components/WeaponView";
import { useT } from "../lib/i18n";
import { useDetectedWeapon, weapons, type WeaponDetail, type WeaponSummary } from "../lib/weapons";

/** Weapon search plus the weapon last detected on the inspect screen.
 *  `initial`: a weapon open at first (the inspect page's, recognized last).
 *  `inspect`: on the inspect page over the game: no usage overview (that's
 *  the app's); back from a searched weapon goes to the recognized one. */
export function WeaponsPage({ initial = null, inspect = false }: { initial?: WeaponDetail | null; inspect?: boolean }) {
  const t = useT();
  const detected = useDetectedWeapon();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<WeaponSummary[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<WeaponDetail | null>(initial);
  // Back from a weapon: the list zooms back out.
  const [cameBack, setCameBack] = useState(false);
  // Another weapon (or back to the list): from the top.
  const detailScroll = useScrollTopOn(selected?.hash ?? null);

  // Debounced search.
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const id = window.setTimeout(() => {
      setSearching(true);
      weapons
        .search(q)
        .then((r) => !cancelled && setResults(r ?? []))
        .catch((e) => !cancelled && setError(String(e)))
        .finally(() => !cancelled && setSearching(false));
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [query]);

  // A newly detected weapon opens here too.
  useEffect(() => {
    if (detected) setSelected(detected);
  }, [detected]);

  // A weapon being opened (it can take a moment, the first time even a few
  // seconds): shown at once, so a click never seems to do nothing.
  const [opening, setOpening] = useState<{ hash: number; name?: string; icon?: string | null } | null>(null);
  const latest = useRef(0);
  const open = (hash: number, preview?: { name: string; icon: string | null }) => {
    setError(null);
    const request = ++latest.current;
    // Reloading the open weapon (copies moved): no loading screen.
    if (selected?.hash !== hash) setOpening({ hash, ...preview });
    weapons
      .detail(hash)
      .then((d) => {
        if (request !== latest.current) return;
        if (d) setSelected(d);
      })
      .catch((e) => request === latest.current && setError(String(e)))
      .finally(() => request === latest.current && setOpening(null));
  };

  return (
    <div className="grid h-full grid-cols-[300px_minmax(0,1fr)] gap-4 p-5">
      <GlassPanel className="flex min-h-0 flex-col p-4">
        <PanelHeader icon={<IconCrosshair />} title={t("weapons.title")} subtitle={t("weapons.subtitle")} />
        <GlassInput
          placeholder={t("weapons.searchPlaceholder")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onClear={() => setQuery("")}
          clearLabel={t("common.clear")}
          autoFocus
        />
        <div className="-mx-1 mt-3 flex min-h-0 flex-col gap-1 overflow-y-auto px-1 [&>*]:shrink-0">
          {searching && results.length === 0 && <p className="px-1 text-[12px] text-white/40">{t("weapons.loading")}</p>}
          {results.map((w) => {
            const open_ = w.versions.some((v) => v.hash === selected?.hash);
            return (
              <div
                key={w.hash}
                className={cx(
                  "rounded-xl border p-1.5 transition-[background-color,border-color] duration-200",
                  open_
                    ? "border-(--accent-glow) bg-(--accent-soft)"
                    : "border-white/[0.06] bg-white/[0.03] hover:border-white/15 hover:bg-white/[0.06]",
                )}
              >
                <button onClick={() => open(w.hash, { name: w.name, icon: w.icon })} className="flex w-full items-center gap-2.5 text-left">
                  <WeaponIcon icon={w.icon} watermark={w.watermark} exotic={w.tier === 6} className="size-9" />
                  <span className="min-w-0">
                    <span className={cx("block truncate text-[13px] font-medium", w.tier === 6 && "text-[#f0d66b]")}>
                      {w.name}
                    </span>
                    <span className="block truncate text-[11px] text-white/45">
                      {w.typeName}
                      {w.versions.length > 1 && ` · ${t("weapons.versionCount", { n: w.versions.length })}`}
                    </span>
                  </span>
                </button>
                {/* Every version (season) of the weapon, by its watermark. */}
                {w.versions.length > 1 && (
                  <div className="mt-1.5 flex flex-wrap gap-1 pl-[46px]">
                    {w.versions.map((v, i) => (
                      <button
                        key={v.hash}
                        onClick={() => open(v.hash)}
                        title={t("weapons.version", { i: i + 1, n: w.versions.length })}
                        className={cx(
                          "rounded-md p-0.5 transition-[box-shadow,opacity] duration-200",
                          selected?.hash === v.hash ? "shadow-[0_0_0_2px_var(--accent-halo)]" : "opacity-70 hover:opacity-100",
                        )}
                      >
                        <WeaponIcon icon={w.icon} watermark={v.watermark} exotic={w.tier === 6} className="size-7" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {!searching && query.trim() && results.length === 0 && (
            <p className="px-1 text-[12px] text-white/40">{t("weapons.noResults")}</p>
          )}
          {error && <p className="px-1 text-[12px] text-red-300">{error}</p>}
        </div>
      </GlassPanel>

      <div ref={detailScroll} className="-m-4 min-h-0 overflow-y-auto p-4 pr-5">
        {opening ? (
          <WeaponLoading name={opening.name} icon={opening.icon ?? null} onCancel={() => {
            latest.current++;
            setOpening(null);
          }} />
        ) : selected ? (
          <GlassPanel key={selected.hash} className="zoom-in-deeper p-5">
            {/* Back: to the list, or over the game to the recognized weapon
                (none to go back to on that one). */}
            {(!inspect || (initial && selected.hash !== initial.hash)) && (
              <button
                onClick={() => {
                  setSelected(inspect ? initial : null);
                  setCameBack(true);
                }}
                className="mb-3 text-[12px] text-white/45 transition-colors hover:text-white"
              >
                ← {inspect && initial ? t("inspect.backTo", { name: initial.name }) : t("usage.back")}
              </button>
            )}
            <WeaponView weapon={selected} onVersion={open} onCopiesChanged={() => open(selected.hash)} />
          </GlassPanel>
        ) : (
          inspect ? (
            <p className="px-1 py-6 text-center text-[13px] text-white/40">{t("inspect.weaponEmpty")}</p>
          ) : (
          <div className={cameBack ? "zoom-in-back flex flex-col gap-3" : "flex flex-col gap-3"}>
            <WeaponUsage onOpen={open} />
            <p className="px-1 text-center text-[12px] text-white/35">{t("weapons.empty")}</p>
          </div>
          )
        )}
      </div>
    </div>
  );
}

/** While a weapon opens: its name and icon (when known) and a radar
 *  sweeping, so it is clear something is happening. */
function WeaponLoading({ name, icon, onCancel }: { name?: string; icon: string | null; onCancel: () => void }) {
  const t = useT();
  return (
    <GlassPanel className="animate-widget-in flex min-h-[360px] flex-col items-center justify-center gap-5 p-8 text-center">
      <div className="relative size-24">
        <span className="absolute inset-0 rounded-full border border-(--accent-glow) opacity-60" />
        <span className="absolute inset-[22%] rounded-full border border-(--accent-glow) opacity-40" />
        <span className="absolute inset-0 animate-spin rounded-full bg-[conic-gradient(from_0deg,transparent_0_75%,var(--accent-soft)_92%,var(--accent))] [animation-duration:1.4s] [mask:radial-gradient(circle,transparent_0_60%,#000_61%)]" />
        <div className="absolute inset-[30%] grid place-items-center overflow-hidden rounded-lg">
          {icon ? (
            <WeaponIcon icon={icon} watermark={null} exotic={false} className="size-full" />
          ) : (
            <span className="size-2 rounded-full bg-(--accent-text) shadow-[0_0_5px_var(--accent)]" />
          )}
        </div>
      </div>
      <div>
        {name && <div className="font-display text-[18px] font-semibold">{name}</div>}
        <div className="mt-1 text-[12.5px] text-white/50">{t("weapons.loadingWeapon")}</div>
        <div className="mt-1 text-[11.5px] text-white/30">{t("weapons.loadingWeaponHint")}</div>
      </div>
      <button onClick={onCancel} className="text-[12px] text-white/40 transition-colors hover:text-white">
        {t("weapons.loadingCancel")}
      </button>
    </GlassPanel>
  );
}
