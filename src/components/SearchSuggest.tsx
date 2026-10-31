import { useMemo, useState } from "react";
import { useT } from "../lib/i18n";
import type { Choice } from "../lib/presets";
import { cx } from "./glass";

/** A word or phrase the items have, and what it is. */
interface Term {
  text: string;
  kind: "name" | "type" | "perk" | "source" | "tag" | "rarity";
}

/** Every term of `items` (once each), for completing a search; the
 *  rarity in the app's language (`rarity`: exotic, legendary). */
function termsOf(items: Choice[], rarity: [string, string]): Term[] {
  const seen = new Map<string, Term>();
  const put = (text: string | undefined, kind: Term["kind"]) => {
    const t = text?.trim();
    if (t && !seen.has(t.toLowerCase())) seen.set(t.toLowerCase(), { text: t, kind });
  };
  for (const c of items) {
    put(c.name, "name");
    put(c.typeName, "type");
    for (const p of c.perks ?? []) put(p, "perk");
    for (const tag of c.tags ?? []) put(tag, "tag");
    // "source: "root of nightmares" raid" -> root of nightmares raid
    put(c.source?.replace(/^source:\s*/i, "").replace(/["“”]/g, ""), "source");
    put(c.exotic ? rarity[0] : rarity[1], "rarity");
  }
  return [...seen.values()];
}

/**
 * A search box that completes as you type: terms of the items it searches
 * (their names, types, perks, sources, slot / ammo / element, rarity) whose
 * words start like the last word typed. Click, Tab or Enter takes one (the
 * word is replaced by it); arrow keys move.
 */
export function SearchSuggest({
  value,
  onChange,
  items,
  placeholder,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  items: Choice[];
  placeholder?: string;
  className?: string;
}) {
  const t = useT();
  const exotic = t("search.exotic");
  const legendary = t("search.legendary");
  const terms = useMemo(() => termsOf(items, [exotic, legendary]), [items, exotic, legendary]);
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(0);
  // The word being typed (after the last space), and what's before it.
  const at = value.lastIndexOf(" ") + 1;
  const word = value.slice(at).toLowerCase();
  const before = value.slice(0, at).toLowerCase();
  const suggestions = useMemo(() => {
    if (word.length < 1) return [];
    return terms
      .filter((term) => {
        const lower = term.text.toLowerCase();
        // Not one that's in the search already.
        if (before.includes(lower)) return false;
        return lower.split(/[\s\-–:]+/).some((w) => w.startsWith(word)) && lower !== word;
      })
      .sort((a, b) => {
        // Starting with it first, then shorter (closer) ones.
        const sa = a.text.toLowerCase().startsWith(word) ? 0 : 1;
        const sb = b.text.toLowerCase().startsWith(word) ? 0 : 1;
        return sa - sb || a.text.length - b.text.length;
      })
      .slice(0, 8);
  }, [terms, word, before]);
  const open = focused && suggestions.length > 0;
  const take = (term: Term) => {
    onChange(`${value.slice(0, at)}${term.text.toLowerCase()} `);
    setActive(0);
  };
  return (
    <div className={cx("relative", className)}>
      <input
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setActive(0);
        }}
        onFocus={() => setFocused(true)}
        // (After a click on a suggestion has landed.)
        onBlur={() => window.setTimeout(() => setFocused(false), 120)}
        onKeyDown={(e) => {
          if (!open) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => (a + 1) % suggestions.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => (a - 1 + suggestions.length) % suggestions.length);
          } else if (e.key === "Tab" || e.key === "Enter") {
            e.preventDefault();
            take(suggestions[active]);
          } else if (e.key === "Escape") {
            setFocused(false);
          }
        }}
        placeholder={placeholder}
        className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 text-[12.5px] text-white outline-none placeholder:text-white/35 focus:border-(--accent-glow)"
      />
      {open && (
        <div className="animate-fade-in absolute top-full right-0 left-0 z-30 mt-1 overflow-hidden rounded-xl border border-white/10 bg-[#070910]/97 py-1 shadow-[0_14px_36px_-12px_rgb(0_0_0/0.9)] backdrop-blur-md">
          {suggestions.map((term, i) => (
            <button
              key={`${term.kind}:${term.text}`}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => take(term)}
              onMouseEnter={() => setActive(i)}
              className={cx("flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-[12.5px]", i === active ? "bg-(--accent-soft) text-white" : "text-white/75")}
            >
              <span className="truncate">{term.text}</span>
              <span className="shrink-0 text-[10px] tracking-[0.08em] text-white/35 uppercase">{t(`search.kind.${term.kind}`)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
