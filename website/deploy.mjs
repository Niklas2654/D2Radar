// Builds the site and uploads dist/ to Vercel as plain static files (the
// build needs the app one level up, so it runs here, not on Vercel).
// vercel.json and the project link (.vercel, made by the first deploy) live
// in website/ and are copied into dist/, which every build empties.
import { execSync } from "node:child_process";
import { cpSync, existsSync } from "node:fs";

const run = (cmd) => execSync(cmd, { stdio: "inherit" });

run("pnpm build");
cpSync("vercel.json", "dist/vercel.json");
// The server part: /api/token (Radar's Bungie login).
cpSync("api", "dist/api", { recursive: true });
if (existsSync(".vercel")) cpSync(".vercel", "dist/.vercel", { recursive: true });
run("npx --yes vercel deploy dist --prod --archive=tgz");
// The first deploy links the project inside dist/: keep that link.
if (existsSync("dist/.vercel")) cpSync("dist/.vercel", ".vercel", { recursive: true });
