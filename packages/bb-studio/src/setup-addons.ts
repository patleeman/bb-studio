// BB Studio's add-ons, copied from the repository's marketplace.json so
// Studio knows them without a network call. setup-addons.test.ts fails when
// this list drifts from marketplace.json; copy the entries over when it does.

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
  { id: "studio", displayName: "Studio", description: "The home of BB Studio: one collection for pages, recordings, drawings, artifacts and tables, with search, tags, Spaces, item conversations and quotes." },
  { id: "pages", displayName: "Studio Pages", description: "Part of BB Studio. Collaborative pages you write with your agents, with live editing, comments, version history and ordinary agent chats." },
  { id: "talk", displayName: "Studio Talk", description: "Part of BB Studio. Long-form, durable dictation and recording: saves audio as you speak, transcribes it with your voice subscription, and keeps every recording linkable and @-mentionable." },
  { id: "excalidraw", displayName: "Studio Draw", description: "Part of BB Studio. Sketch Excalidraw drawings with your agents, keep them in Studio's collection, and attach them to conversations." },
  { id: "artifacts", displayName: "Studio Artifacts", description: "Part of BB Studio. Keep the images, pages, reports and files your agents make, in Studio's collection." },
  { id: "thread-list-plus", displayName: "Studio Sidebar", description: "BB's sidebar: organize threads by Space, project, section or machine, and navigate without duplicate Studio add-on rows." },
  { id: "mobile", displayName: "Studio Mobile", description: "Part of BB Studio. The server side of the BB Studio iOS app: push notifications with lock-screen actions and muted threads." },
  { id: "emoji-react", displayName: "Studio Reactions", description: "Part of BB Studio. Emoji reactions on replies: pick one from the text selection menu or the bar under a message, and it drafts your answer. Optional smart reactions let the assistant suggest the ones that fit each reply." },
  { id: "smart-decisions", displayName: "Studio Decisions", description: "Part of BB Studio. One place to set up the fast Jev model that makes quick decisions. It runs Smart Queue, which steers or queues a message you send to a busy thread, and other plugins can ask it for quick decisions." },
  { id: "studio-tables", displayName: "Studio Tables", description: "Part of BB Studio. Structured tables with typed columns, rows, views, CSV import and export, and agent tools." },
  { id: "design", displayName: "Studio Design", description: "Part of BB Studio. Design UI prototypes and slide decks with your agents: HTML screens on a canvas, a few options per round, and a reviewer that checks the work." },
  { id: "studio-code", displayName: "Studio Code", description: "Part of BB Studio. VS Code workspaces in your Spaces: open one or more folders in a full editor, run by a local code-server." },
];

/** Retired plugins that must be turned on before they can be removed (the bridge has to run to copy chat links). */
export const TURN_ON_BEFORE_REMOVE: ReadonlySet<string> = new Set(["studio-chat"]);
