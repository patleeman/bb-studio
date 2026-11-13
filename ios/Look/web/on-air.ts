// On Air: the phone's default look (design 10a, graphite). It does not exist on
// desktop; it is a classic theme package so desktop's resolveLook and tokens apply.
import type { ThemePackage } from "../../../plugins/packages/bb-studio/src/theme/schema";

const SANS = `-apple-system, system-ui, sans-serif`;
const MONO = `ui-monospace, "SF Mono", Menlo, monospace`;

export const ON_AIR_ID = "on-air";

export const ON_AIR: ThemePackage = {
  format: 1,
  id: ON_AIR_ID,
  name: "On Air",
  kind: "classic",
  palette: ["#111316", "#9db8ff", "#f2b04a", "#63c98b"],
  variants: {
    dark: { canvas: "#111316", ink: "#f2f3f5", sidebar: "#16181c", accent: "#9db8ff", accentInk: "#0c0d0f", selection: "#9db8ff", error: "#ff6b6b", warning: "#f2b04a", success: "#63c98b" },
  },
  glass: null,
  type: { heading: SANS, body: SANS, mono: MONO },
  radius: 12,
  motion: { speed: 0, crossfadeMs: 360 },
  effects: { worker: { color: "#63c98b", character: "dot" }, needsYou: { color: "#f2b04a" }, finished: { color: "#63c98b" }, error: { color: "#ff6b6b" } },
  defaults: { intensity: 0, glass: 1, motion: 0 },
  scene: { kind: "none" },
  credit: null,
};
