// studio://kit/boot.js — load first in an applet page:
//   <script type="module" src="studio://kit/boot.js"></script>
// It applies BB's compiled stylesheet and active theme, follows the system's
// light or dark mode the way BB does (a `dark` class on <html>), and starts
// Tailwind's browser build for classes BB's stylesheet doesn't include.

const TOKENS = [
  "background", "foreground", "canvas", "ink", "muted", "muted-foreground", "subtle-foreground", "readback-foreground",
  "border", "border-hairline", "input", "ring", "card", "card-foreground", "popover", "popover-foreground",
  "primary", "primary-foreground", "secondary", "secondary-foreground", "accent", "accent-foreground",
  "destructive", "destructive-foreground", "destructive-text", "success", "success-foreground", "warning", "warning-text", "attention",
  "state-hover", "state-active", "surface-raised", "surface-raised-solid", "surface-recessed", "surface-recessed-solid",
  "surface-selected", "surface-selected-border", "surface-attention", "surface-destructive", "surface-scrim",
  "sidebar", "sidebar-foreground", "sidebar-accent", "sidebar-accent-foreground", "sidebar-border",
  "file-accent", "diff-added", "diff-removed", "pr-merged", "timeline-accent",
];

function link(href: string): void {
  const element = document.createElement("link");
  element.rel = "stylesheet";
  element.href = href;
  document.head.prepend(element);
}

// Theme after the base sheet, so its anchors win; both before the applet's own styles.
link("studio://kit/theme.css");
link("studio://kit/bb.css");

const dark = matchMedia("(prefers-color-scheme: dark)");
const applyMode = () => {
  document.documentElement.classList.toggle("dark", dark.matches);
  document.documentElement.classList.toggle("light", !dark.matches);
};
applyMode();
dark.addEventListener("change", applyMode);

const theme = document.createElement("style");
theme.setAttribute("type", "text/tailwindcss");
theme.textContent = `@theme inline {\n${TOKENS.map((token) => `  --color-${token}: var(--${token});`).join("\n")}\n}\n@custom-variant dark (&:where(.dark, .dark *));`;
document.head.append(theme);

const tailwind = document.createElement("script");
tailwind.src = "studio://kit/tailwind.js";
document.head.append(tailwind);
