import { useT } from "../lib/i18n";
import { checkForUpdate, installUpdate, useUpdate } from "../lib/updater";
import { GlassButton } from "./glass";

/** In the top bar, only while there is an update: one click installs it
 *  and Radar starts again in the new version. */
export function UpdateBadge() {
  const t = useT();
  const update = useUpdate();
  if (update.kind === "available") {
    return (
      <GlassButton size="sm" variant="primary" onClick={() => void installUpdate()}>
        {t("update.install", { version: update.version })}
      </GlassButton>
    );
  }
  if (update.kind === "installing") {
    return (
      <GlassButton size="sm" variant="primary" disabled>
        {progressLabel(t, update.progress)}
      </GlassButton>
    );
  }
  return null;
}

/** In Settings → About: check for updates, install one, and how it went. */
export function UpdateControl() {
  const t = useT();
  const update = useUpdate();
  return (
    <div className="flex flex-col items-end gap-1.5">
      {update.kind === "available" ? (
        <GlassButton size="sm" variant="primary" onClick={() => void installUpdate()}>
          {t("update.install", { version: update.version })}
        </GlassButton>
      ) : update.kind === "installing" ? (
        <GlassButton size="sm" variant="primary" disabled>
          {progressLabel(t, update.progress)}
        </GlassButton>
      ) : (
        <GlassButton size="sm" onClick={() => void checkForUpdate()} disabled={update.kind === "checking"}>
          {update.kind === "checking" ? t("update.checking") : t("update.check")}
        </GlassButton>
      )}
      {update.kind === "current" && <span className="text-[11.5px] text-white/45">{t("update.current")}</span>}
      {update.kind === "error" && <span className="max-w-64 text-right text-[11.5px] text-red-300">{update.message}</span>}
    </div>
  );
}

function progressLabel(t: ReturnType<typeof useT>, progress: number | null) {
  return progress === null ? t("update.installing") : t("update.progress", { percent: Math.round(progress * 100) });
}
