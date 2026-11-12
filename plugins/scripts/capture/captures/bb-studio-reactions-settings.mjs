// Reactions, built into Studio (was Studio Reactions, `emoji-react`): their
// settings in Studio's Agent replies section.
export default ({ projectId, bbCli, sleep }) => [
  {
    id: "studio-reactions",
    packageDir: "bb-studio",
    fileName: "reactions.png",
    setup: async (client) => {
      // The live surface first: the seeded agent reply's message bar shows
      // the reactions as emoji, not Studio's icon.
      const threads = JSON.parse(await bbCli(["thread", "list", "--json"]));
      const reply = threads.find((thread) => thread.title === "Pick a database for the todo app");
      if (!reply) throw new Error("The seeded reply thread is missing; start the staged BB with its fixtures.");
      await client.navigate(`/projects/${projectId}/threads/${reply.id}`);
      for (let tries = 0; ; tries++) {
        const glyphs = await client.evaluate(`[...document.querySelectorAll("[data-emoji-react-glyph]")].map((node) => node.textContent).join(" ")`);
        if (["👍", "👎", "✅", "❓"].every((emoji) => glyphs.includes(emoji))) break;
        if (tries > 40) throw new Error(`Reaction buttons don't show as emoji under the reply (found "${glyphs}")`);
        await sleep(500);
      }
      await client.navigate("/settings/plugins/studio");
      await client.waitForText("Agent replies", 30000);
      await client.waitForText("Quote the selected text");
      await client.waitForText("Show reactions under your messages");
      await client.evaluate(`(() => {
        const field = document.querySelector('[data-testid="setting-emojiItems"] textarea');
        if (!field?.value.includes("👍 Agree") || !field.value.includes("❓ Clarify")) throw new Error("The Reactions field is missing the configured choices");
        const quote = document.querySelector('[data-testid="setting-quoteSelection"] [role="radio"][aria-checked="true"]');
        if (quote?.textContent !== "Before") throw new Error("Quote the selected text should be Before by default");
        document.querySelector('[data-testid="setting-explore_next"]')?.scrollIntoView({ block: "start" });
        return true;
      })()`);
      await sleep(400);
    },
  },
];
