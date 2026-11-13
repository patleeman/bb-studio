import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { copyRuntime, runtimeFilePackage } from "./bundle-studio-plugins.mjs";

function write(path, text) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
}

function fixture(runtimeFiles) {
  const root = mkdtempSync(join(tmpdir(), "bundle-studio-"));
  const store = join(root, "store");
  write(join(store, "wasm-pkg", "package.json"), '{"name":"@x/wasm"}');
  write(join(store, "wasm-pkg", "index_bg.wasm"), "wasm");
  write(join(store, "wasm-pkg", "unused.js"), "unused");
  write(join(store, "draw", "package.json"), '{"name":"draw"}');
  write(join(store, "draw", "dist", "prod", "index.js"), "main");
  write(join(store, "draw", "dist", "prod", "fonts", "A", "a.woff2"), "font");
  write(join(store, "draw", "dist", "dev", "index.js"), "dev");
  const source = join(root, "plugin");
  write(
    join(source, "package.json"),
    JSON.stringify({
      name: "plugin",
      bb: { server: "./server.ts" },
      studioRuntimeFiles: runtimeFiles,
    }),
  );
  write(join(source, "dist", "server.js"), "server");
  mkdirSync(join(source, "node_modules", "@x"), { recursive: true });
  symlinkSync(
    join(store, "wasm-pkg"),
    join(source, "node_modules", "@x", "wasm"),
  );
  symlinkSync(join(store, "draw"), join(source, "node_modules", "draw"));
  return { root, source, target: join(root, "out", "plugin") };
}

test("splits a runtime file into its package and the path inside it", () => {
  assert.deepEqual(runtimeFilePackage("@x/wasm/index_bg.wasm"), {
    name: "@x/wasm",
    subpath: "index_bg.wasm",
  });
  assert.deepEqual(runtimeFilePackage("mermaid/dist/mermaid.min.js"), {
    name: "mermaid",
    subpath: "dist/mermaid.min.js",
  });
});

test("copies only the listed runtime files, under dist/runtime", () => {
  const { root, source, target } = fixture([
    "@x/wasm/index_bg.wasm",
    "draw/dist/prod/index.js",
    "draw/dist/prod/fonts",
  ]);
  try {
    copyRuntime(source, target);
    const modules = join(target, "dist", "runtime");
    assert.equal(
      readFileSync(join(modules, "@x/wasm/index_bg.wasm"), "utf8"),
      "wasm",
    );
    assert.ok(!existsSync(join(target, "node_modules")));
    assert.ok(!existsSync(join(modules, "@x/wasm/unused.js")));
    assert.equal(
      readFileSync(join(modules, "draw/dist/prod/index.js"), "utf8"),
      "main",
    );
    assert.ok(existsSync(join(modules, "draw/dist/prod/fonts/A/a.woff2")));
    assert.ok(!existsSync(join(modules, "draw/dist/dev")));
    assert.ok(existsSync(join(target, "dist", "server.js")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fails when a listed runtime file is missing", () => {
  const { root, source, target } = fixture(["@x/wasm/missing.wasm"]);
  try {
    assert.throws(
      () => copyRuntime(source, target),
      /missing\.wasm is missing/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
