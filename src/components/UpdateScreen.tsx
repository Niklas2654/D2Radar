import { useEffect, useState } from "react";
import { useT } from "../lib/i18n";
import { useUpdate, type UpdateState } from "../lib/updater";
import { NeonRadar } from "./Splash";

/** While an update installs: the start screen's radar over the whole app, its
 *  ring filling as the update downloads; then it installs (no window of its
 *  own, see tauri.conf.json) and Radar starts again in the new version. */
export function UpdateScreen() {
  const update = useUpdate();
  if (update.kind !== "installing") return null;
  return <UpdateView update={update} />;
}

function UpdateView({ update }: { update: Extract<UpdateState, { kind: "installing" }> }) {
  const t = useT();
  const restarting = update.progress !== null && update.progress >= 1;
  const status = restarting
    ? t("update.restarting")
    : update.progress === null
      ? t("update.installing")
      : t("update.progress", { percent: Math.round(update.progress * 100) });
  return (
    <div className="splash fixed inset-0 z-[100] grid place-items-center overflow-hidden" data-tauri-drag-region>
      <div className="relative flex flex-col items-center" data-tauri-drag-region>
        <NeonRadar progress={update.progress ?? 0} closingAt={null} />
        <div className="-mt-6 flex flex-col items-center gap-1.5">
          <h1 className="font-display text-[17px] font-semibold text-white/90">{t("update.screenTitle")}</h1>
          <div className="text-[12px] font-semibold text-(--accent-text) tabular-nums">Version {update.version}</div>
          <p className="mt-2 h-4 text-[11.5px] tracking-wide text-white/40 tabular-nums">{status}</p>
        </div>
      </div>
    </div>
  );
}

/** Development only (?update-preview): the screen with a made-up download. */
export function UpdateScreenPreview() {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setProgress((p) => (p >= 1.4 ? 0 : p + 0.01)), 80);
    return () => window.clearInterval(id);
  }, []);
  return <UpdateView update={{ kind: "installing", version: "1.3.0", progress: Math.min(1, progress) }} />;
}
