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
    "apps/desktop/src/local-view.ts",
    "<title>bb</title>",
    `<title>${NAME}</title>`,
  ],
  [
    "apps/desktop/src/log-viewer.ts",
    "<title>bb - Local Logs</title>",
    `<title>${NAME} - Local Logs</title>`,
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
  [
    "apps/app/src/components/thread/ThreadActionsProvider.tsx",
    '? "Thread archived"\n          : "Threads archived",',
    '? "Conversation archived"\n          : "Conversations archived",',
  ],
  [
    "apps/app/src/views/SettingsView.tsx",
    'description="Open web links inside bb."',
    `description="Open web links inside ${NAME}."`,
  ],
  [
    "apps/app/src/components/tools/PluginDetail.tsx",
    '? "Updates with bb"',
    `? "Updates with ${NAME}"`,
  ],
  [
    "apps/app/src/components/settings/AiServicesSettingsSection.tsx",
    '"Nothing bb ships is ready right now."',
    `"Nothing ${NAME} ships is ready right now."`,
  ],
  [
    "apps/app/src/components/settings/AiServicesSettingsSection.tsx",
    '" Nothing is ready, so bb falls back."',
    `" Nothing is ready, so ${NAME} falls back."`,
  ],
  [
    "apps/app/src/components/settings/AiServicesSettingsSection.tsx",
    "Automatic prefers bb cloud, then other available services.",
    "Automatic tries the conversation's own provider first, then other signed-in services.",
  ],
  [
    "apps/app/src/components/promptbox/follow-up-placeholder.ts",
    '"Ask for a follow-up. @ to mention files, folders, sections, or threads"',
    '"Ask for a follow-up. @ to mention files, folders, sections, or conversations"',
  ],
  [
    "apps/app/src/components/thread/ThreadActionsProvider.test.tsx",
    'source === "single" ? "Thread archived" : "Threads archived",',
    'source === "single" ? "Conversation archived" : "Conversations archived",',
  ],
  [
    "apps/app/src/components/thread/ThreadActionsProvider.test.tsx",
    'calls[0]?.[0]).toBe(\n      "Thread archived",',
    'calls[0]?.[0]).toBe(\n      "Conversation archived",',
  ],
  [
    "apps/app/src/components/settings/MachinesSettingsSection.tsx",
    'aria-label="About the bb server"',
    `aria-label="About the ${NAME} server"`,
  ],
  [
    "apps/app/src/components/settings/MachinesSettingsSection.tsx",
    "All your machines connect to one central bb server, where your\n              threads and settings are stored.",
    `All your machines connect to one central ${NAME} server, where your\n              conversations and settings are stored.`,
  ],
  [
    "apps/app/src/components/settings/MachineAccessSettings.tsx",
    "Choose how your devices reach this bb server.",
    `Choose how your devices reach this ${NAME} server.`,
  ],
  [
    "apps/app/src/components/machines/machine-server-access.ts",
    '"Configure how machines should connect to this bb server."',
    `"Configure how machines should connect to this ${NAME} server."`,
  ],
  [
    "apps/app/src/components/machines/machine-server-access.test.ts",
    '"Configure how machines should connect to this bb server."',
    `"Configure how machines should connect to this ${NAME} server."`,
  ],
  [
    "apps/app/src/components/dialogs/AddMachineDialog.tsx",
    '"The new machine will connect to your bb server.',
    `"The new machine will connect to your ${NAME} server.`,
  ],
  [
    "apps/app/src/components/dialogs/AddMachineDialog.tsx",
    "`The new machine will connect to the bb server on ${serverMachineName}.",
    `\`The new machine will connect to the ${NAME} server on \${serverMachineName}.`,
  ],
  [
    "apps/app/src/components/dialogs/AddMachineDialog.test.tsx",
    '"The new machine will connect to the bb server on Mac mini.',
    `"The new machine will connect to the ${NAME} server on Mac mini.`,
  ],
  [
    "apps/app/src/components/dialogs/AddMachineDialog.test.tsx",
    '"The new machine will connect to your bb server.',
    `"The new machine will connect to your ${NAME} server.`,
  ],
  [
    "apps/app/src/components/ui/bb-logo.tsx",
    'import bbLogoUrl from "../../../../../assets/bb-logo.svg";',
    'const bbLogoUrl = "/icon-192.png";',
  ],
  [
    "apps/app/src/components/ui/bb-logo.tsx",
    '"object-contain dark:invert"',
    '"rounded-[22%] object-contain"',
  ],
  [
    "apps/app/src/components/sidebar/SidebarUpdatesBadge.tsx",
    '<section aria-label="bb update">',
    `<section aria-label="${NAME} update">`,
  ],
  [
    "apps/app/src/components/sidebar/SidebarUpdatesBadge.tsx",
    '{bb.version === null ? "bb update" : `bb ${bb.version}`}',
    `{bb.version === null ? "${NAME} update" : \`${NAME} \${bb.version}\`}`,
  ],
  [
    "apps/app/src/components/sidebar/SidebarUpdatesBadge.tsx",
    '"Installs when bb restarts"',
    `"Installs when ${NAME} restarts"`,
  ],
  [
    "apps/app/src/components/sidebar/SidebarUpdatesBadge.test.tsx",
    '{ name: "bb update" }',
    `{ name: "${NAME} update" }`,
  ],
  [
    "apps/app/src/components/sidebar/SidebarUpdatesBadge.test.tsx",
    '"Installs when bb restarts"',
    `"Installs when ${NAME} restarts"`,
  ],
  [
    "apps/app/src/components/settings/UpdatesSettingsSection.tsx",
    'actionLabel="Relaunch bb to finish updating"',
    `actionLabel="Relaunch ${NAME} to finish updating"`,
  ],
  [
    "apps/app/src/components/settings/UpdatesSettingsSection.tsx",
    'mobileTitle="Update bb"',
    `mobileTitle="Update ${NAME}"`,
  ],
  [
    "apps/app/src/components/settings/UpdatesSettingsSection.tsx",
    'actionLabel="Download the update and restart bb"',
    `actionLabel="Download the update and restart ${NAME}"`,
  ],
  [
    "apps/app/src/components/settings/UpdatesSettingsSection.tsx",
    'openLabel="View the failed bb update"',
    `openLabel="View the failed ${NAME} update"`,
  ],
  [
    "apps/app/src/components/app-update/useStartAppUpdate.tsx",
    'title="Update bb now?"',
    `title="Update ${NAME} now?"`,
  ],
  [
    "apps/app/src/components/settings/ApplicationLinkApprovalsSettings.tsx",
    'description="BB asks before opening links',
    `description="${NAME} asks before opening links`,
  ],
  [
    "apps/app/src/lib/localhost-link-rewrite-description.ts",
    "you use to open BB.",
    `you use to open ${NAME}.`,
  ],
  [
    "apps/app/src/components/sidebar/sidebarNavigationItems.ts",
    'hostRow(SEARCH_THREADS_NAVIGATION_ITEM_ID, "Search threads",',
    'hostRow(SEARCH_THREADS_NAVIGATION_ITEM_ID, "Search",',
  ],
  [
    "apps/app/src/components/settings/settings-sections.ts",
    'label: "Archived threads" }',
    'label: "Archived conversations" }',
  ],
  [
    "apps/app/src/components/settings/settings-search.test.ts",
    '"Archived threads",',
    '"Archived conversations",',
  ],
  [
    "apps/app/src/components/settings/ArchivedThreadsSettingsSection.tsx",
    "          Archived threads\n        </h2>",
    "          Archived conversations\n        </h2>",
  ],
  [
    "apps/app/src/components/settings/ArchivedThreadsSettingsSection.tsx",
    "Find and restore archived threads from across your projects.",
    "Find and restore archived conversations from across your projects.",
  ],
  [
    "apps/app/src/views/SettingsView.tsx",
    '<SettingsSection title="Threads & editing">',
    '<SettingsSection title="Conversations & editing">',
  ],
  [
    "apps/app/src/components/promptbox/FollowUpPromptBox.tsx",
    "<span>Handoff to new thread</span>",
    "<span>Continue in a new conversation</span>",
  ],
  [
    "apps/app/src/components/promptbox/FollowUpPromptBox.test.tsx",
    'getByText("Handoff to new thread")',
    'getByText("Continue in a new conversation")',
  ],
  [
    "apps/app/src/components/pickers/ModelReasoningMenu.tsx",
    'label="Handoff to new thread"',
    'label="Continue in a new conversation"',
  ],
  [
    "apps/app/src/components/pickers/ModelReasoningPicker.tsx",
    'mobileTitle={handoffMode ? "Handoff to new thread" : "Model"}',
    'mobileTitle={handoffMode ? "Continue in a new conversation" : "Model"}',
  ],
  [
    "apps/app/src/components/pickers/ModelReasoningPicker.tsx",
    "        Handoff to new thread\n      </span>",
    "        Continue in a new conversation\n      </span>",
  ],
  [
    "apps/app/src/components/secondary-panel/thread-info-registration.tsx",
    'tooltip: "Thread info",',
    'tooltip: "Conversation info",',
  ],
];
const everywhere = [
  [
    "apps/app/src/components/settings/UpdatesSettingsSection.test.tsx",
    "Download the update and restart bb",
    `Download the update and restart ${NAME}`,
  ],
  [
    "apps/app/src/components/settings/UpdatesSettingsSection.test.tsx",
    "Relaunch bb to finish updating",
    `Relaunch ${NAME} to finish updating`,
  ],
  [
    "apps/app/src/components/settings/UpdatesSettingsSection.test.tsx",
    "View the failed bb update",
    `View the failed ${NAME} update`,
  ],
  [
    "apps/app/src/components/pickers/ModelReasoningPicker.test.tsx",
    '"Handoff to new thread"',
    '"Continue in a new conversation"',
  ],
  [
    "apps/app/src/components/sidebar/SidebarNavigationRail.test.tsx",
    '"Search threads"',
    '"Search"',
  ],
  [
    "apps/app/src/components/sidebar/SidebarNavigationList.test.tsx",
    '"Search threads"',
    '"Search"',
  ],
  [
    "apps/app/src/components/sidebar/SidebarNavigationRail.test.tsx",
    "{ name: /Search threads/u }",
    "{ name: /Show Search in sidebar/u }",
  ],
  [
    "apps/app/src/components/sidebar/SidebarNavigationRail.test.tsx",
    '"Show Search threads in sidebar"',
    '"Show Search in sidebar"',
  ],
  [
    "apps/app/src/components/sidebar/SidebarUpdatesBadge.test.tsx",
    '"bb 0.49.0"',
    `"${NAME} 0.49.0"`,
  ],
  [
    "apps/app/src/lib/localhost-link-rewrite-description.test.ts",
    "you use to open BB.",
    `you use to open ${NAME}.`,
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
for (const [file, from, to] of everywhere) {
  const target = join(root, file);
  const before = readFileSync(target, "utf8");
  if (!before.includes(from)) {
    if (before.includes(to)) continue;
    console.error(`NOT FOUND ${file}: ${from}`);
    process.exitCode = 1;
    continue;
  }
  writeFileSync(target, before.replaceAll(from, to));
}
execFileSync("node", ["scripts/generate-pwa-icons.mjs"], {
  cwd: join(root, "apps/app"),
  stdio: "inherit",
});
console.log(`rebranded ${icons} icons and ${manifests} manifests as ${NAME}`);
