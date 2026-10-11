export default ({ projectId, threadId, seedPages, seedDrawing, seedArtifact, seedTalkRecording, pluginRpc, talkRpc, bbCli, launchSpace, getLaunchSpaceId, sleep }) => [
  {
    id: "reactions",
    packageDir: "bb-studio-reactions",
    setup: async (client) => {
      await client.navigate("/settings/plugins/emoji-react");
      await client.waitForText("Studio Reactions");
      await client.waitForText("Saved reactions");
      await client.waitForText("👍 Agree");
      await client.waitForText("Quote the highlighted text");
      await client.waitForText("Saved menu settings are applied in this window.");
      await client.evaluate(`(() => {
        const preview = document.querySelector('[aria-label="Saved reaction preview"]');
        if (!preview?.textContent.includes("👍 Agree") || !preview.textContent.includes("❓ Clarify")) throw new Error("Saved reaction preview is missing configured choices");
        if (document.querySelector('[aria-label="Reaction 1 emoji"]') || document.body.innerText.includes("Save & apply")) throw new Error("Duplicate reaction editor remains");
        return true;
      })()`);
    },
  }
];
