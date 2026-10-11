// Reactions, built into Studio (was Studio Reactions, `emoji-react`): their
// settings on Studio's settings page, with the saved preview below them.
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
      await client.waitForText("Saved reactions", 30000);
      await client.waitForText("👍 Agree");
      await client.waitForText("Quote the highlighted text");
      await client.waitForText("Under your messages");
      await client.waitForText("Saved menu settings are applied in this window.");
      await client.evaluate(`(() => {
        const preview = document.querySelector('[aria-label="Saved reaction preview"]');
        if (!preview?.textContent.includes("👍 Agree") || !preview.textContent.includes("❓ Clarify")) throw new Error("Saved reaction preview is missing configured choices");
        const label = [...document.querySelectorAll("label, span, p, div")].find((node) => node.childElementCount === 0 && node.textContent.trim() === "Quote the highlighted text");
        if (!label) throw new Error("Reactions settings are missing from Studio's settings");
        label.scrollIntoView({ block: "start" });
        window.scrollBy?.(0, -120);
        return true;
      })()`);
      await sleep(400);
    },
  },
];
