import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { appendFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";

/** Recording for the website's demo (src/web/record.ts): the dev server
 *  writes what the app sends to demo-recording/calls.ndjson (not in git:
 *  it's the account as it is, the name not yet replaced). */
function demoRecorder(): Plugin {
  const dir = resolve(__dirname, "demo-recording");
  return {
    name: "radar-demo-recorder",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__demo-record", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          return res.end();
        }
        const parts: Buffer[] = [];
        req.on("data", (c: Buffer) => parts.push(c));
        req.on("end", () => {
          mkdirSync(dir, { recursive: true });
          appendFileSync(resolve(dir, "calls.ndjson"), Buffer.concat(parts).toString("utf8") + "\n");
          res.statusCode = 204;
          res.end();
        });
      });
    },
  };
}

// Two entry points: the control window (index.html) and the transparent
// in-game overlay (overlay.html).
export default defineConfig({
  plugins: [react(), tailwindcss(), demoRecorder()],
  clearScreen: false,
  server: {
    port: 1430,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**", "**/demo-recording/**"] },
  },
  build: {
    target: "es2022",
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        overlay: resolve(__dirname, "overlay.html"),
      },
    },
  },
});
