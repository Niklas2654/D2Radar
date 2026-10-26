// POST /api/token: Radar's Bungie login, the part that needs the client
// secret. The app sends the code from Bungie's login page, or its refresh
// token; this adds Radar's client id and secret (Vercel environment
// variables BUNGIE_CLIENT_ID, BUNGIE_CLIENT_SECRET; never in the app or the
// code) and hands Bungie's answer back as it is. No token is stored or
// logged; what is counted (see count()): logins, and how many different
// accounts (ever and per day), by a salted hash of their id in a HyperLogLog (it
// keeps no ids or hashes, only an estimate of how many).


const TOKEN_URL = "https://www.bungie.net/platform/app/oauth/token/";

declare const process: { env: Record<string, string | undefined> };

interface Request {
  method?: string;
  body?: unknown;
}

interface Response {
  status(code: number): Response;
  setHeader(name: string, value: string): void;
  json(body: unknown): void;
}

export default async function handler(req: Request, res: Response) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  const id = process.env.BUNGIE_CLIENT_ID;
  const secret = process.env.BUNGIE_CLIENT_SECRET;
  if (!id || !secret) return res.status(500).json({ error: "server_not_configured" });

  // Only the two exchanges a login needs, with what each needs.
  const body = (req.body ?? {}) as Record<string, unknown>;
  const form = new URLSearchParams();
  if (body.grant_type === "authorization_code" && typeof body.code === "string" && body.code) {
    form.set("grant_type", "authorization_code");
    form.set("code", body.code);
  } else if (body.grant_type === "refresh_token" && typeof body.refresh_token === "string" && body.refresh_token) {
    form.set("grant_type", "refresh_token");
    form.set("refresh_token", body.refresh_token);
  } else {
    return res.status(400).json({ error: "invalid_request" });
  }

  const answer = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${id}:${secret}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form,
  }).catch(() => null);
  if (!answer) return res.status(502).json({ error: "bungie_unreachable" });
  const json = await answer.json().catch(() => ({ error: "bungie_bad_answer" }));
  // (Not when the player turned it off in Radar: Settings → Privacy.)
  if (answer.ok && body.count !== false) await count(form.get("grant_type") === "authorization_code", json, secret);
  return res.status(answer.status).json(json);
}

/** The account among the ones seen ever and today (a refresh: Radar in
 *  use), and a login counted. As few commands as can be (the free database
 *  counts each): a refresh 2, a login 3. A day's estimate is 12 KB at most,
 *  kept (years of them fit). Never in the way of the login. */
async function count(login: boolean, answer: unknown, salt: string) {
  const id = (answer as { membership_id?: unknown })?.membership_id;
  const commands: (string | number)[][] = login ? [["INCR", "radar:logins"]] : [];
  if (typeof id === "string" && id) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}:${id}`));
    const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
    commands.push(["PFADD", "radar:users", hash], ["PFADD", `radar:users:${today()}`, hash]);
  }
  if (commands.length) await redis(commands).catch(() => null);
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
