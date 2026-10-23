import { GearPage } from "../components/GearPage";
import { useDetectedWeapon } from "../lib/weapons";

/**
 * The app's arsenal tab: weapons and armor in one search (by name and by
 * source), as the inspect page over the game has it; with nothing open,
 * the weapons played most. A weapon recognized in game opens here too.
 */
export function ArsenalPage() {
  const detected = useDetectedWeapon();
  return (
    <GearPage key={detected?.hash ?? "none"} initial={detected ? { kind: "weapon", weapon: detected } : null} usage />
  );
}
