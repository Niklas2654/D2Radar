import { useEffect, useRef, useState } from "react";
import { armorApi, type ArmorDetail, type ArmorHit } from "../lib/armor";
import { BUNGIE_ORIGIN } from "../lib/bungie";
import { useT } from "../lib/i18n";
import { cx, GlassInput, GlassPanel, PanelHeader } from "./glass";
import { ArmorCopies } from "./ArmorCopies";
import { HudArmor } from "./hud";
import { IconInventory } from "./icons";

/**
 * Armor by name (exotics and set pieces: the rest has nothing to show),
 * laid out as the weapons tab: the search on the left, the piece with its
 * perks and set bonuses on the right. `initial`: the piece recognized
 * last, open at first.
 */
export function ArmorSearch({ initial = null }: { initial?: ArmorDetail | null }) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ArmorHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ArmorDetail | null>(initial);
  const [opening, setOpening] = useState<string | null>(null);
  const latest = useRef(0);

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
      armorApi
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

  const open = (hit: ArmorHit) => {
    setError(null);
    const request = ++latest.current;
    setOpening(hit.item.name);
    armorApi
      .detail(hit.hashes)
      .then((d) => request === latest.current && d && setSelected(d))
      .catch((e) => request === latest.current && setError(String(e)))
      .finally(() => request === latest.current && setOpening(null));
  };

  const icon = (path: string | null) => (path ? (path.startsWith("http") ? path : BUNGIE_ORIGIN + path) : null);

  return (
    <div className="grid h-full grid-cols-[300px_minmax(0,1fr)] gap-4 p-5">
      <GlassPanel className="flex min-h-0 flex-col p-4">
        <PanelHeader icon={<IconInventory />} title={t("inspect.armor")} subtitle={t("inspect.armorSubtitle")} />
        <GlassInput
          placeholder={t("inspect.armorPlaceholder")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onClear={() => setQuery("")}
          clearLabel={t("common.clear")}
        />
        <div className="-mx-1 mt-3 flex min-h-0 flex-col gap-1 overflow-y-auto px-1 [&>*]:shrink-0">
          {searching && results.length === 0 && <p className="px-1 text-[12px] text-white/40">{t("weapons.loading")}</p>}
          {!searching && query.trim() && results.length === 0 && (
            <p className="px-1 text-[12px] text-white/40">{t("inspect.armorNoResults")}</p>
          )}
          {results.map((hit) => {
            const shown = selected?.item.name === hit.item.name;
            const src = icon(hit.item.icon);
            return (
              <button
                key={hit.hashes.join("-")}
                type="button"
                onClick={() => open(hit)}
                className={cx(
                  "flex items-center gap-2.5 rounded-xl border p-1.5 text-left transition-[background-color,border-color] duration-200",
                  shown
                    ? "border-(--accent-glow) bg-(--accent-soft)"
                    : "border-white/[0.06] bg-white/[0.03] hover:border-white/15 hover:bg-white/[0.06]",
                )}
              >
                {src ? (
                  <img src={src} alt="" className="size-9 shrink-0 rounded-md" />
                ) : (
                  <span className="size-9 shrink-0 rounded-md bg-white/[0.06]" />
                )}
                <span className="min-w-0">
                  <span className={cx("block truncate text-[13px] font-medium", hit.item.exotic && "text-[#f0d66b]")}>
                    {hit.item.name}
                  </span>
                  <span className="block truncate text-[11px] text-white/45">{hit.item.typeName}</span>
                </span>
              </button>
            );
          })}
          {error && <p className="px-1 text-[12px] text-red-300">{error}</p>}
        </div>
      </GlassPanel>

      <div className="-m-4 min-h-0 overflow-y-auto p-4 pr-5">
        {opening ? (
          <p className="px-1 py-6 text-center text-[13px] text-white/50">{t("inspect.opening", { name: opening })}</p>
        ) : selected ? (
          <div key={selected.item.hash} className="zoom-in-deeper">
            {/* The set bonus with the picked copy under it, the copies beside. */}
            {selected.versions?.length ? (
              <ArmorCopies versions={selected.versions}>
                <HudArmor armor={selected} wide />
              </ArmorCopies>
            ) : (
              <HudArmor armor={selected} wide />
            )}
          </div>
        ) : (
          <p className="px-1 py-6 text-center text-[13px] text-white/40">{t("inspect.armorEmpty")}</p>
        )}
      </div>
    </div>
  );
}
