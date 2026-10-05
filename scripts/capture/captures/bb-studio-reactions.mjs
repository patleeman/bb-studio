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
  },
  {
    id: "reactions-smart",
    packageDir: "bb-studio-reactions",
    fileName: "smart-reactions.png",
    privateSidebar: true,
    // Seed a thread with smart reactions on that asks "SQLite or Postgres?";
    // its reply must end with a ::reactions directive naming both.
    setup: async (client) => {
      const smartThreadId = process.env.BB_CAPTURE_SMART_REACTIONS_THREAD_ID ?? threadId;
      await client.navigate(`/projects/${projectId}/threads/${smartThreadId}`);
      await client.waitForSelector('[role="group"][aria-label="Suggested reactions"]');
      await client.evaluate(`(() => {
        const group = document.querySelector('[role="group"][aria-label="Suggested reactions"]');
        const labels = Array.from(group.querySelectorAll("button")).map((button) => button.textContent.trim());
        for (const label of ["SQLite", "Postgres"]) {
          if (!labels.some((text) => text.endsWith(label))) {
            throw new Error("Smart reactions are missing " + label + ": " + labels.join(", "));
          }
        }
        if (document.body.innerText.includes("::reactions{")) {
          throw new Error("The raw ::reactions directive is still visible");
        }
        group.scrollIntoView({ block: "center" });
        return true;
      })()`);
      // Clicking a reaction drafts it into the composer.
      await client.evaluate(`new Promise((resolve, reject) => {
        Array.from(document.querySelectorAll('[aria-label="Suggested reactions"] button'))
          .find((button) => button.textContent.trim().endsWith("SQLite"))
          .click();
        const started = Date.now();
        const check = () => {
          const editor = document.querySelector('[contenteditable="true"]');
          if (editor?.innerText.includes("SQLite")) return resolve(true);
          if (Date.now() - started > 5000) return reject(new Error("Clicking SQLite did not draft a reply"));
          setTimeout(check, 100);
        };
        check();
      })`, true);
      return async () => {
        await client.evaluate(`(() => {
          const editor = document.querySelector('[contenteditable="true"]');
          editor?.focus();
          document.execCommand("selectAll");
          document.execCommand("delete");
          return true;
        })()`);
      };
    },
    // End the frame below the reactions, above the composer and machine name.
    clip: (client) =>
      client.evaluate(`(() => {
        const group = document.querySelector('[role="group"][aria-label="Suggested reactions"]');
        const bottom = group.getBoundingClientRect().bottom + 24;
        return { x: 0, y: 0, width: window.innerWidth, height: Math.round(bottom) };
      })()`),
  }
];
