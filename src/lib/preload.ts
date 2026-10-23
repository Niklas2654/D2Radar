import { loadPlayer } from "./fireteam";
import { loadFullClears } from "./fullclears";
import { loadouts } from "./loadouts";
import { call, isTauri } from "./tauri";
import { loadoutSets } from "./presets";

/** One step of loading everything at start, for the loading screen. */
export interface PreloadStep {
  id: string;
  /** i18n key of its label. */
  label: string;
  state: "waiting" | "running" | "done" | "skipped";
  /** "3 / 12" while it runs through a list. */
  detail?: string;
}

/** How many loadouts are described per request (one after the other). */
const DETAILS_BATCH = 4;

type Report = (steps: PreloadStep[]) => void;

/**
 * Load what the tabs show, once at start, so they open ready: the
 * characters, all DIM loadouts with their details (items, mods, checks),
 * the in-game loadouts, the presets and the artifact; DIM and Discord load
 * in their hidden webviews. Steps that can't run (not logged in, DIM not
 * connected) are skipped. The Rust side keeps the results in its caches.
 */
/** How long the loading screen waits for DIM and Discord at most. */
const WEBVIEWS_MAX_MS = 40_000;

/** Wait until the embedded pages asked for have loaded. */
async function webviewsLoaded(withDim: boolean, withDiscord: boolean): Promise<void> {
  if (!isTauri) return;
  const until = Date.now() + WEBVIEWS_MAX_MS;
  while (Date.now() < until) {
    const ready = await call<{ dim: boolean; discord: boolean }>("webviews_ready").catch(() => null);
    if (ready && (ready.discord || !withDiscord) && (ready.dim || !withDim)) return;
    await new Promise((r) => setTimeout(r, 400));
  }
}

/**
 * `quick` (the loading screen): the slow parts, loadout details and
 * Discord, go on in the background instead of being waited for.
 */
export async function preloadAll(
  report: Report,
  startWebviews: () => boolean | void,
  fresh = false,
  quick = false,
): Promise<void> {
  const withDim = startWebviews() === true;
  const steps: PreloadStep[] = [
    { id: "characters", label: "preload.characters", state: "waiting" },
    { id: "loadouts", label: "preload.loadouts", state: "waiting" },
    { id: "details", label: "preload.details", state: "waiting" },
    { id: "game", label: "preload.game", state: "waiting" },
    { id: "artifact", label: "preload.artifact", state: "waiting" },
    { id: "usage", label: "preload.usage", state: "waiting" },
    { id: "fireteam", label: "preload.fireteam", state: "waiting" },
    { id: "webviews", label: quick ? "preload.dim" : "preload.webviews", state: "waiting" },
  ].filter((s) => !quick || (s.id !== "details" && (s.id !== "webviews" || withDim))) as PreloadStep[];
  const set = (id: string, patch: Partial<PreloadStep>) => {
    const step = steps.find((s) => s.id === id);
    if (!step) return; // not shown (in the background)
    Object.assign(step, patch);
    report(steps.map((s) => ({ ...s })));
  };
  const run = async <T>(id: string, task: () => Promise<T>): Promise<T | undefined> => {
    set(id, { state: "running" });
    try {
      const result = await task();
      set(id, { state: "done" });
      return result;
    } catch {
      set(id, { state: "skipped" });
      return undefined;
    }
  };

  // DIM and Discord load alongside; the step is done once their pages are
  // (only DIM's for the loading screen: Discord takes long).
  set("webviews", { state: "running" });
  const webviews = webviewsLoaded(withDim, !quick);

  // Most used weapons (their reports), alongside the rest.
  const usage = run("usage", async () => {
    if (!isTauri) return;
    await call("weapon_usage");
  });
  // The fireteam tab: the player, their fireteam and the players looked up
  // before (profiles and full clears).
  const fireteam = run("fireteam", async () => {
    if (!isTauri) return;
    const snapshot = await call<{ player: { membershipId: string } | null; party: { membershipId: string }[] }>(
      "bungie_snapshot",
    );
    let searched: { id: string }[] = [];
    try {
      searched = JSON.parse(localStorage.getItem("radar.searchedPlayers") ?? "[]");
    } catch {
      // No list kept.
    }
    const ids = [
      ...new Set([
        snapshot?.player?.membershipId,
        ...(snapshot?.party ?? []).map((m) => m.membershipId),
        ...searched.map((s) => s.id),
      ]),
    ].filter((id): id is string => !!id);
    // The player's own profile is waited for; the others and the full
    // clears (every raid's report the first time) load in the background.
    const own = snapshot?.player?.membershipId;
    ids.filter((id) => id !== own).forEach((id) => void loadPlayer(id));
    ids.forEach(loadFullClears);
    if (own) await loadPlayer(own);
  });
  const characters = await run("characters", () => loadouts.characters());
  // The character the loadouts tab opens with (the first one).
  const character = characters?.[0]?.id ?? null;
  if (!character) {
    for (const id of ["loadouts", "details", "game", "artifact"]) set(id, { state: "skipped" });
  } else {
    const [list] = await Promise.all([
      run("loadouts", async () => {
        const status = await loadouts.dimStatus();
        if (!status.connected) throw new Error("DIM not connected");
        return loadouts.list(character, fresh);
      }),
      run("game", () => Promise.all([loadouts.game(character), loadoutSets.list()])),
      run("artifact", () => loadouts.artifactLayout()),
    ]);
    if (!list) {
      set("details", { state: "skipped" });
    } else {
      // The class's own loadouts first: those the tab shows.
      const ids = list.loadouts
        .filter((l) => l.classType === list.classType || l.classType === 3)
        .concat(list.loadouts.filter((l) => l.classType !== list.classType && l.classType !== 3))
        .map((l) => l.id);
      const details = run("details", async () => {
        for (let i = 0; i < ids.length; i += DETAILS_BATCH) {
          set("details", { state: "running", detail: `${Math.min(i + DETAILS_BATCH, ids.length)} / ${ids.length}` });
          await loadouts.details(character, ids.slice(i, i + DETAILS_BATCH));
        }
      });
      // Quick: the details go on after the loading screen.
      if (!quick) await details;
    }
  }
  // Quick (the loading screen): the weapon usage goes on behind it, only
  // the weapons tab shows it.
  if (!quick) await usage;
  await fireteam;
  await webviews;
  set("webviews", { state: "done" });
}

/** How often the data is refreshed in the background: often while Radar is
 *  in front (its numbers on screen), rarely otherwise. */
const REFRESH_FOCUSED_MS = 30_000;
const REFRESH_BACKGROUND_MS = 5 * 60_000;

/** Fired after a background refresh. */
export const REFRESHED_EVENT = "radar:data-refreshed";

/** Keep the preloaded data fresh (after the first load); returns a stop. */
export function keepFresh(): () => void {
  let timer = 0;
  let last = Date.now();
  let running = false;
  const tick = async () => {
    const due = document.hasFocus() ? REFRESH_FOCUSED_MS : REFRESH_BACKGROUND_MS;
    if (!running && Date.now() - last >= due) {
      running = true;
      try {
        await preloadAll(() => {}, () => {}, true);
        // Open tabs pick up the new data (from the warm caches).
        window.dispatchEvent(new Event(REFRESHED_EVENT));
      } finally {
        running = false;
        last = Date.now();
      }
    }
    timer = window.setTimeout(() => void tick(), 5_000);
  };
  timer = window.setTimeout(() => void tick(), 5_000);
  return () => window.clearTimeout(timer);
}
