import { defineConfig } from "vitest/config";

/**
 * On GitHub Pages a project site is served from `/<repo>/`, so the deploy
 * workflow passes BASE_PATH. Locally and for user/organisation sites it is `/`.
 */
const base = process.env["BASE_PATH"] ?? "/";

export default defineConfig({
  base,
  server: { port: 5180, open: false },
  build: { target: "es2022", sourcemap: true },
  test: { include: ["tests/**/*.test.ts"], environment: "node" },
});
