export default ({ projectId, threadId, seedPages, seedDrawing, seedArtifact, seedTalkRecording, pluginRpc, talkRpc, bbCli, launchRoomThread, getLaunchRoomId, sleep }) => [
  {
    id: "talk",
    packageDir: "bb-studio-talk",
    privateSidebar: true,
    setup: async (client) => {
      const recordingId = await seedTalkRecording(projectId);
      for (let attempt = 0; attempt < 60; attempt++) {
        if ((await talkRpc("recording_get", { id: recordingId })).recording.meetingNotes?.summary) break;
        if (attempt === 59) throw new Error("Timed out waiting for the seeded meeting summary.");
        await sleep(1000);
      }
      const cleanup = async () => {
        await client.evaluate(`document.querySelector('[data-talk-overlay] button[aria-label="Stop recording"]')?.click()`);
        await sleep(1500);
        await talkRpc("recording_delete", { id: recordingId });
      };
      try {
        await client.navigate(`/plugins/talk/recordings/${recordingId}`);
        await client.waitForText("Weekly product sync");
        await client.waitForText("offline mode beta");
        await client.waitForText("guided import spec");
        await client.waitForText("Meeting notes");
        const notes = await client.evaluate(`document.querySelector('section[aria-label="Meeting notes"] p')?.textContent?.trim() ?? ""`);
        if (!notes || notes.startsWith("Notes appear")) throw new Error("Seeded meeting summary is missing.");
        await client.waitForText("Record more");
        // Record from the synthetic microphone so the live pill is on screen.
        await client.clickButtonText("Record more");
        await client.waitForSelector("[data-talk-overlay]");
        await client.waitForAriaButton("Stop recording");
        await client.waitForText("Pause");
        await sleep(2500);
      } catch (error) {
        await cleanup();
        throw error;
      }
      return cleanup;
    },
  }
];
