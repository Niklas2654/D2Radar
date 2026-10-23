import { useEffect, useState } from "react";
import { GearPage } from "./components/GearPage";
import { ArtifactView } from "./components/ArtifactView";
import { GuardianView } from "./components/GuardianView";
import type { ArmorDetail } from "./lib/armor";
import { call, hasBackend, subscribe } from "./lib/tauri";
import type { WeaponDetail } from "./lib/weapons";

/** Which page: the kind recognized last. */
type Tab = "weapons" | "armor" | "guardian" | "artifact";

/**
 * The inspect page over the game (its own window, opened with the inspect
 * hotkey): the weapon or armor piece recognized last, on its own page (the
 * weapons tab's, or armor's), with a search for any other. No navbar.
 */
export function InspectWindow() {
  const [tab, setTab] = useState<Tab>("weapons");
  const [weapon, setWeapon] = useState<WeaponDetail | null>(null);
  const [armor, setArmor] = useState<ArmorDetail | null>(null);
  const [guardian, setGuardian] = useState<string | null>(null);
  const [artifact, setArtifact] = useState<string | null>(null);
  // Bumped on every opening: what was recognized opens anew.
  const [opened, setOpened] = useState(0);

  useEffect(() => {
    if (!hasBackend) return;
    const load = () =>
      void call<{
        weapon: WeaponDetail | null;
        armor: ArmorDetail | null;
        guardian: string | null;
        artifact: string | null;
        latest: "gear" | "guardian" | "artifact" | "";
      }>("inspect_last").then((g) => {
        setWeapon(g?.weapon ?? null);
        setArmor(g?.armor ?? null);
        setGuardian(g?.guardian ?? null);
        setArtifact(g?.artifact ?? null);
        // Its page: the kind recognized last.
        setTab(
          g?.latest === "guardian" && g.guardian
            ? "guardian"
            : g?.latest === "artifact" && g.artifact
              ? "artifact"
              : g?.armor
                ? "armor"
                : "weapons",
        );
        setOpened((n) => n + 1);
      });
    load();
    return subscribe("inspect-open", load);
  }, []);

  const close = () => void call("inspect_close");
  useEffect(() => {
    // Closed when Escape is let go, not pressed: closing hands the game the
    // focus, and the game took the release as its own Escape (leaving its
    // inspect screen too).
    let pressed = false;
    const down = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      pressed = true;
    };
    const up = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !pressed) return;
      e.preventDefault();
      pressed = false;
      close();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  return (
    // Around the page: the game, dimmed; a click there closes it. Only the
    // kind recognized: a weapon's page, or armor's.
    // (Only a click on the dim itself: not one inside that bubbles up, not
    // one on a card shown over the page.)
    <div
      className="animate-fade-in fixed inset-0 grid place-items-center bg-black/60 p-[4vh]"
      onClick={(e) => e.target === e.currentTarget && close()}
    >
      <div className="glass h-full max-h-[900px] w-full max-w-[1240px] overflow-hidden">
        {tab === "guardian" && guardian ? (
          <GuardianView key={`g-${opened}`} name={guardian} />
        ) : tab === "artifact" ? (
          <ArtifactView key={`a-${opened}`} initial={artifact} />
        ) : (
          // Weapons and armor in one: what was recognized open, a search
          // for both (by name and source).
          <GearPage
            key={`gear-${opened}`}
            initial={
              tab === "armor" && armor
                ? { kind: "armor", armor }
                : weapon
                  ? { kind: "weapon", weapon }
                  : armor
                    ? { kind: "armor", armor }
                    : null
            }
          />
        )}
      </div>
    </div>
  );
}
