import { useEffect, useRef, useState, type PointerEvent } from "react";
import { useT } from "../lib/i18n";
import { isTauri } from "../lib/tauri";
import { weapons, type DetectConfig, type Region, type WeaponDetail } from "../lib/weapons";
import { MATCHED } from "./WeaponView";
import { cx, GlassButton, GlassPanel, GlassSwitch, KeyCap, PanelHeader } from "./glass";
import { IconCrosshair } from "./icons";

const DELAY_SECONDS = 5;

/**
 * Settings for detecting the inspected weapon: on/off, and calibrating
 * where its name is on screen (screenshot, then drag a box around it).
 */
export function WeaponDetectSetup() {
  const t = useT();
  const [config, setConfig] = useState<DetectConfig | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [draft, setDraft] = useState<Region | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [result, setResult] = useState<{ lines: string[]; weapon: WeaponDetail | null } | null>(null);
  /** Which box the next drag draws. */
  const [box, setBox] = useState<"name" | "icon">("name");
  const [error, setError] = useState<string | null>(null);
  const image = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    void weapons.config().then((c) => c && setConfig(c));
  }, []);

  const setAuto = (auto: boolean) => {
    setConfig((c) => c && { ...c, auto });
    void weapons.setAuto(auto);
  };

  const capture = async () => {
    setError(null);
    setResult(null);
    setCountdown(DELAY_SECONDS);
    const timer = window.setInterval(() => setCountdown((c) => (c && c > 1 ? c - 1 : null)), 1000);
    try {
      const url = await weapons.capture(DELAY_SECONDS);
      if (url) setPreview(url);
    } catch (e) {
      setError(String(e));
    } finally {
      window.clearInterval(timer);
      setCountdown(null);
    }
  };

  // Pointer position as a fraction of the screenshot.
  const at = (e: PointerEvent) => {
    const r = image.current!.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    };
  };

  const finish = async (region: Region) => {
    if (region.w < 0.01 || region.h < 0.01) return;
    const icon = box === "icon";
    setConfig((c) => c && (icon ? { ...c, icon: region } : { ...c, region }));
    setError(null);
    try {
      await weapons.setRegion(region, icon);
      setResult((await weapons.test()) ?? null);
      // Name done: the icon box is next.
      if (!icon) setBox("icon");
    } catch (e) {
      setError(String(e));
    }
  };

  const nameBox = box === "name" && draft ? draft : config?.region ?? null;
  const iconBox = box === "icon" && draft ? draft : config?.icon ?? null;
  const version = result?.weapon
    ? result.weapon.versions.findIndex((v) => v.hash === result.weapon!.hash) + 1
    : 0;

  return (
    <GlassPanel className="p-5">
      <PanelHeader icon={<IconCrosshair />} title={t("detect.title")} subtitle={t("detect.subtitle")} />
      <GlassSwitch
        label={t("detect.auto")}
        description={t("detect.autoHint")}
        checked={config?.auto ?? false}
        onChange={setAuto}
      />

      <p className="mt-1 mb-3 text-[12.5px] text-white/55">
        {t("detect.hotkey")} <KeyCap>F10</KeyCap>
      </p>

      <div className="mb-2 text-[13px] text-white/85">{t("detect.calibrate")}</div>
      <p className="mb-3 text-[12.5px] text-white/55">{t("detect.calibrateHint", { n: DELAY_SECONDS })}</p>
      <GlassButton onClick={() => void capture()} disabled={!isTauri || countdown !== null}>
        {countdown !== null ? t("detect.countdown", { n: countdown }) : t("detect.capture", { n: DELAY_SECONDS })}
      </GlassButton>

      {preview && (
        <div className="mt-3 flex items-center gap-2 text-[12.5px]">
          <span className="text-white/55">{t("detect.drawWhich")}</span>
          {(["name", "icon"] as const).map((b) => (
            <button
              key={b}
              onClick={() => setBox(b)}
              className={cx(
                "rounded-lg border px-2.5 py-1 transition-[background-color,border-color] duration-200",
                box === b
                  ? b === "name"
                    ? "border-(--accent) bg-(--accent-soft)"
                    : "border-white/60 bg-white/10"
                  : "border-white/10 hover:border-white/25",
              )}
            >
              {b === "name" ? t("detect.boxName") : t("detect.boxIcon")}
            </button>
          ))}
        </div>
      )}
      {preview && (
        <div
          ref={image}
          className="relative mt-3 cursor-crosshair touch-none overflow-hidden rounded-xl border border-white/10 select-none"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            start.current = at(e);
            setDraft({ ...start.current, w: 0, h: 0 });
          }}
          onPointerMove={(e) => {
            if (!start.current) return;
            const p = at(e);
            const s = start.current;
            setDraft({ x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y) });
          }}
          onPointerUp={() => {
            start.current = null;
            if (draft) void finish(draft);
            setDraft(null);
          }}
        >
          <img src={preview} alt="" className="block w-full" draggable={false} />
          {[
            { r: nameBox, style: "border-(--accent) bg-(--accent-soft)" },
            { r: iconBox, style: "border-dashed border-white/80 bg-white/10" },
          ].map(
            ({ r, style }, i) =>
              r && (
                <div
                  key={i}
                  className={cx("pointer-events-none absolute border-2", style)}
                  style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` }}
                />
              ),
          )}
        </div>
      )}
      {preview && (
        <p className="mt-2 text-[12px] text-white/45">{box === "name" ? t("detect.drawHint") : t("detect.iconHint")}</p>
      )}

      {result && (
        <div className="mt-3 rounded-xl border border-white/[0.07] bg-white/[0.035] p-3 text-[12.5px]">
          <div className="text-white/50">
            {t("detect.read")}: <span className="text-white/85">{result.lines.join(" · ") || "—"}</span>
          </div>
          <div className="mt-1 text-white/50">
            {t("detect.weapon")}:{" "}
            {result.weapon ? (
              <span className="font-semibold text-(--accent-text)">{result.weapon.name}</span>
            ) : (
              <span className="text-red-300">{t("detect.noMatch")}</span>
            )}
          </div>
          {result.weapon && result.weapon.versions.length > 1 && (
            <div className="mt-1 text-white/50">
              {t("detect.version")}:{" "}
              <span className="text-white/85">
                {t("weapons.version", { i: version, n: result.weapon.versions.length })} ·{" "}
                {t(MATCHED[result.weapon.matchedBy])}
              </span>
            </div>
          )}
        </div>
      )}
      {error && <p className="mt-2.5 text-[12.5px] text-red-300">{error}</p>}
    </GlassPanel>
  );
}
