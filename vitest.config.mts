import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@config": path.resolve(__dirname, "config/index.ts"),
      "@": path.resolve(__dirname, "src"),
      // `server-only` throws outside a React Server environment; tests run in
      // plain Node, where these modules are safe to import.
      "server-only": path.resolve(__dirname, "test/server-only-stub.ts"),
    },
  },
  // The case study's tests run too, so its claims stay checked, though none of
  // its code ships (docs/case-studies/therapist-matching.md).
  test: { include: ["test/**/*.test.ts", "case-studies/**/*.test.ts"] },
});
