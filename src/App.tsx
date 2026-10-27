import { useEffect, useState } from "react";
import { Badge, Tooltip } from "./components/glass";
import { IconChat, IconCrosshair, IconDim, IconRadar, IconSettings, IconSwap, IconUsers } from "./components/icons";
import { Navbar, type NavItem } from "./components/Navbar";
import { Backdrop } from "./components/Backdrop";
import { CopySwap } from "./components/CopySwap";
import { UpdateBadge } from "./components/UpdateButton";
import { UpdateScreen } from "./components/UpdateScreen";
import { Splash } from "./components/Splash";
import { PageTransition } from "./components/PageTransition";
import { useBungie } from "./lib/bungie";
import { startLights } from "./lib/lights";
import { keepFresh } from "./lib/preload";
import { reloadAllPlayers } from "./lib/fireteam";
import { useT } from "./lib/i18n";
import { accentColor, useSettings } from "./lib/settings";
import { startUpdateChecks } from "./lib/updater";
import { call, isDemo } from "./lib/tauri";
import { DashboardPage } from "./pages/DashboardPage";
import { DimPage, preloadDimIfUsed } from "./pages/DimPage";
import { DiscordPage, preloadDiscord } from "./pages/DiscordPage";
import { FireteamPage } from "./pages/FireteamPage";
import { LoadoutsPage } from "./pages/LoadoutsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { ArsenalPage } from "./pages/ArsenalPage";

type PageKey = "dashboard" | "fireteam" | "weapons" | "loadouts" | "dim" | "discord" | "settings";

const ORDER: readonly PageKey[] = ["dashboard", "fireteam", "weapons", "loadouts", "dim", "discord", "settings"];

export function App() {
  const t = useT();
  const [settings] = useSettings();
  const { language, showInCapture } = settings;
  const [page, setPage] = useState<PageKey>("dashboard");
  const snapshot = useBungie();

  const pages: NavItem<PageKey>[] = [
    { key: "dashboard", label: t("nav.dashboard"), icon: <IconRadar /> },
    { key: "fireteam", label: t("nav.fireteam"), icon: <IconUsers /> },
    { key: "weapons", label: t("nav.weapons"), icon: <IconCrosshair /> },
    { key: "loadouts", label: t("nav.loadouts"), icon: <IconSwap /> },
    { key: "dim", label: t("nav.dim"), icon: <IconDim /> },
    { key: "discord", label: t("nav.discord"), icon: <IconChat /> },
    { key: "settings", label: t("nav.settings"), icon: <IconSettings /> },
  ];

  // The Rust side localizes its messages and Bungie content (item and
  // activity names); keep it on the app language.
  useEffect(() => {
    void call("set_language", { language }).then(reloadAllPlayers);
  }, [language]);

  useEffect(() => {
    void call("overlay_set_capture_visible", { visible: showInCapture });
  }, [showInCapture]);


  // DIM in Radar's accent color (its theme), whichever page is open.
  const accent = accentColor(settings);
  useEffect(() => {
    void call("dim_set_accent", { color: accent });
  }, [accent]);

  // The loading screen at start loads everything (and DIM and Discord in
  // their hidden webviews); afterwards the data is kept fresh.
  // (Not in the website's demo: its data is there at once.)
  const [loading, setLoading] = useState(!isDemo);
  // True when DIM is loaded too (only once it has been used).
  const startWebviews = () => {
    preloadDiscord(accentColor(settings));
    return preloadDimIfUsed();
  };
  useEffect(() => (loading ? undefined : keepFresh()), [loading]);
  // Lights running through the app now and then (after the loading screen).
  useEffect(() => (loading ? undefined : startLights()), [loading]);

  // Panels can link to a page (see navigate()).
  useEffect(() => {
    const go = (e: Event) => {
      const target = (e as CustomEvent<string>).detail as PageKey;
      if (ORDER.includes(target)) setPage(target);
    };
    window.addEventListener("radar:navigate", go);
    return () => window.removeEventListener("radar:navigate", go);
  }, []);

  // Ctrl+1, Ctrl+2, … switch pages.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const index = Number(e.key) - 1;
      if (e.ctrlKey && index >= 0 && index < ORDER.length) {
        e.preventDefault();
        setPage(ORDER[index]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Looking for a newer Radar now and then (an update shows in the top bar).
  useEffect(() => (loading ? undefined : startUpdateChecks()), [loading]);

  const name = snapshot.player?.displayName;
  const status = (
    <div className="flex items-center gap-2">
      <UpdateBadge />
      {snapshot.status !== "unconfigured" && (
        <NameBadge name={name} live={!!snapshot.online} fallback={t(snapshot.online ? "common.online" : "common.offline")} />
      )}
    </div>
  );

  return (
    <div className="flex h-full flex-col">
      <Backdrop />
      {loading && <Splash startWebviews={startWebviews} onDone={() => setLoading(false)} />}
      <UpdateScreen />
      <Navbar items={pages} active={page} onChange={setPage} right={status} />
      <PageTransition
        page={page}
        order={ORDER}
        render={(key, phase, dir) =>
          key === "dim" ? (
            <DimPage phase={phase} dir={dir} />
          ) : key === "discord" ? (
            <DiscordPage phase={phase} dir={dir} />
          ) : key === "fireteam" ? (
            <FireteamPage snapshot={snapshot} />
          ) : key === "weapons" ? (
            <ArsenalPage />
          ) : key === "loadouts" ? (
            <LoadoutsPage />

          ) : key === "settings" ? (
            <SettingsPage />
          ) : (
            <DashboardPage snapshot={snapshot} />
          )
        }
      />
    </div>
  );
}

/** The player's Bungie name; a click copies it (e.g. to add a friend). */
function NameBadge({ name, live, fallback }: { name?: string; live: boolean; fallback: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 1400);
    return () => window.clearTimeout(id);
  }, [copied]);
  const badge = (
    <Badge tone={live ? "live" : "muted"} dot={false}>
      <CopySwap copied={copied} label={name ?? fallback} done={t("common.copied")} />
    </Badge>
  );
  if (!name) return badge;
  return (
    <Tooltip label={t("common.copyName")}>
      <button
        aria-label={t("common.copyName")}
        className="cursor-pointer rounded-full transition-opacity hover:opacity-80 active:scale-95"
        onClick={() => void navigator.clipboard.writeText(name).then(() => setCopied(true))}
      >
        {badge}
      </button>
    </Tooltip>
  );
}
