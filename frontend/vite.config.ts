import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { Readable } from "node:stream";
import type { ReadableStream } from "node:stream/web";
import { onRequestGet as previewAudio } from "./functions/api/audio.js";

export default defineConfig({
  plugins: [react(), tailwindcss(), {
    name: "local-preview-audio",
    configureServer(server) {
      // The new function is available locally before the next Pages deployment.
      server.middlewares.use("/api/audio", async (req, res) => {
        try {
          const request = new Request(`http://localhost/api/audio${req.url?.startsWith("?") ? req.url : new URL(req.url ?? "/", "http://localhost").search}`, {
            headers: typeof req.headers.range === "string" ? { range: req.headers.range } : {},
          });
          const response = await previewAudio({ request } as Parameters<typeof previewAudio>[0]);
          res.writeHead(response.status, Object.fromEntries(response.headers));
          if (response.body) Readable.fromWeb(response.body as ReadableStream).pipe(res);
          else res.end();
        } catch { res.writeHead(503); res.end(); }
      });
    },
  }],
  server: {
    // Use the existing Pages Functions locally; secrets remain on the server.
    proxy: { "/api": { target: "https://fm.eduramirez.dev", changeOrigin: true } },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
  },
});
