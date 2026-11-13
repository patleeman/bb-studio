import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const publicDir = join(root, "apps/app/public");
const source = join(root, "scripts/fork/brand/icon.png");
const NAME = "BB Studio";

function pixelWidth(file) {
  const output = execFileSync("sips", ["-g", "pixelWidth", file], {
    encoding: "utf8",
  });
  return Number(/pixelWidth: (\d+)/u.exec(output)?.[1]);
}

let icons = 0;
for (const file of readdirSync(publicDir)) {
  if (!file.endsWith(".png") || file.includes("monochrome")) continue;
  if (!/^(favicon|apple-touch-icon|icon-)/u.test(file)) continue;
  if (/-(blue|green|orange|pink|purple|red|teal|yellow)\.png$/u.test(file)) {
    continue;
  }
  const target = join(publicDir, file);
  const size = pixelWidth(target);
  if (!Number.isFinite(size) || size <= 0) continue;
  execFileSync(
    "sips",
    ["-z", String(size), String(size), source, "--out", target],
    {
      stdio: "ignore",
    },
  );
  icons += 1;
}

let manifests = 0;
for (const file of ["manifest.webmanifest"]) {
  const target = join(publicDir, file);
  const manifest = JSON.parse(readFileSync(target, "utf8"));
  manifest.name = NAME;
  manifest.short_name = NAME;
  writeFileSync(target, `${JSON.stringify(manifest, null, 2)}\n`);
  manifests += 1;
}

const replacements = [
  ["apps/app/index.html", "<title>bb</title>", `<title>${NAME}</title>`],
  [
    "apps/app/index.html",
    '<meta name="apple-mobile-web-app-title" content="bb" />',
    `<meta name="apple-mobile-web-app-title" content="${NAME}" />`,
  ],
  [
    "apps/desktop/src/main.ts",
    'message: "Starting local services and opening the bb workspace.",\n        title: "Opening bb",',
    `message: "Starting local services and opening ${NAME}.",\n        title: "Opening ${NAME}",`,
  ],
  [
    "apps/app/src/components/layout/AppLayout.tsx",
    '"/": { title: "bb" },',
    `"/": { title: "${NAME}" },`,
  ],
  [
    "apps/app/src/components/plugin/browse-hero/BrowseHeroCarousel.tsx",
    'ariaLabel: "What you can build with bb plugins",',
    `ariaLabel: "What you can build with ${NAME} plugins",`,
  ],
  [
    "apps/app/src/components/plugin/browse-hero/BrowseHeroCarousel.tsx",
    'headlineLead: "Turn bb into",',
    `headlineLead: "Turn ${NAME} into",`,
  ],
  [
    "apps/app/src/components/plugin/browse-hero/BrowseHeroCarousel.tsx",
    'frameTitlePrefix: "bb — ",',
    `frameTitlePrefix: "${NAME} — ",`,
  ],
  [
    "apps/app/src/components/plugin/plugins-collection-copy.ts",
    '"Discover plugins for bb. Install one,',
    `"Discover plugins for ${NAME}. Install one,`,
  ],
  [
    "apps/app/src/components/plugin/plugins-collection-copy.ts",
    '"The plugins installed on this bb host.',
    `"The plugins installed on this ${NAME} host.`,
  ],
  [
    "apps/app/src/lib/app-command-metadata.ts",
    '"New thread",\n        "Start a thread in the active project.",',
    '"New conversation",\n        "Start a conversation in the active project.",',
  ],
  [
    "apps/app/src/components/sidebar/sidebarNavigationItems.ts",
    'hostRow(NEW_THREAD_NAVIGATION_ITEM_ID, "New thread",',
    'hostRow(NEW_THREAD_NAVIGATION_ITEM_ID, "New conversation",',
  ],
  [
    "apps/app/src/lib/app-command-metadata.ts",
    '"thread.search",\n        "Search threads",\n        "Search threads in the quick palette.",',
    '"thread.search",\n        "Search",\n        "Search threads and plugin items in the quick palette.",',
  ],
  [
    "apps/app/src/components/commands/ThreadSearchPalettePlaceholder.tsx",
    'placeholder: "Search title, project, or message…",',
    'placeholder: "Search threads, pages and items…",',
  ],
  [
    "apps/app/src/components/commands/ThreadSearchPalettePlaceholder.tsx",
    'label: "Threads",\n    clearLabel: "Return to commands",',
    'label: "Search",\n    clearLabel: "Return to commands",',
  ],
];
for (const [file, from, to] of replacements) {
  const target = join(root, file);
  const before = readFileSync(target, "utf8");
  if (before.includes(to)) continue;
  if (!before.includes(from)) {
    console.error(`NOT FOUND ${file}: ${from}`);
    process.exitCode = 1;
    continue;
  }
  writeFileSync(target, before.replace(from, to));
}
execFileSync("node", ["scripts/generate-pwa-icons.mjs"], {
  cwd: join(root, "apps/app"),
  stdio: "inherit",
});
console.log(`rebranded ${icons} icons and ${manifests} manifests as ${NAME}`);
