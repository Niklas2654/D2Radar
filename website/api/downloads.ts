// GET /api/downloads: how often Radar was downloaded, for the website (as
// `pnpm downloads` counts it): the website's installer plus the versioned
// ones the app's updater fetches, over every release of the public D2Radar
// repo. Kept at Vercel's edge for two minutes, so GitHub is asked rarely
// (60 times an hour at most without a token; GITHUB_TOKEN, if set, allows
// more).

const RELEASES = "https://api.github.com/repos/Niklas2654/D2Radar/releases?per_page=100";

declare const process: { env: Record<string, string | undefined> };

interface Request {
  method?: string;
}

interface Response {
  status(code: number): Response;
  setHeader(name: string, value: string): void;
  json(body: unknown): void;
}

interface Release {
  assets: { name: string; download_count: number }[];
}

export default async function handler(req: Request, res: Response) {
  if (req.method !== "GET") return res.status(405).json({ error: "method_not_allowed" });
  const headers: Record<string, string> = { Accept: "application/vnd.github+json", "User-Agent": "radar-website" };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const answer = await fetch(RELEASES, { headers }).catch(() => null);
  if (!answer?.ok) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(502).json({ error: "github_unavailable" });
  }
  const releases = (await answer.json()) as Release[];
  const downloads = releases
    .flatMap((r) => r.assets)
    .filter((a) => a.name === "Radar-setup.exe" || /^Radar_.*-setup\.exe$/.test(a.name))
    .reduce((sum, a) => sum + a.download_count, 0);
  res.setHeader("Cache-Control", "public, s-maxage=120, stale-while-revalidate=600");
  return res.status(200).json({ downloads });
}
