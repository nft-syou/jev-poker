/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
// Explicit `.ts` extensions: Vite's native config loader rejects extensionless source imports.
import { handleJevProxy } from "./src/proxy/handler.ts";
import {
  PayloadTooLargeError,
  payloadTooLargeResponse,
  toWebRequest,
  writeWebResponse,
} from "./src/proxy/node-adapter.ts";

/**
 * `pnpm dev` serves `/api/jev/*` with the same handler the Cloudflare Pages Function runs,
 * so every route (typesafe, vercel, lolipop, cloudflare) behaves locally exactly as in production.
 */
function jevProxyDev(): Plugin {
  return {
    name: "jev-proxy-dev",
    apply: "serve",
    configureServer(server) {
      // Connect strips the mount prefix, so `req.url` is already `/v1/systemone`.
      server.middlewares.use("/api/jev", (req, res, next) => {
        const path = (req.url ?? "/").split("?")[0] ?? "";
        void (async () => {
          let request: Request;
          try {
            request = await toWebRequest(req, "http://localhost");
          } catch (error) {
            if (!(error instanceof PayloadTooLargeError)) throw error;
            await writeWebResponse(res, payloadTooLargeResponse());
            return;
          }
          const env = { TYPESAFE_BASE_URL: process.env.TYPESAFE_BASE_URL };
          await writeWebResponse(res, await handleJevProxy(request, path, env));
        })().catch(next);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), jevProxyDev()],
  test: {
    include: [
      "src/**/*.test.ts",
      "src/**/*.test.tsx",
      "functions/**/*.test.ts",
      "bench/**/*.test.ts",
    ],
    passWithNoTests: true,
  },
});
