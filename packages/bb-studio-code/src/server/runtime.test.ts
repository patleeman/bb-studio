import { describe, expect, it } from "vitest";
import { CODE_SERVER_VERSION, leftoverPids, releaseAsset, workspaceFile, workspaceFileName } from "./runtime";

describe("code-server runtime", () => {
  it("picks the release for this machine", () => {
    expect(releaseAsset("darwin", "arm64")).toBe(`code-server-${CODE_SERVER_VERSION}-macos-arm64`);
    expect(releaseAsset("linux", "x64")).toBe(`code-server-${CODE_SERVER_VERSION}-linux-amd64`);
    expect(releaseAsset("win32", "x64")).toBeNull();
  });

  it("writes a multi-root workspace file", () => {
    expect(JSON.parse(workspaceFile(["/a", "/b"]))).toEqual({ folders: [{ path: "/a" }, { path: "/b" }], settings: {} });
  });

  it("names the workspace file after its title", () => {
    expect(workspaceFileName("Billing / API")).toBe("Billing API.code-workspace");
    expect(workspaceFileName("  ")).toBe("Workspace.code-workspace");
  });
});

describe("leftover servers", () => {
  const root = "/data/plugins/studio-code";
  const ps = [
    `  101 ${root}/code-server/code-server-${CODE_SERVER_VERSION}-macos-arm64/lib/node ${root}/watchdog.cjs ${root}/code-server/x/bin/code-server`,
    `  102 ${root}/code-server/x/lib/node ${root}/code-server/x/out/node/entry.js --bind-addr 127.0.0.1:5000`,
    `  103 /usr/bin/node /bb/plugin-host.js ${root}/server.js`,
    `  104 /usr/bin/vim notes.txt`,
    `  105 ${root}/code-server/x/lib/node self`,
  ].join("\n");

  it("finds this plugin's code-servers and watchdogs, and nothing else", () => {
    expect(leftoverPids(ps, `${root}/`, 105)).toEqual([101, 102]);
  });
});
