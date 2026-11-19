/** Recording for the website's demo (not in released builds): with
 *  `VITE_DEMO_RECORD=1 pnpm tauri dev`, every command the app asks and its
 *  answer (and the events it hears) is sent to the dev server, which writes
 *  them to demo-recording/calls.ndjson (vite.config.ts). The demo's data
 *  (public/demo/data.json) is made from that, the player's name replaced. */

let count = 0;
let badge: HTMLDivElement | null = null;
/** Lines waiting to be sent (one request at a time, so they stay in order). */
const queue: string[] = [];
let sending = false;
/** Events heard, per name: a few of each are enough. */
const heard = new Map<string, number>();

function show() {
  if (!badge) {
    badge = document.createElement("div");
    badge.style.cssText =
      "position:fixed;left:12px;bottom:12px;z-index:2147483647;pointer-events:none;padding:4px 10px;border-radius:8px;background:#b3261e;color:#fff;font:600 12px/1.4 system-ui";
    document.body.appendChild(badge);
  }
  badge.textContent = `● REC ${count}`;
}

async function flush() {
  if (sending) return;
  sending = true;
  while (queue.length) {
    const lines = queue.splice(0, queue.length).join("\n");
    try {
      await fetch("/__demo-record", { method: "POST", body: lines });
    } catch {
      // The dev server is gone: nothing to record to.
    }
  }
  sending = false;
}

function send(entry: Record<string, unknown>) {
  let line: string;
  try {
    line = JSON.stringify(entry);
  } catch {
    return;
  }
  queue.push(line);
  count++;
  show();
  void flush();
}

/** A command and its answer. */
export function note(cmd: string, args: unknown, result: unknown) {
  send({ cmd, args: args ?? {}, result: result ?? null, page: location.pathname });
}

/** An event the app heard. */
export function noteEvent(event: string, payload: unknown) {
  const n = heard.get(event) ?? 0;
  if (n >= 5) return;
  heard.set(event, n + 1);
  send({ event, payload: payload ?? null, page: location.pathname });
}
