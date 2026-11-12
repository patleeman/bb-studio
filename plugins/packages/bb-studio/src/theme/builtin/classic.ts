import type { ThemePackage, ThemeVariant } from "../schema";

const SANS = `"Inter Variable", Inter, -apple-system, system-ui, sans-serif`;
const MONO = `ui-monospace, "SF Mono", Menlo, Monaco, monospace`;

interface ClassicSpec {
  id: string;
  name: string;
  palette: [string, string, string, string];
  light?: ThemeVariant;
  dark?: ThemeVariant;
  credit: NonNullable<ThemePackage["credit"]>;
}

function classic(spec: ClassicSpec): ThemePackage {
  const colors = (spec.dark ?? spec.light)!;
  return {
    format: 1,
    id: spec.id,
    name: spec.name,
    kind: "classic",
    palette: spec.palette,
    variants: { ...(spec.light ? { light: spec.light } : {}), ...(spec.dark ? { dark: spec.dark } : {}) },
    glass: null,
    type: { heading: SANS, body: SANS, mono: MONO },
    radius: 8,
    motion: { speed: 0, crossfadeMs: 360 },
    effects: {
      worker: { color: spec.palette[3], character: "dot" },
      needsYou: { color: colors.warning },
      finished: { color: colors.success },
      error: { color: colors.error },
    },
    defaults: { intensity: 0, glass: 1, motion: 0 },
    scene: { kind: "none" },
    credit: spec.credit,
  };
}

export const BB_DEFAULT = classic({
  id: "bb-default",
  name: "bb Default",
  palette: ["#ffffff", "#262626", "#151515", "#3bb974"],
  light: { canvas: "#ffffff", ink: "#333333", sidebar: "#fafafa", accent: "#262626", accentInk: "#ffffff", selection: "#262626", error: "#a5000f", warning: "#eb7c33", success: "#3bb974" },
  dark: { canvas: "#151515", ink: "#c1c1c1", sidebar: "#1b1b1b", accent: "#c4c4c4", accentInk: "#1a1a1a", selection: "#c4c4c4", error: "#cc323d", warning: "#fc8c45", success: "#4bc680" },
  credit: { source: "https://github.com/get-bb/bb", license: "MIT", copyright: "Copyright (c) 2026 Michael Yong" },
});

export const ONE_DARK = classic({
  id: "one-dark",
  name: "One Dark",
  palette: ["#282c34", "#61afef", "#c678dd", "#98c379"],
  dark: { canvas: "#282c34", ink: "#abb2bf", sidebar: "#21252b", accent: "#61afef", accentInk: "#282c34", selection: "#61afef", error: "#e06c75", warning: "#e5c07b", success: "#98c379" },
  credit: { source: "https://github.com/atom/atom/tree/master/packages/one-dark-syntax", license: "MIT", copyright: "Copyright (c) 2016 GitHub Inc." },
});

export const DRACULA = classic({
  id: "dracula",
  name: "Dracula",
  palette: ["#282a36", "#bd93f9", "#ff79c6", "#8be9fd"],
  dark: { canvas: "#282a36", ink: "#f8f8f2", sidebar: "#21222c", accent: "#bd93f9", accentInk: "#282a36", selection: "#bd93f9", error: "#ff5555", warning: "#ffb86c", success: "#50fa7b" },
  credit: { source: "https://draculatheme.com/spec", license: "MIT", copyright: "Copyright (c) 2023 Dracula Theme" },
});

export const SOLARIZED_LIGHT = classic({
  id: "solarized-light",
  name: "Solarized Light",
  palette: ["#fdf6e3", "#268bd2", "#2aa198", "#d33682"],
  light: { canvas: "#fdf6e3", ink: "#586e75", sidebar: "#fdf6e3", accent: "#268bd2", accentInk: "#fdf6e3", selection: "#268bd2", error: "#dc322f", warning: "#b58900", success: "#859900" },
  credit: { source: "https://github.com/altercation/solarized", license: "MIT", copyright: "Copyright (c) 2011 Ethan Schoonover" },
});

export const GITHUB_LIGHT = classic({
  id: "github-light",
  name: "GitHub Light",
  palette: ["#ffffff", "#0969da", "#9a6700", "#1a7f37"],
  light: { canvas: "#ffffff", ink: "#1f2328", sidebar: "#f6f8fa", accent: "#0969da", accentInk: "#ffffff", selection: "#0969da", error: "#cf222e", warning: "#9a6700", success: "#1a7f37" },
  credit: { source: "https://github.com/primer/github-vscode-theme", license: "MIT", copyright: "Copyright (c) 2020 Primer" },
});

export const GITHUB_DARK = classic({
  id: "github-dark",
  name: "GitHub Dark",
  palette: ["#0d1117", "#2f81f7", "#d29922", "#3fb950"],
  dark: { canvas: "#0d1117", ink: "#e6edf3", sidebar: "#010409", accent: "#2f81f7", accentInk: "#0d1117", selection: "#2f81f7", error: "#f85149", warning: "#d29922", success: "#3fb950" },
  credit: { source: "https://github.com/primer/github-vscode-theme", license: "MIT", copyright: "Copyright (c) 2020 Primer" },
});

export const NORD = classic({
  id: "nord",
  name: "Nord",
  palette: ["#2e3440", "#88c0d0", "#b48ead", "#a3be8c"],
  dark: { canvas: "#2e3440", ink: "#d8dee9", sidebar: "#3b4252", accent: "#88c0d0", accentInk: "#2e3440", selection: "#88c0d0", error: "#bf616a", warning: "#ebcb8b", success: "#a3be8c" },
  credit: { source: "https://github.com/nordtheme/nord", license: "MIT", copyright: "Copyright (c) 2016-present Sven Greb" },
});

export const CATPPUCCIN_MOCHA = classic({
  id: "catppuccin-mocha",
  name: "Catppuccin Mocha",
  palette: ["#1e1e2e", "#cba6f7", "#89b4fa", "#a6e3a1"],
  dark: { canvas: "#1e1e2e", ink: "#cdd6f4", sidebar: "#181825", accent: "#cba6f7", accentInk: "#1e1e2e", selection: "#9399b2", error: "#f38ba8", warning: "#f9e2af", success: "#a6e3a1" },
  credit: { source: "https://github.com/catppuccin/palette", license: "MIT", copyright: "Copyright (c) 2021 Catppuccin" },
});

export const CLASSIC_THEMES: readonly ThemePackage[] = [BB_DEFAULT, ONE_DARK, DRACULA, SOLARIZED_LIGHT, GITHUB_LIGHT, GITHUB_DARK, NORD, CATPPUCCIN_MOCHA];
