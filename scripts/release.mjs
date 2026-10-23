// `pnpm release 0.2.0`: a new Radar version. Sets the version everywhere
// (tauri.conf.json, package.json, Cargo.toml, Cargo.lock), commits it, tags
// it v0.2.0 and pushes both; GitHub Actions does the rest
// (.github/workflows/release.yml: build, release on D2Radar, website).
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const version = process.argv[2]?.replace(/^v/, "");
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error("Usage: pnpm release <version>, e.g. pnpm release 0.2.0");
  process.exit(1);
}
const run = (cmd) => execSync(cmd, { stdio: "inherit" });

if (execSync("git status --porcelain").toString().trim()) {
  console.error("Commit or stash your changes first: the release commit should hold only the version.");
  process.exit(1);
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
run(`git tag -a v${version} -m "Radar ${version}"`);
run("git push origin HEAD --follow-tags");
console.log(`\nv${version} pushed: GitHub Actions builds and publishes it now.`);
