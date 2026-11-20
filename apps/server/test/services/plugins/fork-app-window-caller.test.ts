import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  adoptUiTokenHash,
  resetUiTokenForTests,
} from "../../../src/services/fork-import/bring-over/ui-token.js";
import { forkAppWindowCaller } from "../../../src/services/plugins/fork-app-window-caller.js";
import { startTestServer } from "../../helpers/test-app.js";

const TOKEN = "t".repeat(43);

function useToken(token: string | null): void {
  adoptUiTokenHash(
    token === null
      ? {}
      : {
          BB_STUDIO_UI_TOKEN_SHA256: createHash("sha256")
            .update(token)
            .digest("hex"),
        },
  );
}

function headers(values: Record<string, string>) {
  return (name: string) => values[name];
}

afterEach(() => {
  resetUiTokenForTests();
});

describe("the app-window caller flag on plugin rpc", () => {
  it("flags a client call that carries the app token", () => {
    useToken(TOKEN);
    expect(
      forkAppWindowCaller(
        { kind: "client" },
        headers({ "x-bb-studio-ui-token": TOKEN }),
      ),
    ).toEqual({ kind: "client", studioAppWindow: true });
  });

  it("never flags a wrong token, no token, or a server with no token hash", () => {
    useToken(TOKEN);
    expect(
      forkAppWindowCaller(
        { kind: "client" },
        headers({ "x-bb-studio-ui-token": "u".repeat(43) }),
      ),
    ).toEqual({ kind: "client" });
    expect(forkAppWindowCaller({ kind: "client" }, headers({}))).toEqual({
      kind: "client",
    });
    useToken(null);
    expect(
      forkAppWindowCaller(
        { kind: "client" },
        headers({ "x-bb-studio-ui-token": TOKEN }),
      ),
    ).toEqual({ kind: "client" });
  });

  it("never flags an agent's or the CLI's call, even with the right token", () => {
    useToken(TOKEN);
    const extras: Record<string, string>[] = [
      { "x-bb-caller-thread": "thr_test" },
      { "x-bb-cli": "1" },
      { "x-bb-caller-thread": "" },
    ];
    for (const extra of extras) {
      expect(
        forkAppWindowCaller(
          { kind: "client" },
          headers({ "x-bb-studio-ui-token": TOKEN, ...extra }),
        ),
      ).toEqual({ kind: "client" });
    }
  });

  it("never flags a plugin caller", () => {
    useToken(TOKEN);
    expect(
      forkAppWindowCaller(
        { kind: "plugin", pluginId: "other" },
        headers({ "x-bb-studio-ui-token": TOKEN }),
      ),
    ).toEqual({ kind: "plugin", pluginId: "other" });
  });

  it("reaches the rpc handler through POST /plugins/:id/rpc/:method", async () => {
    useToken(TOKEN);
    const server = await startTestServer();
    const workDir = await mkdtemp(join(tmpdir(), "bb-fork-app-window-"));
    try {
      server.pluginService.bindSdk({ baseUrl: server.baseUrl });
      const rootDir = join(workDir, "bb-plugin-callee");
      await mkdir(rootDir, { recursive: true });
      await writeFile(
        join(rootDir, "package.json"),
        JSON.stringify({
          name: "bb-plugin-callee",
          version: "0.1.0",
          bb: {
            name: "Fixture",
            description: "Fixture.",
            branding: { icon: "Zap" },
            server: "./server.ts",
          },
        }),
      );
      await writeFile(
        join(rootDir, "server.ts"),
        "export default function plugin() {}",
      );
      expect((await server.pluginService.installPath(rootDir)).status).toBe(
        "running",
      );
      const api = server.pluginService.getApi("callee");
      if (!api) throw new Error("callee is not running");
      api.rpc.register(
        defineRpcContract({ whoami: { input: z.null(), output: z.unknown() } }),
        {
          whoami: (_input: null, context: { experimental_caller: unknown }) =>
            context.experimental_caller,
        },
      );
      const call = async (extra: Record<string, string>) => {
        const response = await fetch(
          `${server.baseUrl}/api/v1/plugins/callee/rpc/whoami`,
          {
            method: "POST",
            headers: { "content-type": "application/json", ...extra },
            body: "null",
          },
        );
        return (await response.json()) as { result: unknown };
      };
      expect(await call({ "x-bb-studio-ui-token": TOKEN })).toEqual({
        ok: true,
        result: { kind: "client", studioAppWindow: true },
      });
      expect((await call({})).result).toEqual({ kind: "client" });
      expect(
        (await call({ "x-bb-studio-ui-token": "u".repeat(43) })).result,
      ).toEqual({ kind: "client" });
      expect(
        (await call({ "x-bb-studio-ui-token": TOKEN, "x-bb-cli": "1" })).result,
      ).toEqual({ kind: "client" });
      expect(
        (
          await call({
            "x-bb-studio-ui-token": TOKEN,
            "x-bb-caller-thread": "thr_test",
          })
        ).result,
      ).toEqual({ kind: "client" });
    } finally {
      await server.pluginService.stop();
      await rm(workDir, { recursive: true, force: true });
      await server.close();
    }
  });
});
