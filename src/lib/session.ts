import { useEffect, useState } from "react";
import { call, hasBackend, isTauri } from "./tauri";

export interface TeamPlayer {
  membershipId: string;
  displayName: string;
  className: string | null;
  light: number | null;
  emblemPath: string | null;
  completed: boolean;
}

export interface SessionActivity {
  instanceId: string;
  name: string | null;
  endedAt: number;
  players: TeamPlayer[];
}

const MOCK: SessionActivity[] = [
  {
    instanceId: "1",
    name: "Die Korrumpierte",
    endedAt: Date.now() - 4 * 60_000,
    players: [
      { membershipId: "4611686018000000001", displayName: "Wayfarer#1111", className: "Warlock", light: 511, emblemPath: null, completed: true },
      { membershipId: "4611686018000000002", displayName: "Ghost#2222", className: "Jäger", light: 550, emblemPath: null, completed: true },
    ],
  },
  {
    instanceId: "2",
    name: "Der Wahrsager",
    endedAt: Date.now() - 51 * 60_000,
    players: [
      { membershipId: "4611686018000000003", displayName: "Vanguard#3333", className: "Jäger", light: 548, emblemPath: null, completed: false },
    ],
  },
];

/**
 * Players from this session's activities. Reloads whenever `revision`
 * changes (pass the snapshot's update time, so new activities show up);
 * reports are cached on the Rust side, so that's cheap.
 */
export function useSessionTeam(revision: number | null): SessionActivity[] {
  const [team, setTeam] = useState<SessionActivity[]>(() =>
    !isTauri && location.search.includes("mock") ? MOCK : [],
  );
  useEffect(() => {
    if (!hasBackend) return;
    let cancelled = false;
    void call<SessionActivity[]>("session_team")
      .then((t) => !cancelled && t && setTeam(t))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [revision]);
  return team;
}
