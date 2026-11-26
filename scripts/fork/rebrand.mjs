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
    '"thread.search",\n        "Search",\n        "Search conversations and plugin items in the quick palette.",',
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
    "apps/app/src/components/machines/machine-server-access.ts",
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
    2,
  ],
  [
    "apps/app/src/components/sidebar/SidebarUpdatesBadge.test.tsx",
    '.toContain("bb 5c1cf4e")',
    `.toContain("${NAME} 5c1cf4e")`,
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
    "apps/app/src/components/settings/UpdatesSettingsSection.tsx",
    ': "Restart and update bb automatically"',
    `: "Restart and update ${NAME} automatically"`,
  ],
  [
    "apps/app/src/components/settings/UpdatesSettingsSection.tsx",
    'description="Checks every hour and restarts bb into a new version',
    `description="Checks every hour and restarts ${NAME} into a new version`,
  ],
  [
    "apps/app/src/components/settings/UpdatesSettingsSection.tsx",
    '<RowStateCaption state="in-progress">Updating bb</RowStateCaption>',
    `<RowStateCaption state="in-progress">Updating ${NAME}</RowStateCaption>`,
  ],
  [
    "apps/app/src/components/settings/UpdatesSettingsSection.tsx",
    "isn’t compatible with this bb`",
    `isn’t compatible with this ${NAME}\``,
  ],
  [
    "apps/app/src/components/settings/UpdatesSettingsSection.tsx",
    ": `bb couldn’t activate ",
    `: \`${NAME} couldn’t activate `,
  ],
  [
    "apps/app/src/components/settings/UpdatesSettingsSection.test.tsx",
    'name: "Restart and update bb automatically",',
    `name: "Restart and update ${NAME} automatically",`,
    2,
  ],
  [
    "apps/app/src/components/settings/UpdatesSettingsSection.test.tsx",
    '.getByText("Updating bb")',
    `.getByText("Updating ${NAME}")`,
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
    'label="Hand off to new thread"',
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
  [
    "apps/app/src/components/settings/UpdatesSettingsSection.test.tsx",
    "Download the update and restart bb",
    `Download the update and restart ${NAME}`,
    11,
  ],
  [
    "apps/app/src/components/settings/UpdatesSettingsSection.test.tsx",
    "Relaunch bb to finish updating",
    `Relaunch ${NAME} to finish updating`,
    2,
  ],
  [
    "apps/app/src/components/settings/UpdatesSettingsSection.test.tsx",
    "View the failed bb update",
    `View the failed ${NAME} update`,
    2,
  ],
  [
    "apps/app/src/components/pickers/ModelReasoningPicker.test.tsx",
    '"Hand off to new thread"',
    '"Continue in a new conversation"',
    4,
  ],
  [
    "apps/app/src/components/sidebar/SidebarNavigationRail.test.tsx",
    '"Search threads"',
    '"Search"',
    5,
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
    2,
  ],
  [
    "apps/app/src/lib/localhost-link-rewrite-description.test.ts",
    "you use to open BB.",
    `you use to open ${NAME}.`,
    2,
  ],
  [
    "apps/app/src/components/sidebar/AppSidebar.tsx",
    'const BUG_REPORT_NEW_ISSUE_URL = "https://github.com/get-bb/bb/issues/new";',
    'const BUG_REPORT_NEW_ISSUE_URL = "https://github.com/patleeman/bb-studio/issues/new";',
  ],
  [
    "apps/desktop/src/menu.ts",
    'const LICENSE_URL = "https://github.com/get-bb/bb/blob/main/LICENSE";',
    'const LICENSE_URL = "https://github.com/patleeman/bb-studio/blob/main/LICENSE";',
  ],
  [
    "apps/desktop/src/menu.ts",
    'const NEW_THREAD_MENU_LABEL = "New Thread";',
    'const NEW_THREAD_MENU_LABEL = "New Conversation";',
  ],
  [
    "apps/desktop/src/menu.ts",
    "        {\n          label: UNINSTALL_MENU_LABEL,\n          click: () => {\n            void shell.openExternal(UNINSTALL_URL);\n          },\n        },\n",
    "",
  ],
  [
    "apps/desktop/src/menu.ts",
    'const UNINSTALL_MENU_LABEL = "How to Uninstall bb";\nconst UNINSTALL_URL = "https://getbb.app/uninstall";\n',
    "",
  ],
  [
    "packages/bb-app/package.json",
    '"homepage": "https://github.com/get-bb/bb#readme",\n  "bugs": {\n    "url": "https://github.com/get-bb/bb/issues"\n  },',
    '"homepage": "https://github.com/patleeman/bb-studio#readme",\n  "bugs": {\n    "url": "https://github.com/patleeman/bb-studio/issues"\n  },',
  ],
  [
    "apps/app/src/components/settings/CommunitySettingsSection.tsx",
    'const GITHUB_REPO_URL = "https://github.com/get-bb/bb";',
    'const GITHUB_REPO_URL = "https://github.com/patleeman/bb-studio";',
  ],
  [
    "apps/app/src/components/settings/CommunitySettingsSection.tsx",
    '"Source code, issues, and releases for the bb project."',
    `"Source code, issues, and releases for ${NAME}."`,
  ],
  [
    "apps/app/src/components/settings/CommunitySettingsSection.tsx",
    '"Chat with other bb users and follow development on GitHub."',
    `"Follow ${NAME} on GitHub."`,
  ],
  // bb's Discord is bb's community, not BB Studio's: the row goes.
  [
    "apps/app/src/components/settings/CommunitySettingsSection.tsx",
    'const DISCORD_INVITE_URL = "https://discord.gg/kvBU6tJhcJ";\n',
    "",
  ],
  [
    "apps/app/src/components/settings/CommunitySettingsSection.tsx",
    '        <CommunityLinkRow\n          label="Discord"\n          description="Join the server for support, feedback, and announcements."\n          href={DISCORD_INVITE_URL}\n          icon="DiscordLogo"\n          iconClassName="text-brand-discord"\n          openLabel="Join Discord"\n        />\n',
    "",
  ],
  [
    "apps/app/src/components/settings/settings-search.ts",
    '      { title: "Discord", keywords: ["chat", "support"] },\n',
    "",
  ],
  [
    "apps/app/src/components/settings/PluginChoiceSettings.tsx",
    '"Which plugin draws your threads in the sidebar."',
    '"Which plugin draws your conversations in the sidebar."',
  ],
  [
    "apps/app/src/components/settings/PluginChoiceSettings.tsx",
    '"Syntax highlighting and gutters from the bb code theme."',
    '"Syntax highlighting and gutters from the built-in code theme."',
  ],
  [
    "apps/app/src/components/settings/PluginChoiceSettings.tsx",
    '"File diffs in threads, the diff panel, and plugin views."',
    '"File diffs in conversations, the diff panel, and plugin views."',
  ],
  [
    "apps/app/src/components/settings/PluginChoiceSettings.tsx",
    '"Unified and split diffs from the bb code theme."',
    '"Unified and split diffs from the built-in code theme."',
  ],
  [
    "apps/app/src/components/settings/PluginChoiceSettings.tsx",
    'const BB_BUILT_IN = "bb (built-in)";',
    `const BB_BUILT_IN = "${NAME} (built-in)";`,
  ],
  [
    "apps/app/src/views/SettingsView.tsx",
    "Navigate to threads on creation",
    "Open new conversations",
  ],
  [
    "apps/app/src/components/settings/settings-search.ts",
    "Navigate to threads on creation",
    "Open new conversations",
  ],
  [
    "apps/app/src/components/fork/ForkAppBackdrop.layout.test.tsx",
    "Navigate to threads on creation",
    "Open new conversations",
  ],
  [
    "apps/app/src/views/SettingsView.tsx",
    "Default thread followup behavior",
    "Follow-up behavior",
  ],
  [
    "apps/app/src/components/settings/settings-search.ts",
    "Default thread followup behavior",
    "Follow-up behavior",
  ],
  [
    "apps/app/src/views/SettingsView.tsx",
    "What Enter does in the prompt box while the thread runs.",
    "What Enter does in the prompt box while the conversation runs.",
  ],
  [
    "apps/app/src/views/SettingsView.tsx",
    "Thread archive confirmation",
    "Archive confirmation",
    2,
  ],
  [
    "apps/app/src/components/settings/settings-search.ts",
    "Thread archive confirmation",
    "Archive confirmation",
  ],
  [
    "apps/app/src/views/SettingsView.tsx",
    "Ask before archiving a thread with unarchived child threads.",
    "Ask before archiving a conversation with unarchived workers.",
  ],
  [
    "apps/app/src/views/SettingsView.tsx",
    "Earlier messages stay in the thread for you to read.",
    "Earlier messages stay in the conversation for you to read.",
  ],
  [
    "apps/app/src/views/SettingsView.tsx",
    "`bb puts this in front of every branch",
    `\`${NAME} puts this in front of every branch`,
  ],
  [
    "apps/app/src/components/settings/AiServicesSettingsSection.tsx",
    'label: "Thread titles",',
    'label: "Conversation titles",',
  ],
  [
    "apps/app/src/components/settings/AiServicesSettingsSection.test.tsx",
    "Thread titles",
    "Conversation titles",
  ],
  [
    "apps/app/src/components/settings/settings-search.ts",
    "Thread titles",
    "Conversation titles",
  ],
  [
    "apps/app/src/components/settings/AiServicesSettingsSection.tsx",
    "Choose services for thread titles,",
    "Choose services for conversation titles,",
  ],
  [
    "apps/app/src/components/settings/ArchivedThreadsSettingsSection.tsx",
    '"All threads"',
    '"All conversations"',
    2,
  ],
  [
    "apps/app/src/components/settings/ArchivedThreadsSettingsSection.tsx",
    '{ label: "Threads", value: "root" },\n  { label: "Child threads", value: "child" },',
    '{ label: "Conversations", value: "root" },\n  { label: "Workers", value: "child" },',
  ],
  [
    "apps/app/src/components/settings/ArchivedThreadsSettingsSection.tsx",
    "Search archived threads",
    "Search archived conversations",
    2,
  ],
  [
    "apps/app/src/components/settings/ArchivedThreadsSettingsSection.tsx",
    "No archived threads match",
    "No archived conversations match",
    2,
  ],
  [
    "apps/app/src/components/settings/ArchivedThreadsSettingsSection.tsx",
    'threads.length === 1 ? "thread" : "threads"',
    'threads.length === 1 ? "conversation" : "conversations"',
  ],
  [
    "apps/app/src/components/app-update/app-update-presentation.ts",
    '"All threads are idle; updating shortly"',
    '"All conversations are idle; updating shortly"',
  ],
  [
    "apps/app/src/lib/app-command-metadata.ts",
    'label: "Threads",\n    commands: [',
    'label: "Conversations",\n    commands: [',
  ],
  [
    "apps/app/src/lib/app-command-metadata.ts",
    '"Rename thread", "Rename the focused thread."',
    '"Rename conversation", "Rename the focused conversation."',
  ],
  [
    "apps/app/src/lib/app-command-metadata.ts",
    '"Archive thread",\n        "Archive the focused thread.",',
    '"Archive conversation",\n        "Archive the focused conversation.",',
  ],
  [
    "apps/app/src/lib/app-command-metadata.ts",
    '"Mark thread read or unread",\n        "Mark the focused thread read or unread.",',
    '"Mark conversation read or unread",\n        "Mark the focused conversation read or unread.",',
  ],
  [
    "apps/app/src/lib/app-command-metadata.ts",
    '"Pin or unpin thread",\n        "Pin or unpin the focused thread.",',
    '"Pin or unpin conversation",\n        "Pin or unpin the focused conversation.",',
  ],
  [
    "apps/app/src/lib/app-command-metadata.ts",
    '"Previous thread",\n        "Open the previous visible sidebar thread.",',
    '"Previous conversation",\n        "Open the previous visible sidebar conversation.",',
  ],
  [
    "apps/app/src/lib/app-command-metadata.ts",
    '"Next thread",\n        "Open the next visible sidebar thread.",',
    '"Next conversation",\n        "Open the next visible sidebar conversation.",',
  ],
  [
    "apps/app/src/lib/app-command-metadata.ts",
    "`Open thread ${index + 1}`,\n          `Open visible sidebar thread ${index + 1}.`,",
    "`Open conversation ${index + 1}`,\n          `Open visible sidebar conversation ${index + 1}.`,",
  ],
  [
    "apps/app/src/lib/app-command-metadata.ts",
    '"Search and run bb commands from the keyboard."',
    '"Search and run commands from the keyboard."',
  ],
  [
    "apps/app/src/lib/app-command-metadata.ts",
    '"Open another bb desktop window."',
    `"Open another ${NAME} window."`,
  ],
  [
    "apps/app/src/lib/app-command-metadata.ts",
    '"Search the text shown in the current bb desktop window."',
    `"Search the text shown in the current ${NAME} window."`,
  ],
  [
    "apps/app/src/lib/app-command-metadata.ts",
    '"Reload the current bb desktop window."',
    `"Reload the current ${NAME} window."`,
  ],
  [
    "apps/app/src/lib/app-command-metadata.ts",
    '"Open bb settings."',
    `"Open ${NAME} settings."`,
  ],
  [
    "apps/app/src/lib/app-command-metadata.ts",
    '"Open settings to add or manage bb servers."',
    `"Open settings to add or manage ${NAME} servers."`,
  ],
  [
    "apps/app/src/lib/app-command-metadata.ts",
    "Reveal the bb data directory",
    `Reveal the ${NAME} data directory`,
  ],
  [
    "apps/app/src/lib/app-command-metadata.ts",
    "Plugins included with bb keep running.",
    `Plugins included with ${NAME} keep running.`,
  ],
  [
    "apps/app/src/lib/app-command-metadata.ts",
    "left by earlier bb releases.",
    "left by earlier releases.",
  ],
  [
    "apps/app/src/lib/app-command-metadata.ts",
    "when bb asks a question.",
    "when the agent asks a question.",
  ],
  [
    "apps/app/src/components/settings/KeyboardSettingsSection.tsx",
    "Changes sync to every bb window.",
    `Changes sync to every ${NAME} window.`,
  ],
  [
    "apps/app/src/components/settings/ProvidersSettingsSection.tsx",
    "Choose which agents you use in BB.",
    `Choose which agents you use in ${NAME}.`,
  ],
  [
    "apps/app/src/components/settings/ProvidersSettingsSection.tsx",
    "Threads keep their history and pick up on your next message.",
    "Conversations keep their history and pick up on your next message.",
  ],
  [
    "apps/app/src/components/settings/PluginChoiceSettings.tsx",
    "The prompt box in threads, the New thread screen, and message editors.",
    "The prompt box in conversations, the New conversation screen, and message editors.",
  ],
  [
    "apps/app/src/components/settings/PluginChoiceSettings.tsx",
    "What draws New thread, Plugins,",
    "What draws New conversation, Plugins,",
  ],
  [
    "apps/app/src/components/settings/PluginChoiceSettings.tsx",
    "Sidebar thread list",
    "Sidebar conversation list",
  ],
  [
    "apps/app/src/components/settings/useSettingsSearchConditions.ts",
    "Sidebar thread list",
    "Sidebar conversation list",
  ],
  [
    "apps/app/src/lib/pinned-replacement-surfaces.test.tsx",
    "Sidebar thread list",
    "Sidebar conversation list",
  ],
  [
    "apps/app/src/components/settings/settings-search.ts",
    "Sidebar thread list",
    "Sidebar conversation list",
  ],
  [
    "apps/app/src/views/SettingsView.tsx",
    "Palettes change bb's colors",
    `Palettes change ${NAME}'s colors`,
  ],
  [
    "apps/app/src/components/thread/ThreadActionsMenu.tsx",
    'const MENU_LABEL = "Thread actions";',
    'const MENU_LABEL = "Conversation actions";',
  ],
  [
    "apps/app/src/views/thread-detail/ThreadDetailView.tsx",
    'aria-label="Thread actions"',
    'aria-label="Conversation actions"',
  ],
  [
    "apps/app/src/components/promptbox/ThreadEnvironmentSummary.tsx",
    "New thread in this environment",
    "New conversation in this workspace",
    2,
  ],
  [
    "apps/app/src/components/promptbox/ThreadEnvironmentSummary.test.tsx",
    "New thread in this environment",
    "New conversation in this workspace",
    2,
  ],
  [
    "apps/app/src/components/pickers/ProjectSelector.tsx",
    '(noProjectSelected ? "No project" : "Work in a project")',
    '(noProjectSelected ? "Personal workspace" : "Work in a project")',
  ],
  [
    "apps/app/src/components/pickers/ProjectSelector.tsx",
    '(allProjectsSelected ? "All projects" : "No project")',
    '(allProjectsSelected ? "All projects" : "Personal workspace")',
  ],
  [
    "apps/app/src/components/pickers/ProjectSelector.test.tsx",
    '"Project: No project"',
    '"Project: Personal workspace"',
    2,
  ],
  [
    "apps/app/src/components/pickers/ProjectSelector.test.tsx",
    ').toBe("No project");',
    ').toBe("Personal workspace");',
    2,
  ],
  [
    "plugins/provider-codex/package.json",
    "Run bb threads with Codex.",
    "Run conversations with Codex.",
    2,
  ],
  [
    "plugins/provider-claude-code/package.json",
    "Run bb threads with Claude Code.",
    "Run conversations with Claude Code.",
    2,
  ],
  [
    "plugins/provider-pi/package.json",
    "Run bb threads with Pi.",
    "Run conversations with Pi.",
    2,
  ],
  [
    "plugins/provider-acp/package.json",
    "Run bb threads with ACP agents",
    "Run conversations with ACP agents",
    2,
  ],
  [
    "plugins/push-notifications/package.json",
    "Notifications for threads that need attention",
    "Notifications for conversations that need attention",
    2,
  ],
  [
    "plugins/push-notifications/server.ts",
    '"Child thread notifications"',
    '"Worker notifications"',
  ],
  [
    "plugins/push-notifications/server.ts",
    "For threads you haven't set.",
    "For conversations you haven't set.",
  ],
  [
    "plugins/push-notifications/server.ts",
    "For child threads you haven't set. A thread's level also limits its child threads.",
    "For workers you haven't set. A conversation's level also limits its workers.",
  ],
  [
    "plugins/push-notifications/app.tsx",
    "Click a notification to open its thread.",
    "Click a notification to open its conversation.",
  ],
  [
    "plugins/push-notifications/app.tsx",
    "Channel settings apply to this bb server.",
    `Channel settings apply to this ${NAME} server.`,
  ],
  [
    "apps/app/src/components/settings/settings-search.test.ts",
    '"Archived conversations",\n      "General › App links",',
    '"Archived conversations",\n      "General › Archive confirmation",',
  ],
  [
    "apps/app/src/components/settings/KeyboardSettingsSection.test.tsx",
    "Record shortcut for Previous thread",
    "Record shortcut for Previous conversation",
  ],
  [
    "apps/app/src/components/settings/KeyboardSettingsSection.test.tsx",
    "Record shortcut for Rename thread,",
    "Record shortcut for Rename conversation,",
    2,
  ],
  [
    "apps/app/src/components/settings/KeyboardSettingsSection.test.tsx",
    "Open thread 1",
    "Open conversation 1",
    6,
  ],
  [
    "apps/app/src/components/settings/AiServicesSettingsSection.test.tsx",
    '"Test thread titles"',
    '"Test conversation titles"',
    3,
  ],
  [
    "apps/app/src/components/commands/ForkCommandPalette.test.tsx",
    'expect(newThread.dataset.group).toBe("Threads");',
    'expect(newThread.dataset.group).toBe("Conversations");',
  ],
  [
    "apps/app/src/lib/command-palette/palette-app-commands.test.ts",
    'bucket: "Threads",\n      group: "Threads",',
    'bucket: "Threads",\n      group: "Conversations",',
  ],
  [
    "apps/app/src/lib/command-palette/palette-app-commands.ts",
    'bucket: group.label === "Threads" ? "Threads" : "Actions",',
    'bucket: group.label === "Conversations" ? "Threads" : "Actions",',
  ],
  [
    "plugins/push-notifications/server.ts",
    "while bb is open in a browser",
    `while ${NAME} is open in a browser`,
  ],
  [
    "plugins/push-notifications/server.ts",
    "while the bb desktop app is running",
    `while the ${NAME} desktop app is running`,
  ],
  [
    "apps/app/src/views/thread-detail/ThreadDetailPromptArea.tsx",
    'submitLabel: "New thread",\n            submitIcon: "MessageSquarePlus",\n            submitTitle: "Create new thread (Enter)",',
    'submitLabel: "Send",\n            submitIcon: "MessageSquarePlus",\n            submitTitle: "Send in a new conversation (Enter)",',
  ],
  [
    "apps/app/src/views/thread-detail/ThreadDetailPromptArea.test.tsx",
    '.textContent).toBe("New thread");',
    '.textContent).toBe("Send");',
    6,
  ],
  [
    "apps/app/src/views/thread-detail/ThreadDetailPromptArea.test.tsx",
    '.textContent).toBe(\n          "New thread",\n        ),',
    '.textContent).toBe(\n          "Send",\n        ),',
  ],
  [
    "apps/app/src/views/thread-detail/ThreadDetailPromptArea.test.tsx",
    '"Create new thread (Enter)",',
    '"Send in a new conversation (Enter)",',
  ],
  // Studio's CLI is `bbs` (alias `bb-studio`); stock bb keeps `bb`.
  // packages/config/src/studio-cli.fork.ts has the names and the env guard.
  ["apps/cli/src/index.ts", '.name("bb")', '.name("bbs")'],
  [
    "apps/cli/src/index.ts",
    '.description("BB CLI - manage your AI coding agents")',
    `.description("${NAME} CLI (bbs, also bb-studio) - manage your AI coding agents")`,
  ],
  [
    "apps/cli/src/index.ts",
    "  bb status\n  bb project list\n  bb thread show <id>\n  bb thread spawn ",
    "  bbs status\n  bbs project list\n  bbs thread show <id>\n  bbs thread spawn ",
  ],
  [
    "apps/cli/src/index.ts",
    "`bb ${candidate} is provided by the",
    "`bbs ${candidate} is provided by the",
  ],
  [
    "apps/cli/src/index.ts",
    "`run \\`bb plugin enable ${disabledId}\\`",
    "`run \\`bbs plugin enable ${disabledId}\\`",
  ],
  [
    "apps/cli/src/commands/guide.ts",
    "const head = [`bb ${names.join(\"\")}`",
    "const head = [`bbs ${names.join(\"\")}`",
  ],
  [
    "apps/cli/src/commands/guide.ts",
    '"\\nRun `bb guide commands <group>` (for example `bb guide commands thread`) to include every option. Commands contributed by plugins are listed by `bb plugin list`.",',
    '"\\nRun `bbs guide commands <group>` (for example `bbs guide commands thread`) to include every option. Commands contributed by plugins are listed by `bbs plugin list`.",',
  ],
  [
    "apps/cli/src/commands/guide.ts",
    '"Show the BB system overview and CLI guide; `bb guide commands [group]` lists every core command on one page",',
    `"Show the ${NAME} overview and CLI guide; \`bbs guide commands [group]\` lists every core command on one page",`,
  ],
  [
    "apps/server/src/services/system/cli-command.ts",
    "`bb is already on your PATH at ${shadow.path}, installed by npm.`,",
    "`bbs is already on your PATH at ${shadow.path}, installed by npm.`,",
  ],
  [
    "apps/server/src/services/system/cli-command.ts",
    "`Another bb at ${shadow.path} comes first on your PATH. Remove it, or run bb's command directly at ${context.launcherPath}.`,",
    `\`Another bbs at \${shadow.path} comes first on your PATH. Remove it, or run ${NAME}'s command directly at \${context.launcherPath}.\`,`,
  ],
  [
    "apps/server/src/services/system/cli-command.ts",
    "`Another bb command is already installed, or no folder on your PATH is writable. Run bb's command directly at ${context.launcherPath}.`,",
    `\`Another bbs command is already installed, or no folder on your PATH is writable. Run ${NAME}'s command directly at \${context.launcherPath}.\`,`,
  ],
  [
    "apps/app/src/components/settings/CliCommandSettingsSection.tsx",
    'const CLI_COMMAND_SETTING_LABEL = "bb CLI";',
    'const CLI_COMMAND_SETTING_LABEL = "bbs CLI";',
  ],
  [
    "apps/app/src/components/settings/CliCommandSettingsSection.tsx",
    "? `Installed at ${status.installedPath}. You can control bb from any terminal, and so can agents outside bb, such as Claude Code or Codex.`",
    `? \`Installed at \${status.installedPath} as bbs and bb-studio. bb is left as it is.\``,
  ],
  [
    "apps/app/src/components/settings/CliCommandSettingsSection.tsx",
    ": `Installed at ${status.installedPath}, but its folder is not on your PATH. Add the folder to your PATH to use bb outside bb.`;",
    ": `Installed at ${status.installedPath}, but its folder is not on your PATH.`;",
  ],
  [
    "apps/app/src/components/settings/CliCommandSettingsSection.tsx",
    '"Install the bb CLI for use outside bb. You can control bb from any terminal, and so can agents outside bb, such as Claude Code or Codex. Threads in bb already have it.";',
    `"Installs bbs and bb-studio for terminals and outside agents. bb is left as it is. Conversations in ${NAME} already have bbs and bb.";`,
  ],
  [
    "apps/app/src/components/settings/CliCommandSettingsSection.tsx",
    "return `Already installed for use outside bb at ${status.shadowedBy.path}, by npm.`;",
    "return `bbs is already installed at ${status.shadowedBy.path}, by npm.`;",
  ],
  [
    "apps/app/src/components/settings/CliCommandSettingsSection.tsx",
    "return `The bb machine on this computer added a bb at ${status.shadowedBy.path} that can run an older bb. Install replaces it with this one.`;",
    "return `The machine on this computer added a bbs at ${status.shadowedBy.path} that can run an older bbs. Install replaces it with this one.`;",
  ],
  [
    "apps/app/src/components/settings/CliCommandSettingsSection.tsx",
    "return `Another bb at ${status.shadowedBy.path} comes first on your PATH. Remove it to install this one.`;",
    "return `Another bbs at ${status.shadowedBy.path} comes first on your PATH. Remove it to install this one.`;",
  ],
  [
    "apps/cli/src/__tests__/startup-graph.test.ts",
    'expect(run.stdout).toContain("Usage: bb thread");',
    'expect(run.stdout).toContain("Usage: bbs thread");',
    2,
  ],
  [
    "apps/cli/src/__tests__/cli-entry-errors.e2e.test.ts",
    'toContain("Usage: bb machine");',
    'toContain("Usage: bbs machine");',
  ],
  [
    "apps/cli/src/__tests__/command-output/guide.test.ts",
    '"bb terminal output|read <terminalId>',
    '"bbs terminal output|read <terminalId>',
  ],
  [
    "apps/cli/src/__tests__/command-output/guide.test.ts",
    'toContain("bb thread tell|message|send <id> [message]\\n");',
    'toContain("bbs thread tell|message|send <id> [message]\\n");',
  ],
  [
    "apps/cli/src/__tests__/command-output/guide.test.ts",
    'toContain("bb guide commands <group>");',
    'toContain("bbs guide commands <group>");',
  ],
  [
    "apps/app/src/components/settings/settings-search.ts",
    'title: "bb CLI",\n        keywords: ["command line", "terminal", "path", "install"],',
    'title: "bbs CLI",\n        keywords: ["command line", "terminal", "path", "install", "bbs", "bb-studio"],',
  ],
  [
    "apps/cli/src/command-resolution.ts",
    "return target === null ? null : `bb ${target}`;",
    "return target === null ? null : `bbs ${target}`;",
  ],
  [
    "apps/cli/src/command-resolution.ts",
    "return `bb ${[...invocation.path, match].join(\" \")}`;",
    "return `bbs ${[...invocation.path, match].join(\" \")}`;",
  ],
  [
    "apps/cli/src/command-resolution.ts",
    'const prefix = ["bb", ...invocation.path].join(" ");',
    'const prefix = ["bbs", ...invocation.path].join(" ");',
  ],
  [
    "apps/cli/src/commander-errors.ts",
    '"List desktop browser instances with `bb browser instances --host <id> --json`."',
    '"List desktop browser instances with `bbs browser instances --host <id> --json`."',
  ],
  [
    "apps/cli/src/commander-errors.ts",
    '"List project IDs with `bb project list`."',
    '"List project IDs with `bbs project list`."',
  ],
  [
    "apps/cli/src/commander-errors.ts",
    '"List thread IDs with `bb thread list`."',
    '"List thread IDs with `bbs thread list`."',
  ],
  [
    "apps/cli/src/commander-errors.ts",
    '"List terminal IDs with `bb terminal list --thread <id>`."',
    '"List terminal IDs with `bbs terminal list --thread <id>`."',
  ],
  [
    "apps/cli/src/commander-errors.ts",
    "`List this thread's terminal IDs with \\`bb terminal list --thread ${threadId}\\`.`",
    "`List this thread's terminal IDs with \\`bbs terminal list --thread ${threadId}\\`.`",
  ],
  [
    "apps/cli/src/commander-errors.ts",
    "check \\`bb plugin list\\`.`",
    "check \\`bbs plugin list\\`.`",
  ],
];
for (const [file, from, to, expected = 1] of replacements) {
  const target = join(root, file);
  const before = readFileSync(target, "utf8");
  const found = before.split(from).length - 1;
  if (found !== expected) {
    console.error(
      `${found === 0 ? "NOT FOUND" : "UNEXPECTED COUNT"} ${file}: ${found} of ${expected} expected: ${from}`,
    );
    process.exitCode = 1;
    continue;
  }
  const after = before.replaceAll(from, to);
  if (!to.includes(from) && after.includes(from)) {
    console.error(`STILL PRESENT ${file}: ${from}`);
    process.exitCode = 1;
    continue;
  }
  writeFileSync(target, after);
}
execFileSync("node", ["scripts/generate-pwa-icons.mjs"], {
  cwd: join(root, "apps/app"),
  stdio: "inherit",
});
console.log(`rebranded ${icons} icons and ${manifests} manifests as ${NAME}`);
