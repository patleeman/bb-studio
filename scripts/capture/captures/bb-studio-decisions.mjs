export default ({ projectId, threadId, seedPages, seedDrawing, seedArtifact, seedTalkRecording, pluginRpc, talkRpc, bbCli, launchRoomThread, getLaunchRoomId, sleep }) => [
  {
    id: "decisions",
    packageDir: "bb-studio-decisions",
    setup: async (client) => {
      await client.navigate("/settings/plugins/smart-decisions");
      await client.waitForText("Studio Decisions");
      await client.waitForText("Jev connection");
      await client.waitForText("Fallback model");
    },
  }
];
