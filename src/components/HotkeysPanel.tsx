import { useEffect, useState, type ReactNode } from "react";
import {
  blocksCommonShortcut,
  typingKey,
  HOTKEY_ACTIONS,
  hotkeys,
  keyLabels,
  keysFromEvent,
  useHotkeys,
  type FixedHotkeyAction,
  type HotkeyAction,
  type HotkeyConfig,
} from "../lib/hotkeys";
import { useLanguage, useT, type TranslationKey } from "../lib/i18n";
import { cx, GlassPanel, GlassSlider, KeyCap, PanelHeader } from "./glass";
import { IconKeyboard } from "./icons";

const LABELS: Record<FixedHotkeyAction, [TranslationKey, TranslationKey]> = {
  overlay: ["hotkeys.toggle", "hotkeys.toggleHint"],
  edit: ["overlay.edit", "hotkeys.editHint"],
  weapon: ["widgets.weapon", "hotkeys.weaponHint"],
  dim: ["hotkeys.dim", "hotkeys.dimHint"],
  discord: ["hotkeys.discord", "hotkeys.discordHint"],
};

/** Key caps for a hotkey string, or a dash when none is set. */
export function HotkeyCaps({ keys }: { keys: string }) {
  const german = useLanguage() === "de";
  const labels = keyLabels(keys, german);
  if (labels.length === 0) return <span className="text-[12px] text-white/35">–</span>;
  return (
    <span className="flex items-center gap-1">
      {labels.map((k, i) => (
        <KeyCap key={i}>{k}</KeyCap>
      ))}
    </span>
  );
}

/**
 * One hotkey row: label on the left, the keys on the right. Click the keys,
 * then press the new combination (Esc cancels, Backspace removes it).
 */
export function HotkeyRow({
  label,
  hint,
  action,
  config,
  onChange,
}: {
  label: ReactNode;
  hint?: ReactNode;
  action: HotkeyAction;
  config: HotkeyConfig;
  onChange: (next: HotkeyConfig) => void;
}) {
  const t = useT();
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const keys = hotkeys.keysOf(config, action);

  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        setRecording(false);
        return;
      }
      const next = ["Backspace", "Delete"].includes(e.key) && !e.ctrlKey && !e.altKey ? "" : keysFromEvent(e);
      if (next === null) return;
      setRecording(false);
      hotkeys
        .set(config, action, next)
        .then((c) => {
          onChange(c);
          setError(null);
        })
        .catch((err) => setError(String(err)));
    };
    const cancel = () => setRecording(false);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("blur", cancel);
    };
  }, [recording, config, action, onChange]);

  return (
    <div className="py-1.5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">{label}{hint}</div>
        <button
          onClick={() => setRecording(!recording)}
          title={t("hotkeys.change")}
          className={cx(
            "flex h-9 min-w-24 shrink-0 items-center justify-center rounded-xl border px-2 transition-[border-color,background-color,box-shadow] duration-200",
            recording
              ? "border-(--accent) bg-(--accent-soft) shadow-[0_0_9px_-3px_var(--accent-halo)]"
              : "border-white/10 bg-white/[0.04] hover:border-white/20 hover:bg-white/[0.08]",
          )}
        >
          {recording ? (
            <span className="animate-pulse text-[12px] text-(--accent-text)">{t("hotkeys.press")}</span>
          ) : (
            <HotkeyCaps keys={keys} />
          )}
        </button>
      </div>
      {error && <p className="mt-1 text-[12px] text-red-300">{error}</p>}
      {!error && blocksCommonShortcut(keys) && <p className="mt-1 text-[12px] text-amber-200">{t("hotkeys.blocksCommon")}</p>}
      {!error && typingKey(keys) && <p className="mt-1 text-[12px] text-amber-200">{t("hotkeys.typingKey")}</p>}
    </div>
  );
}

/** Settings: set each hotkey by pressing it, and DIM's opacity in game. */
export function HotkeysPanel() {
  const t = useT();
  const [config, setConfig] = useHotkeys();

  return (
    <GlassPanel className="p-5">
      <PanelHeader icon={<IconKeyboard />} title={t("hotkeys.title")} subtitle={t("hotkeys.subtitle")} />
      <div className="flex flex-col gap-1">
        {HOTKEY_ACTIONS.map((action) => {
          const [label, hint] = LABELS[action];
          return (
            <HotkeyRow
              key={action}
              action={action}
              config={config}
              onChange={setConfig}
              label={<div className="text-[13.5px] text-white/90">{t(label)}</div>}
              hint={<div className="text-[12px] text-white/45">{t(hint)}</div>}
            />
          );
        })}
      </div>
      <p className="mt-2 text-[12px] text-white/40">{t("hotkeys.recordHint")}</p>
      <p className="mt-1 text-[12px] text-white/40">{t("hotkeys.avoidLetters")}</p>
      <div className="mt-2">
        <GlassSlider
          label={t("hotkeys.dimOpacity")}
          value={config.dimOpacity}
          min={0.2}
          max={1}
          format={(v) => `${Math.round(v * 100)} %`}
          onChange={(dimOpacity) => {
            setConfig({ ...config, dimOpacity });
            void hotkeys.setDimOpacity(config, dimOpacity);
          }}
        />
        <GlassSlider
          label={t("hotkeys.discordOpacity")}
          value={config.discordOpacity}
          min={0.2}
          max={1}
          format={(v) => `${Math.round(v * 100)} %`}
          onChange={(discordOpacity) => {
            setConfig({ ...config, discordOpacity });
            void hotkeys.setDiscordOpacity(config, discordOpacity);
          }}
        />
      </div>
    </GlassPanel>
  );
}
