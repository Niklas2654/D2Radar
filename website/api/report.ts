// POST /api/report: a bug report or feature request from Radar (the feedback
// button in its top bar), made into a public issue in the D2Radar
// repository. The app sends only what the player wrote, which of the two
// it is and the app and Windows version; no name, no log.
// The GitHub token (Vercel environment variable GITHUB_REPORT_TOKEN: a
// fine-grained token with only "Issues: read and write" on that repository)
// never leaves here. The rate limit counts by a salted hash of the address,
// for an hour; nothing else is kept.

const REPO = process.env.GITHUB_REPORT_REPO ?? "Niklas2654/D2Radar";
/** Per kind: the title's start and the label (the app lists issues by them). */
const KINDS = {
  bug: { prefix: "Bug", label: "bug-report" },
  feature: { prefix: "Feature", label: "feature-request" },
} as const;
/** Per address and hour; all together per day (against someone with many addresses). */
const PER_HOUR = 5;
const PER_DAY = 60;

declare const process: { env: Record<string, string | undefined> };

interface Request {
  method?: string;
  body?: unknown;
  headers: Record<string, string | string[] | undefined>;
}

interface Response {
  status(code: number): Response;
  setHeader(name: string, value: string): void;
  json(body: unknown): void;
}

export default async function handler(req: Request, res: Response) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });
  const token = process.env.GITHUB_REPORT_TOKEN;
  if (!token) return res.status(500).json({ error: "server_not_configured" });

  const body = (req.body ?? {}) as Record<string, unknown>;
  const text = str(body.text, 5000).trim();
  if (text.length < 5) return res.status(400).json({ error: "too_short" });
  const version = str(body.version, 40).trim() || "?";
  const os = str(body.os, 80).trim() || "?";
  const kind = KINDS[body.kind === "feature" ? "feature" : "bug"];

  if (!(await allowed(address(req), token))) return res.status(429).json({ error: "too_many" });

  const firstLine = (text.split(/\r?\n/).find((l) => l.trim()) ?? text).trim();
  const title = `${kind.prefix}: ${firstLine.slice(0, 80)}${firstLine.length > 80 ? "…" : ""}`;
  const issueBody = [
    quiet(text),
    "",
    "---",
    `Radar ${quiet(version)} · ${quiet(os)} · _sent from Radar_`,
  ].join("\n");
  let issue = await createIssue(token, { title, body: issueBody, labels: [kind.label] });
  // (A label the token may not set or make: then without it.)
  if (issue.status === 422) issue = await createIssue(token, { title, body: issueBody });
  if (!issue.ok) return res.status(502).json({ error: "github_failed" });
  return res.status(200).json({ ok: true, url: issue.url });
}

function str(value: unknown, max: number): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

/** No @mentions (they would notify people) from what the player wrote. */
function quiet(text: string): string {
  return text.replace(/@/g, "@​");
}

function address(req: Request): string {
  const header = req.headers["x-forwarded-for"] ?? req.headers["x-real-ip"];
  const value = Array.isArray(header) ? header[0] : header;
  return value?.split(",")[0].trim() || "unknown";
}

/** Within the limits (counted when the database is there; without it, yes). */
async function allowed(ip: string, salt: string): Promise<boolean> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}:${ip}`));
  const hash = [...new Uint8Array(digest)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
  const hour = `radar:report:${hash}`;
  const day = `radar:reports:${new Date().toISOString().slice(0, 10)}`;
  const results = await redis([
    ["INCR", hour],
    ["EXPIRE", hour, 3600, "NX"],
    ["INCR", day],
    ["EXPIRE", day, 172800, "NX"],
  ]).catch(() => null);
  if (!results) return true;
  return Number(results[0]) <= PER_HOUR && Number(results[2]) <= PER_DAY;
}

async function createIssue(token: string, issue: unknown): Promise<{ ok: boolean; status: number; url?: string }> {
  const answer = await fetch(`https://api.github.com/repos/${REPO}/issues`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "radar-report",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(issue),
  }).catch(() => null);
  if (!answer) return { ok: false, status: 0 };
  const json = (await answer.json().catch(() => null)) as { html_url?: string } | null;
  return { ok: answer.ok, status: answer.status, url: json?.html_url };
}

// Upstash Redis over its REST API, as in token.ts (each function is
// uploaded on its own, so it's here again).
function config() {
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url, token } : null;
}

async function redis(commands: (string | number)[][]): Promise<unknown[] | null> {
  const c = config();
  if (!c) return null;
  const answer = await fetch(`${c.url}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${c.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(commands),
  }).catch(() => null);
  if (!answer?.ok) return null;
  const results = (await answer.json().catch(() => null)) as { result?: unknown }[] | null;
  return results?.map((r) => r.result ?? null) ?? null;
}
