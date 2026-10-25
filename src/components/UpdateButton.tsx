import { useT } from "../lib/i18n";
import { checkForUpdate, installUpdate, useUpdate } from "../lib/updater";
import { GlassButton, Tooltip } from "./glass";
import { IconDownload } from "./icons";

/** In the top bar next to the name, only while there is an update: an
 *  icon in the accent color, one click installs it and Radar starts again in the
 *  new version; while it loads, how far. */
export function UpdateBadge() {
  const t = useT();
  const update = useUpdate();
  if (update.kind !== "available" && update.kind !== "installing") return null;
  const installing = update.kind === "installing";
  const label = installing ? progressLabel(t, update.progress) : t("update.install", { version: update.version });
  return (
    <Tooltip label={label}>
      <button
        type="button"
        aria-label={label}
        disabled={installing}
        onClick={() => void installUpdate()}
        className="grid h-7 min-w-7 cursor-pointer place-items-center rounded-full bg-white/[0.07] px-1.5 text-(--accent-text) transition-colors hover:bg-white/[0.13] disabled:cursor-default"
      >
        {installing && update.progress !== null ? (
          <span className="text-[10.5px] font-semibold tabular-nums">{Math.round(update.progress * 100)}%</span>
        ) : (
          <IconDownload />
        )}
      </button>
    </Tooltip>
  );
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
