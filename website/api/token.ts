// POST /api/token: Radar's Bungie login, the part that needs the client
// secret. The app sends the code from Bungie's login page, or its refresh
// token; this adds Radar's client id and secret (Vercel environment
// variables BUNGIE_CLIENT_ID, BUNGIE_CLIENT_SECRET; never in the app or the
// code) and hands Bungie's answer back as it is. Nothing is stored or logged.

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
  return res.status(answer.status).json(json);
}
