import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { createReadStream, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { defineConfig, type Plugin } from "vite";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".webp": "image/webp",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

/** The app's web build (public/app, rebuilt with `pnpm build:app`) read
 *  from disk on each request while developing: Vite keeps a list of the
 *  public files and missed the new ones after a rebuild (404s). */
function freshApp(): Plugin {
  const root = join(__dirname, "public", "app");
  return {
    name: "radar-fresh-app",
    configureServer(server) {
      server.middlewares.use("/app", (req, res, next) => {
        const path = normalize(join(root, decodeURIComponent((req.url ?? "/").split("?")[0])));
        if (!path.startsWith(root)) return next();
        try {
          if (!statSync(path).isFile()) return next();
        } catch {
          return next();
        }
        res.setHeader("Content-Type", TYPES[extname(path)] ?? "application/octet-stream");
        res.setHeader("Cache-Control", "no-cache");
        createReadStream(path).pipe(res);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), freshApp()],
  server: { port: 1440, strictPort: true },
});
