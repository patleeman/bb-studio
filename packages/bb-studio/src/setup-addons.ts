// BB Studio's add-ons, copied from the repository's marketplace.json so
// Studio knows them without a network call. setup.test.ts fails when
// this list drifts from marketplace.json; copy the entries over when it does.
// Marketplace entries for retired plugins (setup.ts RETIRED), such as an
// upgrade bridge kept installable for existing users, are left out.

/** The marketplace these add-ons install from (marketplace.json "name"). */
export const MARKETPLACE_NAME = "bb-studio";
/** The source `bb marketplace add` takes for it. */
export const MARKETPLACE_SOURCE = "git:github.com/patleeman/bb-studio@main";

export interface AddOn {
  id: string;
  displayName: string;
  description: string;
}

export const ADDONS: readonly AddOn[] = [
  { id: "studio", displayName: "Studio", description: "The home of BB Studio, with pages, recordings, drawings, designs and artifacts built in: one collection with search, tags, project leads, item conversations and quotes." },
  { id: "mobile", displayName: "Studio Mobile", description: "Part of BB Studio. The server side of the BB Studio iOS app: push notifications with lock-screen actions and muted threads." },
  { id: "emoji-react", displayName: "Studio Reactions", description: "Part of BB Studio. Emoji reactions on replies: pick one from the text selection menu or the bar under a message, and it drafts your answer." },
  { id: "smart-decisions", displayName: "Studio Decisions", description: "Part of BB Studio. One place to set up the fast Jev model that makes quick decisions. It runs Smart Queue, which steers or queues a message you send to a busy thread, and other plugins can ask it for quick decisions." },
  { id: "studio-code", displayName: "Studio Code", description: "Part of BB Studio. VS Code workspaces in your projects: open one or more folders in a full editor, run by a local code-server." },
  { id: "applets", displayName: "Studio Applets", description: "Part of BB Studio. Experimental. Small native macOS apps your agents write as plain folders, such as a HUD of running threads, run by one signed Studio Applets app. Applets reach the desktop and BB only through an API you approve." },
];
