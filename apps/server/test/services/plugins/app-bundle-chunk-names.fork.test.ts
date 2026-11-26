import { describe, expect, it } from "vitest";
import { PLUGIN_SDK_MAJOR, PLUGIN_SDK_VERSION } from "@bb/domain";
import { parsePluginAppBundleMeta } from "../../../src/services/plugins/app-bundle.js";

function meta(chunks: string[]): string {
  return JSON.stringify({
    sdkMajor: PLUGIN_SDK_MAJOR,
    sdkVersion: PLUGIN_SDK_VERSION,
    artifactFormatVersion: 2,
    pluginId: "studio",
    pluginVersion: "0.1.0",
    builtWith: { bbVersion: "0.50.1", pluginSdkVersion: PLUGIN_SDK_VERSION },
    chunks,
    entryChunks: [],
    chunkRuntimeSlots: [],
  });
}

describe("plugin app chunk names", () => {
  it("accepts the dotted names esbuild keeps from a dependency's file name", () => {
    const parsed = parsePluginAppBundleMeta(
      meta([
        "chunks/subset-shared.chunk-RCQKAY3F.js",
        "chunks/image-blob-reduce.esm-EURAQXLQ.js",
        "chunks/chunk-SHARED.js",
      ]),
    );
    expect(parsed).not.toBeNull();
  });

  it("still refuses names that leave the chunks folder or start with a dot", () => {
    for (const file of ["chunks/../app.js", "chunks/.hidden.js", "chunks/a/b.js", "app.js"]) {
      expect(parsePluginAppBundleMeta(meta([file])), file).toBeNull();
    }
  });
});
