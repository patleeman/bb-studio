import { fileURLToPath } from "node:url";
import babel from "@rolldown/plugin-babel";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { build } from "vite";
import { afterEach, expect, it, vi } from "vitest";

const entry = fileURLToPath(new URL("./relayedFold.fork.tsx", import.meta.url));

afterEach(() => vi.unstubAllEnvs());

it("keeps the plugins' classifiers as a cache key of the compiled fold, so a late classifier re-folds", async () => {
  vi.stubEnv("NODE_ENV", "production");
  const result = await build({
    configFile: false,
    logLevel: "silent",
    plugins: [react(), await babel({ presets: [reactCompilerPreset()] })],
    build: {
      write: false,
      minify: false,
      rolldownOptions: {
        input: entry,
        external: (id) => id !== entry,
        preserveEntrySignatures: "strict",
      },
    },
  });
  if (Array.isArray(result) || !("output" in result)) {
    throw new Error("Expected one build output");
  }
  const chunk = result.output.find((item) => item.type === "chunk");
  if (chunk === undefined || chunk.type !== "chunk") throw new Error("No chunk");
  const hook = chunk.code.slice(
    chunk.code.indexOf("function useRelayedFold"),
    chunk.code.indexOf("function RelayedRowFolded"),
  );
  expect(hook).toMatch(/\$\[\d+\] !== \w+\.replyClassifiers/u);
  expect(hook).toMatch(/foldRelayedRows\([^;]*\.replyClassifiers\)/u);
}, 60_000);
