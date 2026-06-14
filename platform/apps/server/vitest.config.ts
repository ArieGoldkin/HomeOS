import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // index.ts is the process bootstrap (wiring only) — exercised by the manual smoke, not units.
      exclude: ["src/index.ts"],
    },
  },
});
