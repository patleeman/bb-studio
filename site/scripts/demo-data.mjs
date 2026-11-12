// The fictional demo world for the site's screenshots. Every name, message,
// repository and path here is made up. Nothing comes from a real install.

const HOUR = 3_600_000;
const MIN = 60_000;

// Turns: [user text, assistant text]. `ago` is how long before "now" the turn ended.
export const threads = [
  // ---- Atlas -------------------------------------------------------------
  {
    key: "atlas-main",
    title: "Atlas",
    bot: "atlas",
    main: true,
    ago: 4 * MIN,
    turns: [
      [
        "Morning. What's on the board today?",
        [
          "Morning. Here is where things stand.",
          "",
          "**Overnight**",
          "- The release notes worker finished a first draft for orbit-web 2.4. It is in the Library as *Release notes: 2.4*.",
          "- The nightly link check failed on three docs pages. They are listed below.",
          "",
          "**Today**",
          "1. Review the 2.4 release notes before 2 PM.",
          "2. Approve the settings form refactor. It is waiting on a `pnpm add`.",
          "3. Juniper has the reading list for Thursday's book club.",
          "",
          "| Page | Broken link |",
          "|---|---|",
          "| /docs/install | /guides/linux |",
          "| /docs/api | /reference/v1 |",
          "| /blog/launch | /pricing-old |",
        ].join("\n"),
      ],
      [
        "Start a worker to fix the three broken links, and draft a short note to the team about 2.4.",
        [
          "Started **Fix broken docs links** on orbit-web. Here is the draft note:",
          "",
          "> Hi all. 2.4 goes out Thursday. The headline is offline sync for notes, plus faster search on large workspaces. The release notes are in the Library; comments are welcome until Wednesday noon.",
          "",
          "Should I post it, or keep it as a draft?",
        ].join("\n"),
      ],
      [
        "Keep it as a draft. And remind me to water the tomatoes at 6.",
        [
          "Saved the note as a draft page, *Team note: 2.4*.",
          "",
          "Added a todo: **Water the tomatoes**, today at 6:00 PM.",
        ].join("\n"),
      ],
    ],
  },
  {
    key: "atlas-lisbon",
    title: "Lisbon trip in March",
    bot: "atlas",
    ago: 3 * HOUR,
    turns: [
      [
        "Let's plan four days in Lisbon in March. Walkable, good food, one day trip.",
        [
          "A first pass:",
          "",
          "1. **Alfama and the castle.** Start early, before the tour groups.",
          "2. **Belém.** The monastery, then the riverside walk to LX Factory.",
          "3. **Sintra day trip.** The train from Rossio takes 40 minutes.",
          "4. **Príncipe Real and Chiado.** Bookshops and a long lunch.",
          "",
          "Flights are cheapest on a Tuesday out. I started a worker to compare fares.",
        ].join("\n"),
      ],
    ],
  },
  {
    key: "atlas-kitchen",
    title: "Kitchen renovation budget",
    bot: "atlas",
    ago: 35 * MIN,
    needsYou: "Pick a countertop: quartz or butcher block?",
    turns: [
      [
        "Here are the three quotes for the kitchen. Can you put them side by side?",
        [
          "| | Quote A | Quote B | Quote C |",
          "|---|---|---|---|",
          "| Cabinets | $6,200 | $5,400 | $7,100 |",
          "| Countertop | Quartz | Butcher block | Quartz |",
          "| Labor | $3,800 | $4,100 | $3,500 |",
          "| **Total** | **$14,900** | **$12,300** | **$15,200** |",
          "",
          "B is cheapest because of the butcher block. Which countertop do you want? That decides between A and B.",
        ].join("\n"),
      ],
    ],
  },
  {
    key: "atlas-bookclub",
    title: "Book club: Thursday",
    bot: "atlas",
    forkOf: "atlas-main",
    ago: 70 * MIN,
    turns: [
      [
        "Can you pull three discussion questions for Thursday?",
        [
          "Three questions for *The Remains of the Day*:",
          "",
          "1. Is Stevens an unreliable narrator, or an honest one who avoids things?",
          "2. What does the trip to Cornwall change, if anything?",
          "3. Which choice of his would you defend?",
        ].join("\n"),
      ],
    ],
  },
  // Workers of Atlas (children of Main)
  {
    key: "w-links",
    title: "Fix broken docs links",
    bot: "atlas",
    workerOf: "atlas-main",
    env: "orbit-web",
    branch: "fix/docs-links",
    status: "active",
    ago: 2 * MIN,
    turns: [["Fix the three broken links listed in Main.", "Found the three links. Updating /docs/install first."]],
  },
  {
    key: "w-settings",
    title: "Refactor the settings form",
    bot: "atlas",
    workerOf: "atlas-main",
    env: "orbit-web",
    branch: "refactor/settings-form",
    status: "idle",
    approval: {
      command: "pnpm add @radix-ui/react-switch",
      cwd: "/home/demo/orbit-web",
      reason: "Adds a dependency for the new toggle rows.",
    },
    ago: 12 * MIN,
    turns: [["Split the settings form into sections and use switches for the toggles.", "The form is split into General, Sync and Privacy. The switches need one new package."]],
  },
  {
    key: "w-notes",
    title: "Draft release notes 2.4",
    bot: "atlas",
    workerOf: "atlas-main",
    env: "orbit-web",
    branch: "docs/release-2.4",
    status: "idle",
    ago: 9 * HOUR,
    turns: [["Draft the 2.4 release notes from the merged pull requests.", "Done. 14 changes in four groups. Saved as *Release notes: 2.4*."]],
  },
  {
    key: "w-linkcheck",
    title: "Nightly link check",
    bot: "atlas",
    workerOf: "atlas-main",
    env: "orbit-web",
    branch: "main",
    status: "error",
    ago: 7 * HOUR,
    turns: [["Run the link check on the docs site.", "Three links returned 404."]],
  },
  {
    key: "w-fares",
    title: "Compare flight fares",
    bot: "atlas",
    workerOf: "atlas-lisbon",
    status: "idle",
    ago: 2 * HOUR + 40 * MIN,
    turns: [["Compare fares to Lisbon for March 10 to 14.", "The cheapest round trip is $612 on a Tuesday departure."]],
  },
  // ---- Juniper -----------------------------------------------------------
  {
    key: "juniper-main",
    title: "Juniper",
    bot: "juniper",
    main: true,
    ago: 50 * MIN,
    turns: [
      [
        "What did you find on home battery storage?",
        [
          "A short summary of what I read this morning:",
          "",
          "- **Sizing.** Most homes cover an evening with 10 to 13 kWh.",
          "- **Chemistry.** LFP cells last longer and run cooler than NMC.",
          "- **Payback.** It depends mostly on your utility's export rate.",
          "",
          "The full notes are on the page *Home batteries: notes*.",
        ].join("\n"),
      ],
      [
        "Good. Add the reading list for book club too.",
        "Added five titles to *Book club: reading list*, with a line on each.",
      ],
    ],
  },
  {
    key: "juniper-essay",
    title: "Essay outline: slow software",
    bot: "juniper",
    ago: 5 * HOUR,
    turns: [["Outline an essay on software that respects your time.", "An outline in five parts is ready. Part three needs your examples."]],
  },
  {
    key: "w-sources",
    title: "Collect sources on LFP cells",
    bot: "juniper",
    workerOf: "juniper-main",
    status: "idle",
    ago: 6 * HOUR,
    turns: [["Collect primary sources on LFP cycle life.", "Collected eight sources."]],
  },
  // ---- Scout -------------------------------------------------------------
  {
    key: "scout-main",
    title: "Scout",
    bot: "scout",
    main: true,
    ago: 20 * MIN,
    turns: [
      [
        "Anything I should know about the house?",
        [
          "All quiet, with two small things:",
          "",
          "- The garden soil sensor reads **18% moisture**. Below 20% the tomatoes start to wilt.",
          "- The furnace filter is due in **9 days**. I put it on your todos.",
        ].join("\n"),
      ],
    ],
  },
  {
    key: "w-sensors",
    title: "Read the garden sensors",
    bot: "scout",
    workerOf: "scout-main",
    env: "garden-sensors",
    branch: "main",
    status: "idle",
    ago: 25 * MIN,
    turns: [["Read the soil sensors.", "Moisture 18%, temperature 21 °C."]],
  },
];

export const bots = [
  { key: "atlas", name: "Atlas", theme: "miami-1985", presence: "tesseract" },
  { key: "juniper", name: "Juniper", theme: "kyoto-garden", presence: "knot" },
  { key: "scout", name: "Scout", theme: "forest", presence: "orb" },
];

export const pages = [
  { bot: "atlas", title: "Release notes: 2.4", body: "## Offline sync\nNotes now sync when you are back online.\n\n## Search\nSearch on large workspaces is up to four times faster.\n\n## Fixes\n- The settings form keeps its scroll position.\n- Links in exported pages work again.\n" },
  { bot: "atlas", title: "Team note: 2.4", body: "Hi all. 2.4 goes out Thursday. The headline is offline sync for notes, plus faster search on large workspaces.\n" },
  { bot: "atlas", title: "Lisbon: four days", body: "1. Alfama and the castle\n2. Belém\n3. Sintra\n4. Príncipe Real and Chiado\n" },
  { bot: "juniper", title: "Home batteries: notes", body: "- Sizing: 10 to 13 kWh covers an evening.\n- LFP lasts longer than NMC.\n" },
  { bot: "juniper", title: "Book club: reading list", body: "1. The Remains of the Day\n2. Piranesi\n3. A Gentleman in Moscow\n4. Klara and the Sun\n5. The Overstory\n" },
];

export const memory = [
  { bot: "atlas", topic: "Release schedule", text: "orbit-web ships on Thursdays. Notes are reviewed by Wednesday noon." },
  { bot: "atlas", topic: "Travel", text: "Prefers walkable cities, aisle seats and Tuesday departures." },
  { bot: "atlas", topic: "Kitchen renovation", text: "Three quotes received. The countertop choice decides between A and B." },
  { bot: "atlas", topic: "Garden", text: "Tomatoes are watered at 6 PM. They wilt below 20% soil moisture." },
  { bot: "atlas", topic: "Writing", text: "Short notes to the team. No exclamation marks." },
  { bot: "juniper", topic: "Book club", text: "Meets on the first Thursday of the month." },
];

// Todos. `in` is hours from now for a time trigger.
export const todos = [
  { title: "Water the tomatoes", status: "queued", trigger: { type: "time", in: 5 }, area: "Home" },
  { title: "Review the 2.4 release notes", status: "surfaced", trigger: { type: "none" }, area: "Work", why: "Comments close Wednesday noon." },
  { title: "Choose a countertop", kind: "decide", options: ["Quartz", "Butcher block"], status: "surfaced", trigger: { type: "none" }, area: "Home" },
  { title: "Replace the furnace filter", status: "queued", trigger: { type: "time", in: 9 * 24 }, area: "Home" },
  { title: "Book the Sintra train", status: "queued", trigger: { type: "place", place: "Home", direction: "arrive", label: "When you get home" }, area: "Travel" },
  { title: "Reply to the book club about Thursday", status: "queued", trigger: { type: "event", event: "juniper-list", label: "When Juniper finishes the list" }, area: "Personal" },
];

export const automations = [
  { bot: "atlas", name: "Morning summary", instruction: "Summarize overnight work and what needs me today.", cron: "0 8 * * 1-5" },
  { bot: "atlas", name: "Nightly link check", instruction: "Check the docs site for broken links.", cron: "0 2 * * *" },
  { bot: "scout", name: "Garden sensors", instruction: "Read the soil sensors and tell me if anything is low.", cron: "0 */3 * * *" },
];

// Skills the Bots saved from their work (Studio's bot_skills table).
export const skills = [
  { bot: "atlas", name: "release-notes", description: "Draft release notes from merged pull requests, grouped by area.", pinned: true, usedAgo: 14 * HOUR,
    body: "1. List the pull requests merged since the last tag.\n2. Group them by area: app, docs, infrastructure.\n3. Write one plain line per change.\n4. Save the draft to the Library and ask for a review." },
  { bot: "atlas", name: "link-check", description: "Check the docs site for broken links and open a worker to fix them.", usedAgo: 9 * HOUR,
    body: "1. Crawl the docs site from the sitemap.\n2. Collect every link that answers 404 or times out.\n3. Report them as a table in Main.\n4. Offer a worker to fix them." },
  { bot: "atlas", name: "trip-planning", description: "Plan a short trip: route, day plans, bookings to make and a packing list.", usedAgo: 3 * 24 * HOUR,
    body: "1. Ask for dates, budget and what matters most.\n2. Sketch the route on a whiteboard.\n3. Write one page per day.\n4. Add todos for each booking." },
  { bot: "atlas", name: "weekly-review", description: "Sum up the week: what shipped, what slipped, and what needs a decision.", usedAgo: 6 * 24 * HOUR,
    body: "1. Read the week's Main and finished conversations.\n2. List what shipped and what slipped.\n3. Name the decisions that are waiting." },
];
