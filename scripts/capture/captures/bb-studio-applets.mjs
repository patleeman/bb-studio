import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** The HUD applet from the spec, with two capabilities approved and the rest waiting. */
async function seedApplets() {
  const root = await mkdtemp(join(tmpdir(), "bb-capture-applets-"));
  const manifest = {
    id: "hud",
    name: "Thread HUD",
    version: "0.1.0",
    api: 1,
    entry: "index.html",
    description: "An always-on-top overlay of the threads that need you and the ones running.",
    windows: { main: { kind: "overlay", width: 320, height: 200, position: "top-right" } },
    capabilities: ["window.overlay", "shortcut.global", "notify", "bb.threads.read", "bb.threads.tell", "bb.open"],
    shortcuts: { toggle: "Alt+Space" },
  };
  await mkdir(join(root, "hud"));
  await writeFile(join(root, "hud", "manifest.json"), JSON.stringify(manifest, null, 2));
  await writeFile(join(root, "hud", "index.html"), "<!doctype html><title>Thread HUD</title>");
  await writeFile(join(root, "grants.json"), JSON.stringify({ hud: ["shortcut.global", "window.overlay"] }));
  return root;
}

export default ({ bbCli }) => [
  {
    id: "applets",
    packageDir: "bb-studio-applets",
    setup: async (client) => {
      const root = await seedApplets();
      const cleanup = async () => {
        await bbCli(["plugin", "config", "applets", "unset", "folder"]).catch(() => {});
        await rm(root, { recursive: true, force: true });
      };
      try {
        await bbCli(["plugin", "config", "applets", "set", "folder", root]);
        await client.navigate("/settings/plugins/applets");
        await client.waitForText("Studio Applets");
        await client.waitForText("Studio Applets app");
        await client.waitForText("Not installed");
        await client.waitForText("Thread HUD");
        await client.waitForText("bb.threads.tell");
        await client.waitForText("Approve");
      } catch (error) {
        await cleanup();
        throw error;
      }
      return cleanup;
    },
  },
];
