import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: [{
      find: /^react-dom$/,
      replacement: fileURLToPath(new URL("./node_modules/react-dom/index.js", import.meta.url)),
    }],
  },
  test: {
    silent: "passed-only",
    name: "bb-studio-sidebar",
    include: ["source/**/*.test.{ts,tsx}"],
    exclude: ["node_modules/**"],
  },
});
