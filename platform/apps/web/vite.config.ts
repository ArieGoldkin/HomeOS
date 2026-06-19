/// <reference types="vitest/config" />
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vitest/config";

// Cross-surface building blocks (@shared) + feature slices (@features) + surface shells (@app).
// One barrel per nested group; deps flow app -> features -> shared -> @homeos/shared.
const alias = {
  "@shared": fileURLToPath(new URL("./src/shared", import.meta.url)),
  "@features": fileURLToPath(new URL("./src/features", import.meta.url)),
  "@app": fileURLToPath(new URL("./src/app", import.meta.url)),
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias },
  test: {
    environment: "jsdom",
    globals: false,
    setupFiles: ["./src/test/setup.ts"],
    css: true,
  },
});
