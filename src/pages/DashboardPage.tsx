import { Badge, cx, Divider, GlassButton, GlassPanel, GlassSlider, GlassSwitch, PanelHeader } from "../components/glass";
import { HotkeyCaps } from "../components/HotkeysPanel";
import { IconGrid, IconKeyboard, IconLayers, IconSliders } from "../components/icons";
import { BungiePanel } from "../components/BungiePanel";
import type { Snapshot } from "../lib/bungie";
import { useHotkeys } from "../lib/hotkeys";
import { useT } from "../lib/i18n";
import { useOverlayState } from "../lib/overlay";
import { CustomAccent } from "../components/ColorPicker";
import { ACCENTS, useSettings } from "../lib/settings";
import { broadcast } from "../lib/tauri";

/** Overlay controls, appearance, widgets and the Bungie connection. */
export function DashboardPage({ snapshot }: { snapshot: Snapshot }) {
  const t = useT();
  const [settings, update] = useSettings();
  const overlay = useOverlayState();
  const [keys] = useHotkeys();

  // Two equal columns; panels side by side share a row and its height.
  return (
    <main className="grid h-full auto-rows-min grid-cols-2 gap-4 overflow-y-auto p-5">
        <BungiePanel snapshot={snapshot} />

        <GlassPanel className="p-5">
          <PanelHeader
            icon={<IconLayers />}
            title={t("overlay.title")}
            subtitle={t("overlay.subtitle")}
            right={
              <Badge tone={overlay.visible && overlay.gameRunning ? "live" : "muted"}>
                {!overlay.visible ? t("overlay.off") : overlay.gameRunning ? t("overlay.on") : t("overlay.waiting")}
              </Badge>
            }
          />
          <GlassSwitch
            label={t("overlay.show")}
            description={t("overlay.showHint")}
            checked={overlay.visible}
            onChange={overlay.setVisible}
          />
          <Divider />
          <GlassSwitch
            label={t("overlay.edit")}
            description={overlay.gameRunning ? t("overlay.editHint") : t("overlay.editInGame")}
            checked={overlay.edit}
            onChange={overlay.setEdit}
          />
          <div className="mt-3 flex gap-2">
            <GlassButton variant="primary" onClick={() => overlay.setEdit(!overlay.edit)}>
              {overlay.edit ? t("overlay.editStop") : t("overlay.editStart")}
            </GlassButton>
            <GlassButton onClick={() => broadcast("layout-reset", null)}>{t("overlay.reset")}</GlassButton>
          </div>
        </GlassPanel>

        <GlassPanel className="p-5">
          <PanelHeader icon={<IconGrid />} title={t("widgets.title")} subtitle={t("widgets.subtitle")} />
          <GlassSwitch
            label={t("widgets.session")}
            description={t("widgets.sessionHint")}
            checked={settings.widgets.session}
            onChange={(session) => update({ widgets: { ...settings.widgets, session } })}
          />
          <Divider />
          <GlassSwitch
            label={t("widgets.stats")}
            description={t("widgets.statsHint")}
            checked={settings.widgets.stats}
            onChange={(stats) => update({ widgets: { ...settings.widgets, stats } })}
          />
          <Divider />
          <GlassSwitch
            label={t("widgets.weapon")}
            description={t("widgets.weaponHint")}
            checked={settings.widgets.weapon}
            onChange={(weapon) => update({ widgets: { ...settings.widgets, weapon } })}
          />
        </GlassPanel>

        <GlassPanel className="p-5">
          <PanelHeader icon={<IconSliders />} title={t("appearance.title")} subtitle={t("appearance.subtitle")} />
          <GlassSlider
            label={t("appearance.opacity")}
            value={settings.opacity}
            min={0}
            max={1}
            format={(v) => `${Math.round(v * 100)} %`}
            onChange={(opacity) => update({ opacity })}
          />
          <GlassSlider
            label={t("appearance.size")}
            value={settings.scale}
            min={0.75}
            max={1.4}
            format={(v) => `${Math.round(v * 100)} %`}
            onChange={(scale) => update({ scale })}
          />
          <GlassSwitch
            label={t("appearance.inCapture")}
            description={t("appearance.inCaptureHint")}
            checked={settings.showInCapture}
            onChange={(showInCapture) => update({ showInCapture })}
          />
          <div className="pt-3">
            <div className="mb-2.5 text-[13.5px] text-white/90">{t("appearance.accent")}</div>
            <div className="grid grid-cols-7 gap-2">
              {(Object.keys(ACCENTS) as (keyof typeof ACCENTS)[]).map((id) => (
                <button
                  key={id}
                  onClick={() => update({ accent: id })}
                  aria-pressed={settings.accent === id}
                  title={ACCENTS[id].label}
                  className={cx(
                    "group flex flex-col items-center gap-1.5 rounded-xl border py-2 transition-all",
                    settings.accent === id
                      ? "border-white/25 bg-white/[0.08]"
                      : "border-transparent hover:bg-white/[0.05]",
                  )}
                >
                  <span
                    className="size-5 rounded-full shadow-[inset_0_1px_0_rgb(255_255_255/0.5)] transition-transform group-hover:scale-110"
                    style={{
                      background: ACCENTS[id].color,
                      boxShadow:
                        settings.accent === id ? `0 0 14px ${ACCENTS[id].color}` : undefined,
                    }}
                  />
                  <span className="text-[10.5px] text-white/55">{ACCENTS[id].label}</span>
                </button>
              ))}
              <CustomAccent
                active={settings.accent === "custom"}
                color={settings.customAccent}
                onPick={(customAccent) => update({ accent: "custom", customAccent })}
              />
            </div>
          </div>
        </GlassPanel>

        <GlassPanel className="p-5">
          <PanelHeader icon={<IconKeyboard />} title={t("hotkeys.title")} subtitle={t("hotkeys.changeInSettings")} />
          <div className="space-y-2.5 text-[13px]">
            <div className="flex items-center justify-between">
              <span className="text-white/70">{t("hotkeys.toggle")}</span>
              <HotkeyCaps keys={keys.overlay} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-white/70">{t("overlay.edit")}</span>
              <HotkeyCaps keys={keys.edit} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-white/70">{t("widgets.weapon")}</span>
              <HotkeyCaps keys={keys.weapon} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-white/70">{t("hotkeys.dim")}</span>
              <HotkeyCaps keys={keys.dim} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-white/70">{t("hotkeys.discord")}</span>
              <HotkeyCaps keys={keys.discord} />
            </div>
          </div>
          <p className="mt-4 text-[12px] text-white/40">{t("hotkeys.avoidLetters")}</p>
        </GlassPanel>
    </main>
  );
}
