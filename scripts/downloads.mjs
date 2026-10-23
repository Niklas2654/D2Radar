// `pnpm downloads`: how often Radar was downloaded, from the public D2Radar
// repo's releases (GitHub counts every file, but shows the counts nowhere).
//  - website: Radar-setup.exe, the website's download button
//  - updates: the versioned installer, which the app's updater fetches (and
//    whoever downloads it from the release page)
//  - checks:  latest.json, read by every running Radar at start and every
//    six hours (a rough idea of how many are in use)
const REPO = "Niklas2654/D2Radar";

const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=100`, {
  headers: { Accept: "application/vnd.github+json" },
});
if (!res.ok) {
  console.error(`GitHub: ${res.status} ${res.statusText}`);
  process.exit(1);
}
const releases = await res.json();

const rows = releases.map((r) => {
  const count = (test) => r.assets.filter((a) => test(a.name)).reduce((sum, a) => sum + a.download_count, 0);
  return {
    version: r.tag_name,
    website: count((n) => n === "Radar-setup.exe"),
    updates: count((n) => /^Radar_.*-setup\.exe$/.test(n)),
    checks: count((n) => n === "latest.json"),
  };
});

const total = rows.reduce((t, r) => ({ website: t.website + r.website, updates: t.updates + r.updates, checks: t.checks + r.checks }), {
  website: 0,
  updates: 0,
  checks: 0,
});

console.table([...rows, { version: "total", ...total }]);
console.log(`\nDownloads (website + updates): ${total.website + total.updates}`);
