// `bb studio settings`: Studio's own settings from the command line. API keys
// are set on Studio's settings page (API keys) or by environment variable.
//
//   bb studio settings [list] [--json]       every setting by section
//   bb studio settings get <key> [--json]
//   bb studio settings set <key> <value>     true/false, a number, or text
//   bb studio settings reset <key>           back to the default
import { isHiddenSetting, parseSettingText, SETTINGS_GROUPS, STUDIO_SETTINGS, VISIBLE_SETTING_KEYS, type StudioSetting } from "./schema";
import type { StudioSettingsStore } from "./store";

export const SETTINGS_USAGE = "bb studio settings [list|get <key>|set <key> <value>|reset <key>] [--json]";

type CliResult = { exitCode: number; stdout?: string; stderr?: string };

const GROUP_TITLES: Record<string, string> = {
  ...Object.fromEntries(SETTINGS_GROUPS.map((group) => [group.id, group.title])),
  attention: "Attention (Bot ▸ Controls)",
};

const show = (value: unknown) => (typeof value === "string" ? JSON.stringify(value) : String(value));

export async function settingsCli(argv: string[], store: StudioSettingsStore): Promise<CliResult> {
  const json = argv.includes("--json");
  const args = argv.filter((arg) => arg !== "--json");
  const [command = "list", key, ...rest] = args;
  const usage = (message?: string): CliResult => ({ exitCode: 1, stderr: `${message ? `${message}\n` : ""}Usage: ${SETTINGS_USAGE}\n` });
  const values = store.current() as Record<string, unknown>;
  const changed = new Set(Object.keys(store.explicit()));
  const unknown = (name: string) => usage(`There's no Studio setting called ${name}. See them all: bb studio settings list`);

  switch (command) {
    case "list": {
      if (key) return usage();
      if (json) {
        const out = VISIBLE_SETTING_KEYS.map((name) => ({ key: name, group: STUDIO_SETTINGS[name].group, label: STUDIO_SETTINGS[name].label, value: values[name], default: STUDIO_SETTINGS[name].default, changed: changed.has(name) }));
        return { exitCode: 0, stdout: `${JSON.stringify(out, null, 2)}\n` };
      }
      const groups = [...SETTINGS_GROUPS.map((group) => group.id), "attention"];
      const width = Math.max(...VISIBLE_SETTING_KEYS.map((name) => name.length));
      const lines: string[] = [];
      for (const group of groups) {
        const names = VISIBLE_SETTING_KEYS.filter((name) => STUDIO_SETTINGS[name].group === group);
        if (!names.length) continue;
        lines.push(GROUP_TITLES[group]!);
        for (const name of names) {
          const mark = changed.has(name) ? "" : "  (default)";
          lines.push(`  ${name.padEnd(width)}  ${show(values[name])}${mark}`);
        }
        lines.push("");
      }
      lines.push("API keys: Settings ▸ Studio ▸ API keys, or their environment variables.");
      return { exitCode: 0, stdout: `${lines.join("\n")}\n` };
    }
    case "get": {
      if (!key || rest.length) return usage();
      if (!Object.hasOwn(STUDIO_SETTINGS, key) || isHiddenSetting(key)) return unknown(key);
      const setting: StudioSetting = STUDIO_SETTINGS[key as keyof typeof STUDIO_SETTINGS];
      if (json) return { exitCode: 0, stdout: `${JSON.stringify({ key, value: values[key], default: setting.default, changed: changed.has(key) })}\n` };
      return { exitCode: 0, stdout: `${show(values[key])}\n` };
    }
    case "set": {
      if (!key || !rest.length) return usage();
      if (!Object.hasOwn(STUDIO_SETTINGS, key) || isHiddenSetting(key)) return unknown(key);
      const parsed = parseSettingText(key, rest.join(" "));
      if (!parsed.ok) return { exitCode: 1, stderr: `${parsed.error}\n` };
      const next = await store.set({ [key]: parsed.value }) as Record<string, unknown>;
      return { exitCode: 0, stdout: json ? `${JSON.stringify({ key, value: next[key] })}\n` : `${key} = ${show(next[key])}\n` };
    }
    case "reset": {
      if (!key || rest.length) return usage();
      if (!Object.hasOwn(STUDIO_SETTINGS, key) || isHiddenSetting(key)) return unknown(key);
      const next = await store.set({ [key]: null }) as Record<string, unknown>;
      return { exitCode: 0, stdout: json ? `${JSON.stringify({ key, value: next[key] })}\n` : `${key} = ${show(next[key])} (default)\n` };
    }
    default:
      return usage(`Unknown command: ${command}`);
  }
}
