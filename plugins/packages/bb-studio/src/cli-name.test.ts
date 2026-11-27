// BB Studio's CLI is `bbs`; stock bb's is `bb`. Text a person reads (usage
// lines, errors, the Setup page's commands, the docs and the UI) must name
// `bbs` in BB Studio. Text only agents read may keep `bb`, which runs Studio's
// CLI in Studio's agent shells too, so skills, prompts and tool descriptions
// are not scanned here.
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import type { PluginCliRegistration } from "@get-bb/plugin-sdk";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import ts from "typescript";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import plugin from "../server";
import { STUDIO_CLI_ALIAS_MARKER, studioCliName, studioCliRegistration, withStudioCli } from "./cli-name";
import { installCommand, marketplaceCommand } from "./setup";

// studioCliName() reads BB_CLI, also while modules load (setup.ts builds its
// commands then). An agent shell's BB_CLI can point at a CLI with no Studio
// `bbs` beside it, which makes the text say `bb`. These tests expect BB
// Studio's own CLI, so the shell's BB_* variables are set aside before any
// import runs and put back afterwards.
const ambientBb = vi.hoisted(() => {
  const saved: Record<string, string | undefined> = {};
  for (const name of Object.keys(process.env)) if (name.startsWith("BB_")) { saved[name] = process.env[name]; delete process.env[name]; }
  return saved;
});
afterAll(() => { Object.assign(process.env, ambientBb); });

const root = join(__dirname, "..");
const plugins = join(root, "..", "..");

// `bb` followed by a word that makes it a command, in code a person copies.
const COMMAND = /(^|[\s(|&;:`'"])bb (studio|plugin|marketplace|mobile|thread|status|guide|settings|automation|project|voice|pool|skill|theme|server|browser-automation|terminal|environment)\b/u;
// A line may name stock bb's command or an old one on purpose.
const ALLOWED_LINE = /stock bb|before the merge|bb-cli-ok/u;

function markdownCode(text: string): { line: number; code: string }[] {
  const out: { line: number; code: string }[] = [];
  let fence = false;
  text.split("\n").forEach((line, index) => {
    if (/^\s*(```|~~~)/u.test(line)) {
      fence = !fence;
      return;
    }
    if (ALLOWED_LINE.test(line)) return;
    if (fence) out.push({ line: index + 1, code: line });
    else for (const match of line.matchAll(/`([^`]+)`/gu)) out.push({ line: index + 1, code: match[1]! });
  });
  return out;
}

function files(dir: string, keep: (path: string) => boolean, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) files(path, keep, out);
    else if (keep(path)) out.push(path);
  }
  return out;
}

function literals(path: string): { text: string; line: number }[] {
  const raw = readFileSync(path, "utf8");
  if (!COMMAND.test(raw)) return [];
  const source = ts.createSourceFile(path, raw, ts.ScriptTarget.Latest, false, ts.ScriptKind.TSX);
  const out: { text: string; line: number }[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node) || ts.isJsxText(node)) {
      out.push({ text: node.text, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1 });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

describe("studioCliName", () => {
  const dirs: string[] = [];
  afterAll(() => dirs.forEach((dir) => rmSync(dir, { force: true, recursive: true })));
  const bin = (alias?: string) => {
    const dir = mkdtempSync(join(tmpdir(), "studio-cli-name-"));
    dirs.push(dir);
    writeFileSync(join(dir, "bb"), "");
    if (alias !== undefined) writeFileSync(join(dir, "bbs"), alias);
    return join(dir, "bb");
  };

  it("is bbs in BB Studio and bb under stock bb or an older Studio", () => {
    expect(studioCliName({})).toBe("bbs");
    expect(studioCliName({ BB_CLI: bin(`#!/bin/sh\n# ${STUDIO_CLI_ALIAS_MARKER}\n`) })).toBe("bbs");
    expect(studioCliName({ BB_CLI: bin() })).toBe("bb");
    expect(studioCliName({ BB_CLI: bin("#!/bin/sh\n# something else\n") })).toBe("bb");
  });
});

describe("withStudioCli", () => {
  it("renames commands and leaves prose alone", () => {
    expect(withStudioCli("Usage: bb studio list [--json]\nRun `bb plugin reload studio`. The bb server is bb's.", "bbs")).toBe(
      "Usage: bbs studio list [--json]\nRun `bbs plugin reload studio`. The bb server is bb's.",
    );
    expect(withStudioCli("Usage: bb studio list", "bb")).toBe("Usage: bb studio list");
  });
});

describe("Studio's CLI text", () => {
  let registration: PluginCliRegistration | undefined;
  let dispose: () => Promise<void> = async () => {};

  beforeAll(async () => {
    const host = createFakePluginHost({ pluginId: "studio", sdk: { threads: { list: async () => [], get: async () => null }, projects: { list: async () => [] } } } as never);
    const register = host.bb.cli.register.bind(host.bb.cli);
    host.bb.cli.register = (value: PluginCliRegistration) => {
      registration = value;
      register(value);
    };
    await plugin(host.bb);
    dispose = () => host.harness.lifecycle.dispose();
  });
  afterAll(() => dispose());

  it("names bbs in every usage line and summary", () => {
    expect(registration?.commands?.length).toBeGreaterThan(10);
    const bad = (registration?.commands ?? []).flatMap((command) =>
      [command.usage, command.summary].filter((text) => COMMAND.test(text)).map((text) => `${command.name}: ${text}`),
    );
    expect(bad).toEqual([]);
    expect(registration?.commands?.find((command) => command.name === "list")?.usage).toMatch(/^bbs studio list/u);
  });

  it("names bbs in a usage error", async () => {
    const result = await registration!.run(["no-such-command"], {});
    expect(result.exitCode).not.toBe(0);
    expect(`${result.stdout ?? ""}${result.stderr ?? ""}`).toContain("bbs studio <list");
  });

  it("leaves a successful command's data alone", async () => {
    const wrapped = studioCliRegistration({ name: "x", summary: "x", run: () => ({ exitCode: 0, stdout: "page text: bb studio list\nUsage: bb studio x" }) }, "bbs");
    expect((await wrapped.run([], {})).stdout).toBe("page text: bb studio list\nUsage: bbs studio x");
  });

  it("gives the Setup page bbs commands", () => {
    expect(installCommand("studio-mobile")).toMatch(/^bbs plugin install /u);
    expect(marketplaceCommand).toMatch(/^bbs marketplace add /u);
  });

  it("is the same helper in the Mobile plugin", () => {
    expect(readFileSync(join(plugins, "packages", "bb-studio-mobile", "cli-name.ts"), "utf8")).toBe(readFileSync(join(root, "src", "cli-name.ts"), "utf8"));
  });
});

describe("text a person reads names bbs", () => {
  it("in the user docs", () => {
    const docs = [
      join(root, "README.md"),
      join(plugins, "packages", "bb-studio-mobile", "README.md"),
      join(plugins, "docs", "backup.md"),
      join(plugins, "docs", "decisions.md"),
      join(plugins, "docs", "studio.md"),
    ];
    const bad = docs.flatMap((path) =>
      markdownCode(readFileSync(path, "utf8"))
        .filter(({ code }) => COMMAND.test(code))
        .map(({ line, code }) => `${relative(plugins, path)}:${line} ${code}`),
    );
    expect(bad).toEqual([]);
  });

  it("in Studio's UI", () => {
    const ui = files(join(root, "src", "ui"), (path) => /\.tsx?$/u.test(path) && !/\.(test|stories)\.tsx?$/u.test(path));
    expect(ui.length).toBeGreaterThan(20);
    const bad = ui.flatMap((path) =>
      literals(path)
        .filter(({ text }) => COMMAND.test(text))
        .map(({ text, line }) => `${relative(root, path)}:${line} ${text}`),
    );
    expect(bad).toEqual([]);
  });
});
