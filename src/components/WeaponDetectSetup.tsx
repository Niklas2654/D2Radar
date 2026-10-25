import { useEffect, useState } from "react";
import { useT } from "../lib/i18n";
import { weapons, type DetectConfig } from "../lib/weapons";
import { GlassPanel, GlassSwitch, KeyCap, PanelHeader } from "./glass";
import { IconCrosshair } from "./icons";

/** Settings for detecting the inspected weapon: on/off, and its hotkey. */
export function WeaponDetectSetup() {
  const t = useT();
  const [config, setConfig] = useState<DetectConfig | null>(null);

  useEffect(() => {
    void weapons.config().then((c) => c && setConfig(c));
  }, []);

  const setAuto = (auto: boolean) => {
    setConfig((c) => c && { ...c, auto });
    void weapons.setAuto(auto);
  };

  return (
    <GlassPanel className="p-5">
      <PanelHeader icon={<IconCrosshair />} title={t("detect.title")} subtitle={t("detect.subtitle")} />
      <GlassSwitch
        label={t("detect.auto")}
        description={t("detect.autoHint")}
        checked={config?.auto ?? false}
        onChange={setAuto}
      />

      <p className="mt-1 text-[12.5px] text-white/55">
        {t("detect.hotkey")} <KeyCap>F10</KeyCap>
      </p>
    </GlassPanel>
  );
}
