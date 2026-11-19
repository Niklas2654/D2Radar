import { useSyncExternalStore } from "react";

/** Something Radar is doing in game that takes a while (equipping a
 *  loadout, writing a preset's loadouts onto their slots): shown in the
 *  task panel on every page until it's done. */
export interface Task {
  id: number;
  title: string;
  /** What it does right now ("Setting Threaded Spike (3/23) …"). */
  step: string;
  /** Parts done of all (a preset: its loadouts); null: one part. */
  part: { done: number; of: number } | null;
  /** Within the part: plugs set of all ("(3/23)" in the step). */
  inner: { done: number; of: number } | null;
  started: number;
  state: "running" | "done" | "error";
  /** Warnings or the error, once done. */
  note?: string;
}

let tasks: Task[] = [];
let next = 1;
const listeners = new Set<() => void>();
const emit = () => {
  tasks = [...tasks];
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

/** The tasks, newest first. */
export function useTasks(): Task[] {
  return useSyncExternalStore(subscribe, () => tasks);
}

/** A step's "(n/m)": how far a loadout's plugs are. */
function innerOf(step: string): Task["inner"] {
  const m = /\((\d+)\/(\d+)\)/.exec(step);
  return m ? { done: Number(m[1]), of: Number(m[2]) } : null;
}

export function startTask(title: string, parts: number | null = null, step = ""): number {
  const id = next++;
  tasks = [{ id, title, step, part: parts ? { done: 0, of: parts } : null, inner: null, started: Date.now(), state: "running" as const }, ...tasks];
  emit();
  return id;
}

export function stepTask(id: number, step: string, partDone?: number) {
  const t = tasks.find((x) => x.id === id);
  if (!t || t.state !== "running" || !step) return;
  t.step = step;
  t.inner = innerOf(step) ?? (partDone !== undefined ? null : t.inner);
  if (partDone !== undefined && t.part) t.part = { ...t.part, done: partDone };
  emit();
}

/** Done (or failed): shown a while, then gone (an error stays until closed). */
export function finishTask(id: number, ok: boolean, note?: string) {
  const t = tasks.find((x) => x.id === id);
  if (!t) return;
  t.state = ok ? "done" : "error";
  t.note = note;
  if (t.part) t.part = { ...t.part, done: t.part.of };
  t.inner = null;
  emit();
  if (ok) window.setTimeout(() => dismissTask(id), note ? 12_000 : 5_000);
}

export function dismissTask(id: number) {
  tasks = tasks.filter((t) => t.id !== id);
  emit();
}

/** How far it is (0..1): its parts, and within the current one its plugs. */
export function progressOf(t: Task): number {
  if (t.state !== "running") return 1;
  const inner = t.inner ? t.inner.done / Math.max(1, t.inner.of) : 0;
  if (!t.part) return inner;
  return Math.min(1, (t.part.done + inner) / Math.max(1, t.part.of));
}
