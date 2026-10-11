// Reactions, built into Studio (was Studio Reactions, `emoji-react`): their
// settings on Studio's settings page, with the saved preview below them.
export default ({ sleep }) => [
  {
    id: "studio-reactions",
    packageDir: "bb-studio",
    fileName: "reactions.png",
    setup: async (client) => {
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
