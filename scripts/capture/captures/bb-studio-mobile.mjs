export default ({ projectId, threadId, seedPages, seedDrawing, seedArtifact, seedTalkRecording, pluginRpc, talkRpc, bbCli, launchSpace, getLaunchSpaceId, sleep }) => [
  {
    id: "mobile",
    packageDir: "bb-studio-mobile",
    // The settings column, from Plugin details down to the last field, with every input inside.
    clip: (client) => client.evaluate(`(() => {
      const back = [...document.querySelectorAll('a,button')].find(node => node.textContent.trim() === 'Plugin details');
      const last = [...document.querySelectorAll('*')].find(node => node.childElementCount === 0 && node.textContent.trim() === 'Expo push URL for non-APNs tokens');
      let column = back;
      while (column && !column.contains(last)) column = column.parentElement;
      if (!column) throw new Error('Studio Mobile settings column not found for capture');
      const rect = column.getBoundingClientRect();
      const clip = { x: rect.x - 20, y: Math.max(48, rect.y - 20), width: rect.width + 40, height: rect.height + 40 };
      const fields = [...column.querySelectorAll('input,textarea,select,button[role="combobox"]')];
      if (fields.length < 6) throw new Error('Studio Mobile settings fields are missing: ' + fields.length);
      for (const field of fields) {
        const box = field.getBoundingClientRect();
        if (box.left < clip.x || box.right > clip.x + clip.width || box.bottom > clip.y + clip.height) throw new Error('A Studio Mobile field falls outside the capture');
      }
      return clip;
    })()`),
    setup: async (client) => {
      await client.navigate("/settings/plugins/mobile");
      await client.waitForText("Studio Mobile");
      await client.waitForText("APNs environment");
      await client.waitForText("Expo push URL for non-APNs tokens");
    },
  }
];
