import { BUNGIE_ORIGIN } from "../lib/bungie";
import type { OwnCharacter } from "../lib/loadouts";
import { cx } from "./glass";

/** Pick one of the player's characters (emblem, class, light). */
export function CharacterPicker({
  characters,
  value,
  onChange,
  disabled,
}: {
  characters: OwnCharacter[];
  value: string | null;
  onChange: (id: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="grid grid-cols-3 gap-3">
      {characters.map((c) => {
        const active = c.id === value;
        return (
          <button
            key={c.id}
            onClick={() => onChange(c.id)}
            disabled={disabled}
            aria-pressed={active}
            className={cx(
              "relative h-[62px] overflow-hidden rounded-2xl border bg-white/[0.04] bg-cover bg-left text-left transition-[border-color,box-shadow,opacity] duration-200 disabled:cursor-default",
              active
                ? "border-(--accent) shadow-[0_0_11px_-3px_var(--accent-halo)]"
                : "border-white/10 opacity-60 hover:opacity-100",
            )}
            style={c.emblemBackgroundPath ? { backgroundImage: `url(${BUNGIE_ORIGIN + c.emblemBackgroundPath})` } : undefined}
          >
            <span className="absolute inset-0 bg-gradient-to-r from-transparent via-black/10 to-black/40" />
            <span className="relative flex h-full flex-col justify-center pr-4 pl-[72px]">
              <span className="text-[15px] font-semibold text-white drop-shadow">{c.className}</span>
              <span className="text-[12px] font-semibold text-[#f0d66b] drop-shadow">◆ {c.light}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
