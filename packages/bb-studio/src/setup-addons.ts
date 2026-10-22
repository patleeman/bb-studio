// BB Studio's add-ons, copied from the repository's marketplace.json so
// Studio knows them without a network call. setup.test.ts fails when
// this list drifts from marketplace.json; copy the entries over when it does.
// Marketplace entries for retired plugins (setup.ts RETIRED) are left out.

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
  { id: "studio", displayName: "Studio", description: "The home of BB Studio, with pages, recordings, drawings, designs, dashboards, mini apps and artifacts built in: one collection with search, tags, project leads, item conversations, quotes, emoji reactions on replies, VS Code on each thread’s worktree, and Decisions for Jev, fallback models and Smart Queue." },
  { id: "mobile", displayName: "Studio Mobile", description: "Part of BB Studio. The server side of the BB Studio iOS app: push notifications with lock-screen actions and muted threads." },
];
