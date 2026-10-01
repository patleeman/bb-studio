// Studio Feed's reader, seeded with posts through `bb feed post`: a commute
// story with two earlier updates, an urgent alert, and research posts.
const POSTS = [
  ["--title", "Metro-North running about 10 minutes late on the Harlem Line", "--topic", "Commute", "--story", "harlem-line", "--author", "Commute Bot",
    "--body", "Signal trouble near Fordham. Expect delays of about 10 minutes on inbound trains."],
  ["--title", "Weekly research digest: 4 papers on agent memory", "--topic", "Research", "--author", "Research Bot",
    "--body", "Four papers this week on long-term memory for agents. The standout compares summary memory with retrieval over raw transcripts. Sources: [arxiv.org](https://arxiv.org/abs/2509.01234), [openreview.net](https://openreview.net/forum?id=abc)"],
  ["--title", "Harlem Line delays growing to 20 minutes", "--topic", "Commute", "--story", "harlem-line", "--author", "Commute Bot",
    "--body", "Delays are now about 20 minutes. The 8:12 from Scarsdale is cancelled."],
  ["--title", "ORBIT-42 release window confirmed for Friday 2pm", "--topic", "Launch", "--author", "Atlas",
    "--body", "The brief, owner and Friday window all line up. Scribe logged the decision."],
  ["--title", "Payments API error rate above 2% for 15 minutes", "--topic", "Ops", "--urgent", "--author", "Ops Watch",
    "--body", "Checkout errors started at 9:41. Most failures are timeouts from the card processor. See [status.stripe.com](https://status.stripe.com)."],
  ["--title", "Harlem Line delays cleared", "--topic", "Commute", "--story", "harlem-line", "--author", "Commute Bot",
    "--body", "Service is back to normal as of 9:55. The signal at Fordham was repaired.\\n\\n- Inbound trains are on time\\n- The 10:12 from Scarsdale runs as scheduled"],
];

export default ({ bbCli, sleep }) => [
  {
    id: "feed",
    packageDir: "bb-studio-feed",
    privateSidebar: true,
    setup: async (client) => {
      const ids = [];
      const cleanup = async () => {
        for (const id of ids) await bbCli(["feed", "remove", id]).catch(() => undefined);
      };
      try {
        for (const args of POSTS) {
          ids.push((await bbCli(["feed", "post", ...args])).split("\t")[0].trim());
          await sleep(50);
        }
        await client.navigate("/plugins/feed/feed");
        await client.waitForText("Harlem Line delays cleared");
        await client.waitForText("2 earlier updates");
        await client.waitForText("Payments API error rate above 2% for 15 minutes");
        await client.waitForText("Weekly research digest: 4 papers on agent memory");
        await client.waitForText("arxiv.org, openreview.net");
        await client.evaluate(`(() => {
          const topics = document.querySelector('nav[aria-label="Topics"]').innerText;
          for (const topic of ["All", "Commute", "Research", "Launch", "Ops"]) if (!topics.includes(topic)) throw new Error("Missing topic " + topic + ": " + topics);
          if (!document.body.innerText.includes("Urgent")) throw new Error("The urgent post has no Urgent badge");
          // The commute story is listed once, by its newest post.
          if (document.body.innerText.includes("Harlem Line delays growing to 20 minutes")) throw new Error("A story's older update is listed on its own");
          const title = [...document.querySelectorAll("article h2")].find((each) => each.textContent === "Harlem Line delays cleared");
          title.closest("button").click();
          return true;
        })()`);
        await client.waitForText("EARLIER IN THIS STORY"); // Uppercased by CSS.
        await client.waitForText("Harlem Line delays growing to 20 minutes");
        await client.waitForText("Inbound trains are on time");
        await client.waitForText("Discuss");
        await client.waitForText("Resolve");
        await sleep(800);
      } catch (error) {
        await cleanup();
        throw error;
      }
      return cleanup;
    },
  },
];
