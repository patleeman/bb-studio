export default ({ projectId, threadId, seedPages, seedDrawing, seedArtifact, seedTalkRecording, pluginRpc, talkRpc, bbCli, launchRoomThread, getLaunchRoomId, sleep }) => [
  {
    id: "mobile",
    packageDir: "bb-studio-mobile",
    clip: () => ({ x: 320, y: 48, width: 650, height: 555 }),
    setup: async (client) => {
      await client.navigate("/settings/plugins/mobile");
      await client.waitForText("Studio Mobile");
      await client.waitForText("APNs environment");
      await client.waitForText("Expo push URL for non-APNs tokens");
    },
  }
];
