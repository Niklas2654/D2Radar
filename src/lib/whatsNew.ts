import { getVersion } from "@tauri-apps/api/app";
import { getSettings } from "./settings";
import { isTauri } from "./tauri";

/** What a version brought: its release notes (Markdown). */
export interface Release {
  version: string;
  notes: string;
}

/** Shown once after an update: every version since the one used before,
 *  newest first. `version`: the one running now. */
export interface WhatsNew {
  version: string;
  releases: Release[];
}

// The version whose notes were last shown (or, at the first start, the one
// installed: nothing is new then).
const SEEN = "radar.seenVersion";
// The public repo's releases: their text is each version's notes (the pull
// request's description, see .github/workflows/release.yml).
const RELEASES = "https://api.github.com/repos/Niklas2654/D2Radar/releases";
// A release without notes of its own carries this line only.
const STOCK = "Radar updates itself from here";

const read = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

// Radar was here before (read now, at the very start: a first start saves
// its settings a moment later).
const usedBefore = read("radar.settings") !== null;

const preview = import.meta.env.DEV && new URLSearchParams(location.search).has("whatsnew-preview");

const SAMPLE: Release[] = [
  {
    version: "1.6.0",
    notes: `## New
- **Loadouts** take gear off your other characters and make room in a full inventory or vault
- Aspects and fragments land in exactly the sockets the loadout shows

## Fixed
- Discord: the emoji button is visible again
- See the [website](https://d2radar.vercel.app) for more, or type \`/radar\``,
  },
  {
    version: "1.5.0",
    notes: `## New
- The armor optimizer keeps the pieces you pinned

## Fixed
- The overlay comes back after Alt+Tab`,
  },
];

/** "1.4.0" → [1, 4, 0]; null for anything else (the game-data release …). */
const parse = (version: string) => {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
};
const compare = (a: number[], b: number[]) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

const hasNotes = (notes: string) => !!notes && !notes.includes(STOCK);

/** The notes of every version since the one used before (after it, up to
 *  the one running), if Radar was just updated (and they weren't shown
 *  yet); null otherwise, and whenever they can't be had. Versions without
 *  notes of their own are left out. */
export async function loadWhatsNew(): Promise<WhatsNew | null> {
  if (preview) return { version: SAMPLE[0].version, releases: SAMPLE };
  if (!isTauri) return null;
  const version = await getVersion();
  const seen = read(SEEN);
  if (seen === version) return null;
  // Just installed: nothing to tell.
  if (seen === null && !usedBefore) {
    markSeen(version);
    return null;
  }
  const now = parse(version);
  // A build of one's own (no such version): nothing to ask for.
  if (!now) {
    markSeen(version);
    return null;
  }
  // Updated from a version that didn't keep this yet: only the one running.
  const before = (seen !== null && parse(seen)) || now.map((n, i) => (i === 2 ? n - 1 : n));
  // Asking GitHub counts as looking for updates (Settings → Privacy).
  if (!getSettings().updateChecks) return null;
  try {
    const response = await fetch(`${RELEASES}?per_page=50`, { headers: { Accept: "application/vnd.github+json" } });
    if (!response.ok) return null;
    const list = (await response.json()) as { tag_name?: string; body?: string | null; draft?: boolean }[];
    const releases = list
      .map((r) => ({ at: parse(r.tag_name ?? ""), version: (r.tag_name ?? "").replace(/^v/, ""), notes: String(r.body ?? "").trim(), draft: r.draft }))
      .filter((r): r is typeof r & { at: number[] } => !!r.at && !r.draft)
      .filter((r) => compare(r.at, before) > 0 && compare(r.at, now) <= 0 && hasNotes(r.notes))
      .sort((a, b) => compare(b.at, a.at))
      .map(({ version, notes }) => ({ version, notes }));
    if (!releases.length) {
      markSeen(version);
      return null;
    }
    return { version, releases };
  } catch {
    // Offline: the next start tries again.
    return null;
  }
}

/** Closed by the user: this version's notes don't come back. */
export function markSeen(version: string) {
  if (preview) return;
  try {
    localStorage.setItem(SEEN, version);
  } catch {
    // Storage blocked: shown again next time.
  }
}
