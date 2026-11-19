import { useEffect, useState } from "react";
import { useT } from "../lib/i18n";
import { dismissTask, progressOf, useTasks, type Task } from "../lib/tasks";
import { cx } from "./glass";

/** "1:05" / "12 s". */
function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : `${s} s`;
}

/**
 * What Radar is doing in game right now (equipping, writing a preset's
 * loadouts): bottom right on every page, so items changing while you look
 * elsewhere have a reason, with how far it is and about how long it takes
 * yet (from the time so far). Folds to a chip.
 */
export function TaskPanel() {
  const t = useT();
  const tasks = useTasks();
  const [folded, setFolded] = useState(false);
  // A clock for the times (only while something runs).
  const running = tasks.some((x) => x.state === "running");
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [running]);
  if (tasks.length === 0) return null;
  if (folded) {
    return (
      <button
        type="button"
        onClick={() => setFolded(false)}
        className="animate-fade-in fixed right-5 bottom-5 z-[140] flex items-center gap-2 rounded-full border border-(--accent-glow) bg-[#0b0d14]/95 px-3.5 py-2 text-[12.5px] font-medium text-white shadow-[0_14px_36px_-12px_rgb(0_0_0/0.9)]"
      >
        {running && <span className="size-3 animate-spin rounded-full border-2 border-white/20 border-t-(--accent)" />}
        {t("tasks.count", { n: tasks.length })}
      </button>
    );
  }
  return (
    <div className="animate-fade-in fixed right-5 bottom-5 z-[140] w-[340px] rounded-2xl border border-white/10 bg-[#0b0d14]/95 p-3 shadow-[0_18px_44px_-12px_rgb(0_0_0/0.95)]">
      <div className="mb-2 flex items-center justify-between px-1">
        <span className="text-[10.5px] font-semibold tracking-[0.14em] text-white/45 uppercase">{t("tasks.title")}</span>
        <button
          type="button"
          onClick={() => setFolded(true)}
          className="rounded-md px-1.5 py-0.5 text-[11px] text-white/45 hover:bg-white/[0.08] hover:text-white"
        >
          {t("tasks.fold")}
        </button>
      </div>
      <div className="flex max-h-72 flex-col gap-2 overflow-y-auto">
        {tasks.map((task) => (
          <TaskRow key={task.id} task={task} now={now} />
        ))}
      </div>
    </div>
  );
}

function TaskRow({ task, now }: { task: Task; now: number }) {
  const t = useT();
  const p = progressOf(task);
  const elapsed = now - task.started;
  // Time left: as long per part of the way as so far (once a bit is done).
  const left = task.state === "running" && p > 0.05 ? (elapsed / p) * (1 - p) : null;
  return (
    <div
      className={cx(
        "rounded-xl border px-3 py-2.5",
        task.state === "error"
          ? "border-red-400/30 bg-red-500/[0.07]"
          : task.state === "done"
            ? "border-emerald-400/25 bg-emerald-400/[0.06]"
            : "border-white/[0.07] bg-white/[0.03]",
      )}
    >
      <div className="flex items-center gap-2">
        {task.state === "running" ? (
          <span className="size-3 shrink-0 animate-spin rounded-full border-2 border-white/20 border-t-(--accent)" />
        ) : (
          <span className={cx("text-[12px]", task.state === "done" ? "text-emerald-300" : "text-red-300")}>
            {task.state === "done" ? "✓" : "!"}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-white/90">{task.title}</span>
        {task.part && <span className="shrink-0 text-[11px] text-white/45 tabular-nums">{`${task.part.done}/${task.part.of}`}</span>}
        {task.state !== "running" && (
          <button
            type="button"
            onClick={() => dismissTask(task.id)}
            aria-label={t("tasks.dismiss")}
            className="shrink-0 rounded px-1 text-[12px] text-white/40 hover:text-white"
          >
            ×
          </button>
        )}
      </div>
      {task.state === "running" && (
        <>
          <p className="mt-1 truncate text-[11.5px] text-white/55">{task.step}</p>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/[0.08]">
            <div className="h-full rounded-full bg-(--accent) transition-[width] duration-500" style={{ width: `${Math.max(4, p * 100)}%` }} />
          </div>
          <div className="mt-1 flex justify-between text-[10.5px] text-white/40 tabular-nums">
            <span>{t("tasks.elapsed", { time: duration(elapsed) })}</span>
            {left !== null && <span>{t("tasks.left", { time: duration(left) })}</span>}
          </div>
        </>
      )}
      {task.state !== "running" && task.note && <p className="mt-1 line-clamp-3 text-[11.5px] text-white/55">{task.note}</p>}
    </div>
  );
}
