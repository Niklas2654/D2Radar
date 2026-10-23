import { getVersion } from "@tauri-apps/api/app";
import { useEffect, useState } from "react";
import { cx, GlassPanel, GlassSwitch, PanelHeader } from "../components/glass";
import { IconCheck, IconGlobe, IconLayers, IconRadar, Logo } from "../components/icons";
import { LANGUAGES, translate, useT } from "../lib/i18n";
import { WeaponDetectSetup } from "../components/WeaponDetectSetup";
import { JOIN_VERBS } from "./DiscordPage";
import { BungieLoginPanel } from "../components/BungieLoginPanel";
import { HotkeysPanel } from "../components/HotkeysPanel";
import { UpdateControl } from "../components/UpdateButton";
import { useSettings } from "../lib/settings";
import { call, isTauri } from "../lib/tauri";


/** Start Radar with Windows, waiting in the background for Destiny 2. */
function StartupPanel() {
  const t = useT();
  const [on, setOn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (isTauri) void call<boolean>("launch_with_destiny_get").then((v) => setOn(!!v));
  }, []);
  const change = (value: boolean) => {
    setError(null);
    setOn(value);
    void call<boolean>("launch_with_destiny_set", { on: value })
      .then((v) => setOn(!!v))
      .catch((e) => {
        setOn(!value);
        setError(String(e));
      });
  };
  return (
    <GlassPanel className="p-5">
      <PanelHeader icon={<IconRadar />} title={t("startup.title")} subtitle={t("startup.subtitle")} />
      <GlassSwitch label={t("startup.withDestiny")} description={t("startup.withDestinyHint")} checked={on} onChange={change} />
      {on && (
        <p className="animate-fade-in mt-2 flex gap-2.5 rounded-xl border border-(--accent-glow) bg-(--accent-soft) px-3 py-2.5 text-[12px] leading-relaxed text-white/80">
          <span className="mt-0.5 size-2 shrink-0 animate-pulse-dot rounded-full bg-(--accent)" />
          {t("startup.background")}
        </p>
      )}
      {error && <p className="mt-2 rounded-lg border border-red-400/20 bg-red-500/10 px-3 py-2 text-[12px] text-red-200">{error}</p>}
    </GlassPanel>
  );
}

/** Destiny's language on this PC: it translates its chat commands, so join
 *  buttons (Discord) copy the one it understands (/join, /beitreten …). */
function GameLanguagePanel() {
  const t = useT();
  const [language, setLanguage] = useState<string>("en");
  useEffect(() => {
    if (isTauri) void call<{ gameLanguage?: string }>("discord_config").then((c) => setLanguage(c?.gameLanguage || "en"));
  }, []);
  const verb = (JOIN_VERBS.find((v) => v.id === language) ?? JOIN_VERBS[0]).verb;
  return (
    <GlassPanel className="p-5">
      <PanelHeader icon={<IconGlobe />} title={t("discord.gameLanguage")} subtitle={t("discord.gameLanguageHint", { verb })} />
      <div className="grid grid-cols-4 gap-2">
        {JOIN_VERBS.map((v) => (
          <button
            key={v.id}
            type="button"
            onClick={() => {
              setLanguage(v.id);
              void call("discord_set_game_language", { language: v.id });
            }}
            aria-pressed={language === v.id}
            className={cx(
              "flex flex-col items-center gap-0.5 rounded-xl border px-2 py-2 transition-colors",
              language === v.id
                ? "border-(--accent-glow) bg-(--accent-soft) text-(--accent-text)"
                : "border-white/[0.07] bg-white/[0.03] text-white/70 hover:border-white/15",
            )}
          >
            <span className="text-[13px] font-semibold">{v.label}</span>
            <span className="text-[11px] text-white/45">{v.verb}</span>
          </button>
        ))}
      </div>
    </GlassPanel>
  );
}

export function SettingsPage() {
  const t = useT();
  const [settings, update] = useSettings();
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    if (isTauri) void getVersion().then(setVersion);
  }, []);

  return (
    <div className="h-full overflow-y-auto p-5">
      <div className="mx-auto flex max-w-2xl flex-col gap-4">
        <GlassPanel className="p-5">
          <PanelHeader icon={<IconGlobe />} title={t("settings.language")} subtitle={t("settings.languageHint")} />
          <div className="grid grid-cols-2 gap-3">
            {LANGUAGES.map((lang) => {
              const active = settings.language === lang.id;
              return (
                <button
                  key={lang.id}
                  onClick={() => update({ language: lang.id })}
                  aria-pressed={active}
                  className={cx(
                    "relative flex flex-col items-start gap-1 rounded-2xl border p-4 text-left transition-[background-color,border-color,box-shadow] duration-200",
                    active
                      ? "border-(--accent-glow) bg-(--accent-soft) shadow-[0_0_12px_-4px_var(--accent-halo)]"
                      : "border-white/[0.07] bg-white/[0.03] hover:border-white/15 hover:bg-white/[0.06]",
                  )}
                >
                  <span className="font-display text-[16px] font-semibold">{lang.label}</span>
                  <span className="text-[12px] text-white/45">{lang.hint}</span>
                  {/* A sample in that language, so the choice is obvious either way. */}
                  <span className="mt-2 text-[12.5px] text-white/70">
                    {translate(lang.id, "nav.dashboard")} · {translate(lang.id, "nav.fireteam")} ·{" "}
                    {translate(lang.id, "nav.settings")}
                  </span>
                  {active && (
                    <span className="absolute top-3 right-3 grid size-6 place-items-center rounded-full bg-(--accent-text) text-black">
                      <IconCheck />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </GlassPanel>

        <GlassPanel className="p-5">
          <PanelHeader icon={<IconLayers />} title={t("settings.stream")} subtitle={t("settings.streamHint")} />
          <GlassSwitch
            label={t("appearance.inCapture")}
            description={t("appearance.inCaptureHint")}
            checked={settings.showInCapture}
            onChange={(showInCapture) => update({ showInCapture })}
          />
        </GlassPanel>

        <GlassPanel className="p-5">
          <PanelHeader icon={<IconLayers />} title={t("hudContent.title")} subtitle={t("hudContent.subtitle")} />
          {(
            [
              ["season", "hudContent.season", "hudContent.seasonHint"],
              ["possiblePerks", "hudContent.possiblePerks", "hudContent.possiblePerksHint"],
              ["exoticPerks", "hudContent.exoticPerks", "hudContent.exoticPerksHint"],
              ["setBonuses", "hudContent.setBonuses", "hudContent.setBonusesHint"],
              ["hoverDetails", "hudContent.hoverDetails", "hudContent.hoverDetailsHint"],
            ] as const
          ).map(([key, label, hint]) => (
            <GlassSwitch
              key={key}
              label={t(label)}
              description={t(hint)}
              checked={settings.hud[key]}
              onChange={(on) => update({ hud: { ...settings.hud, [key]: on } })}
            />
          ))}
        </GlassPanel>

        <GameLanguagePanel />

        <StartupPanel />

        <BungieLoginPanel />

        <HotkeysPanel />

        <WeaponDetectSetup />


        <GlassPanel className="p-5">
          <div className="flex items-center gap-4">
            <Logo size={40} />
            <div className="min-w-0 flex-1">
              <h2 className="font-display text-[15px] font-semibold">{t("settings.about")}</h2>
              <p className="text-[12.5px] text-white/50">{t("settings.version", { version: version ?? "dev" })}</p>
            </div>
            {isTauri && <UpdateControl />}
          </div>
          <p className="mt-4 text-[12px] leading-relaxed text-white/40">{t("settings.disclaimer")}</p>
        </GlassPanel>
      </div>
    </div>
  );
}
