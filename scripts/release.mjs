// `pnpm release 0.2.0`: a new Radar version, by pull request. Sets the
// version everywhere (tauri.conf.json, package.json, Cargo.toml, Cargo.lock),
// commits it on a branch release/v0.2.0, pushes that and opens the pull
// request's page: its description is the version's release notes (what the
// app shows once after the update, "What's new"). Merging it into master
// starts GitHub Actions (.github/workflows/release.yml: build, release on
// D2Radar with those notes, website).
// `pnpm release 0.2.0 --direct`: without a pull request (and without notes):
// the commit and its tag v0.2.0 straight to the branch checked out.
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const direct = args.includes("--direct");
const version = args.find((a) => !a.startsWith("--"))?.replace(/^v/, "");
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error("Usage: pnpm release <version> [--direct], e.g. pnpm release 0.2.0");
  process.exit(1);
}
const run = (cmd) => execSync(cmd, { stdio: "inherit" });
const read = (cmd) => execSync(cmd).toString().trim();

if (read("git status --porcelain")) {
  console.error("Commit or stash your changes first: the release commit should hold only the version.");
  process.exit(1);
}
const base = read("git rev-parse --abbrev-ref HEAD");
const branch = `release/v${version}`;
if (!direct) {
  if (base !== "master") {
    console.error(`A release starts from master (this is ${base}).`);
    process.exit(1);
  }
  // What the pull request brings into master: all of it pushed first.
  run("git push origin master");
  run(`git switch -c ${branch}`);
}

const edit = (path, from, to) => {
  const text = readFileSync(path, "utf8");
  const next = text.replace(from, to);
  if (next === text) throw new Error(`No version found in ${path}`);
  writeFileSync(path, next);
};
edit("src-tauri/tauri.conf.json", /("version": ")[^"]+(")/, `$1${version}$2`);
edit("package.json", /("version": ")[^"]+(")/, `$1${version}$2`);
edit("src-tauri/Cargo.toml", /^(version = ")[^"]+(")/m, `$1${version}$2`);
edit("src-tauri/Cargo.lock", /(name = "radar"\r?\nversion = ")[^"]+(")/, `$1${version}$2`);

run("git add src-tauri/tauri.conf.json package.json src-tauri/Cargo.toml src-tauri/Cargo.lock");
run(`git commit -m "Release v${version}"`);

if (direct) {
  run(`git tag -a v${version} -m "Radar ${version}"`);
  run("git push origin HEAD --follow-tags");
  console.log(`\nv${version} pushed: GitHub Actions builds and publishes it now.`);
} else {
  run(`git push -u origin ${branch}`);
  run(`git switch ${base}`);
  // The pull request's page, its title set and the notes begun.
  const repo = read("git remote get-url origin")
    .replace(/^git@github\.com:/, "https://github.com/")
    .replace(/\.git$/, "");
  const notes = "## New\n- \n\n## Improved\n- \n\n## Fixed\n- \n";
  const url =
    `${repo}/compare/${base}...${branch}?expand=1` +
    `&title=${encodeURIComponent(`Release v${version}`)}&body=${encodeURIComponent(notes)}`;
  try {
    if (process.platform === "win32") execSync(`start "" "${url}"`, { shell: "cmd.exe", stdio: "ignore" });
  } catch {
    // No browser opened: the address below does.
  }
  console.log(`\nv${version} is on ${branch}. Open the pull request:\n\n  ${url}\n`);
  console.log("Write the release notes as its description (they show in the app as \"What's new\"),");
  console.log("then merge it: GitHub Actions builds and publishes the version. Afterwards: git pull");
}
