// Studio Feed's front page, seeded with posts through `bb feed post`: a
// commute story with two earlier updates, an urgent alert, and posts with
// and without pictures, enough to fill the top stories.
const picture = (path) => `![](https://upload.wikimedia.org/wikipedia/commons/thumb/${path}/960px-${path.split("/").pop()})`;
const POSTS = [
  ["--title", "Metro-North running about 10 minutes late on the Harlem Line", "--topic", "Commute", "--story", "harlem-line", "--author", "Commute Bot",
    "--body", "Signal trouble near Fordham. Expect delays of about 10 minutes on inbound trains."],
  ["--title", "Weekly research digest: 4 papers on agent memory", "--topic", "Research", "--author", "Research Bot",
    "--body", "Four papers this week on long-term memory for agents. The standout compares summary memory with retrieval over raw transcripts. Sources: [arxiv.org](https://arxiv.org/abs/2509.01234), [openreview.net](https://openreview.net/forum?id=abc)"],
  ["--title", "Harlem Line delays growing to 20 minutes", "--topic", "Commute", "--story", "harlem-line", "--author", "Commute Bot",
    "--body", "Delays are now about 20 minutes. The 8:12 from Scarsdale is cancelled."],
  ["--title", "Your Thursday: dentist at 3, lease reply due", "--topic", "Briefing", "--author", "Chief of Staff",
    "--body", "## Today\\n\\n- Dentist at **3:00 PM**\\n- Reply to the landlord about the lease renewal\\n\\nRain after 4, so take the umbrella."],
  ["--title", "ORBIT-42 release window confirmed for Friday 2pm", "--topic", "Launch", "--author", "Atlas",
    "--body", `${picture("9/9a/Soyuz_TMA-9_launch.jpg")}\\n\\nThe brief, owner and Friday window all line up. Scribe logged the decision.`],
  ["--title", "A new espresso bar opened across from the station", "--topic", "Local", "--author", "Scout",
    "--body", `${picture("e/e4/Latte_and_dark_coffee.jpg")}\\n\\nOpens at 6:30 on weekdays, so it works for the 7:04. Oat milk is free.`],
  ["--title", "GPU spend down 18% this week after the batch move", "--topic", "Costs", "--author", "Ledger",
    "--body", `${picture("5/57/Data_Center_of_CNPC.jpg")}\\n\\nMoving nightly evals to batch saved $412. Interactive spend is flat.`],
  ["--title", "Payments API error rate above 2% for 15 minutes", "--topic", "Ops", "--urgent", "--author", "Ops Watch",
    "--body", "Checkout errors started at 9:41. Most failures are timeouts from the card processor. See [status.stripe.com](https://status.stripe.com)."],
  ["--title", "Harlem Line delays cleared", "--topic", "Commute", "--story", "harlem-line", "--author", "Commute Bot",
    "--body", `${picture("2/2c/Metro-North_M7A_4060_leaves_White_Plains_on_Train_465.jpg")}\\n\\nService is back to normal as of 9:55. The signal at Fordham was repaired.\\n\\n- Inbound trains are on time\\n- The 10:12 from Scarsdale runs as scheduled`],
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
        await client.waitForText("Top stories");
        await client.waitForText("Payments API error rate above 2% for 15 minutes");
        await client.waitForText("Needs you");
        await client.waitForText("Developing");
        await client.waitForText("3 updates");
        await client.waitForText("Dentist at 3:00 PM · Reply to the landlord about the lease renewal");
        await client.waitForText("Weekly research digest: 4 papers on agent memory");
        await client.evaluate(`(() => {
          const topics = document.querySelector('nav[aria-label="Topics"]').innerText;
          for (const topic of ["All", "Commute", "Research", "Launch", "Ops"]) if (!topics.includes(topic)) throw new Error("Missing topic " + topic + ": " + topics);
          if (!document.body.innerText.includes("Urgent")) throw new Error("The urgent post has no Urgent badge");
          // The commute story is listed once, by its newest post.
          if (document.body.innerText.includes("Harlem Line delays growing to 20 minutes")) throw new Error("A story's older update is listed on its own");
          [...document.querySelectorAll("article h3 button")].find((each) => each.textContent === "Harlem Line delays cleared").click();
          return true;
        })()`);
        await client.waitForText("Earlier updates");
        await client.waitForText("Harlem Line delays growing to 20 minutes");
        await client.waitForText("Inbound trains are on time");
        await client.waitForText("Discuss");
        await client.waitForText("Resolve");
        // Back to the front page for the preview, once its pictures load.
        await client.navigate("/plugins/feed/feed");
        await client.waitForText("Top stories");
        for (let tries = 0; ; tries += 1) {
          const loaded = await client.evaluate(`[...document.querySelectorAll("main img")].filter((img) => img.complete && img.naturalWidth > 0).length`);
          if (loaded >= 4) break;
          if (tries > 40) throw new Error(`Only ${loaded} pictures loaded`);
          await sleep(250);
        }
        await sleep(800);
      } catch (error) {
        await cleanup();
        throw error;
      }
      return cleanup;
    },
  },
];
