// GET /api/stats: how many use Radar with their Bungie account, as counted
// by /api/token (see count() there): guardians (different accounts ever
// connected), activeMonth (different accounts in the last 30 days: the
// days' estimates merged), activeToday (UTC) and logins (all time). Kept at
// Vercel's edge for two minutes.

declare const process: { env: Record<string, string | undefined> };

interface Request {
  method?: string;
}

interface Response {
  status(code: number): Response;
  setHeader(name: string, value: string): void;
  json(body: unknown): void;
}

export default async function handler(req: Request, res: Response) {
  if (req.method !== "GET") return res.status(405).json({ error: "method_not_allowed" });
  const day = today();
  const month = Array.from({ length: 30 }, (_, i) => `radar:users:${new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10)}`);
  const results = await redis([
    ["PFCOUNT", "radar:users"],
    ["PFCOUNT", `radar:users:${day}`],
    ["GET", "radar:logins"],
    ["PFCOUNT", ...month],
  ]);
  if (!results) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(503).json({ error: "stats_unavailable" });
  }
  const [guardians, activeToday, logins, activeMonth] = results.map((r) => Number(r ?? 0));
  res.setHeader("Cache-Control", "public, s-maxage=120, stale-while-revalidate=600");
  return res.status(200).json({ guardians, activeMonth, activeToday, logins });
}

// Upstash Redis (Vercel Marketplace) over its REST API, no package needed:
// Vercel sets KV_REST_API_URL / KV_REST_API_TOKEN (or UPSTASH_REDIS_*) when
// the database is connected. Without them nothing is counted, nothing breaks.
// (The same in token.ts and stats.ts: each function is uploaded on its own.)
function config() {
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url, token } : null;
}

/** Several commands in one request; their results in order (null: no database or it failed). */
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

/** "2026-10-26" (UTC): the key of a day's counts. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}
