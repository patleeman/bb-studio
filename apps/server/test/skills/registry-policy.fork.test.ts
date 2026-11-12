import {
  deleteInstalledPlugin,
  upsertInstalledPlugin,
  type DbConnection,
} from "@bb/db";
import { afterEach, describe, expect, it } from "vitest";
import {
  registerSkillsRegistryPolicy,
  skillsRegistryCaller,
  skillsRegistryOperation,
} from "../../src/services/skills/registry-policy.fork.js";
import { withTestHarness } from "../helpers/test-app.js";

let disposers: Array<() => void> = [];
afterEach(() => {
  for (const dispose of disposers) dispose();
  disposers = [];
});

const OFF =
  "Installing skills from the public registry is off in BB Studio. A person can turn it on in Settings.";

async function message(response: Response): Promise<string> {
  return ((await response.json()) as { message: string }).message;
}

describe("skills registry policy", () => {
  it("names each registry route's operation", () => {
    expect(skillsRegistryOperation("GET", "/api/v1/skills-registry")).toBe(
      "search",
    );
    expect(
      skillsRegistryOperation("GET", "/api/v1/skills-registry/detail"),
    ).toBe("read");
    expect(
      skillsRegistryOperation("POST", "/api/v1/skills-registry/entries"),
    ).toBe("read");
    expect(
      skillsRegistryOperation("POST", "/api/v1/skills-registry/install"),
    ).toBe("install");
    expect(
      skillsRegistryOperation("GET", "/api/v1/skills-registry/install-jobs/j1"),
    ).toBe("install");
  });

  it("refuses search, read and install while a plugin says no", async () => {
    await withTestHarness(async (harness) => {
      const asked: string[] = [];
      disposers.push(
        registerSkillsRegistryPolicy("studio", ({ operation }) => {
          asked.push(operation);
          return { allowed: false, message: OFF };
        }),
      );

      const search = await harness.app.request("/api/v1/skills-registry?q=x");
      const read = await harness.app.request(
        "/api/v1/skills-registry/entry?id=a/b/c",
      );
      const install = await harness.app.request(
        "/api/v1/skills-registry/install",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ registrySkillId: "a/b/c" }),
        },
      );
      const job = await harness.app.request(
        "/api/v1/skills-registry/install-jobs",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ registrySkillId: "a/b/c" }),
        },
      );

      for (const response of [search, read, install, job]) {
        expect(response.status).toBe(403);
        expect(await message(response)).toBe(OFF);
      }
      expect(asked).toEqual(["search", "read", "install", "install"]);
    });
  });

  it("lets requests through to the routes when every plugin allows them", async () => {
    await withTestHarness(async (harness) => {
      disposers.push(
        registerSkillsRegistryPolicy("studio", () => ({ allowed: true })),
      );

      const read = await harness.app.request("/api/v1/skills-registry/entry");
      const install = await harness.app.request(
        "/api/v1/skills-registry/install",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        },
      );

      expect(read.status).toBe(400);
      expect(await message(read)).toBe("Expected a registry skill ID");
      expect(install.status).toBe(400);
      expect(await message(install)).toBe("Expected registrySkillId");
    });
  });

  it("refuses when a policy throws, and serves again once it is gone", async () => {
    await withTestHarness(async (harness) => {
      const dispose = registerSkillsRegistryPolicy("broken", () => {
        throw new Error("settings unreadable");
      });

      const refused = await harness.app.request(
        "/api/v1/skills-registry/entry",
      );
      expect(refused.status).toBe(403);
      expect(await message(refused)).toBe(
        "The broken plugin refused this skill registry request: settings unreadable",
      );

      dispose();
      const served = await harness.app.request("/api/v1/skills-registry/entry");
      expect(served.status).toBe(400);
    });
  });

  it("leaves the other skill routes alone", async () => {
    await withTestHarness(async (harness) => {
      disposers.push(
        registerSkillsRegistryPolicy("studio", () => ({
          allowed: false,
          message: OFF,
        })),
      );

      const list = await harness.app.request(
        "/api/v1/skills?projectId=proj_personal",
      );

      expect(list.status).not.toBe(403);
    });
  });
});

function seedInstalledPlugin(db: DbConnection, id: string) {
  upsertInstalledPlugin(db, {
    id,
    source: `path:/tmp/${id}`,
    provenance: { kind: "direct" },
    sourceIntent: { kind: "path", path: `/tmp/${id}` },
    exactResolution: { kind: "path" },
    updateState: {
      lastCheckAt: null,
      availableCompatibleVersion: null,
      newestIncompatibleVersion: null,
      statusDetail: null,
    },
    activeArtifactId: null,
    rootDir: `/tmp/${id}`,
    version: "1.0.0",
    enabled: true,
    enabledFollowsDefault: false,
  } as never);
}

describe("skills registry policy owners", () => {
  it("refuses while a plugin that owns a policy is enabled but not running, and lets a removed owner go", async () => {
    await withTestHarness(async (harness) => {
      seedInstalledPlugin(harness.db, "studio");
      const dispose = registerSkillsRegistryPolicy(
        "studio",
        () => ({ allowed: true }),
        harness.db,
      );
      const served = await harness.app.request("/api/v1/skills-registry/entry");
      expect(served.status).toBe(400);

      dispose();
      const refused = await harness.app.request(
        "/api/v1/skills-registry/entry",
      );
      expect(refused.status).toBe(403);
      expect(await message(refused)).toBe(
        "The studio plugin decides skill registry requests and is not running. Try again once it has started.",
      );

      deleteInstalledPlugin(harness.db, "studio");
      const released = await harness.app.request(
        "/api/v1/skills-registry/entry",
      );
      expect(released.status).toBe(400);
    });
  });

  it("tells the policy who the request says is asking", async () => {
    await withTestHarness(async (harness) => {
      const callers: unknown[] = [];
      disposers.push(
        registerSkillsRegistryPolicy("studio", ({ caller }) => {
          callers.push(caller);
          return { allowed: false, message: OFF };
        }),
      );
      await harness.app.request("/api/v1/skills-registry?q=x");
      await harness.app.request("/api/v1/skills-registry?q=x", {
        headers: { "x-bb-cli": "1" },
      });
      await harness.app.request("/api/v1/skills-registry?q=x", {
        headers: { "x-bb-cli": "1", "x-bb-caller-thread": "thr_agent" },
      });
      expect(callers).toEqual([
        { kind: "app" },
        { kind: "cli" },
        { kind: "agent", threadId: "thr_agent" },
      ]);
      expect(skillsRegistryCaller(() => undefined)).toEqual({ kind: "app" });
    });
  });
});
