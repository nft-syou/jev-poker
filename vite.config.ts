/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api/jev": {
        target: "https://api.typesafe.ai",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/jev/, ""),
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq, req) => {
            const key = req.headers["x-typesafe-key"];
            if (typeof key === "string" && key.length > 0) {
              proxyReq.setHeader("authorization", `Bearer ${key}`);
              proxyReq.removeHeader("x-typesafe-key");
            }
          });
        },
      },
    },
  },
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "functions/**/*.test.ts"],
    passWithNoTests: true,
  },
});
