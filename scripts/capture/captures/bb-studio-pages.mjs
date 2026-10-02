export default ({ projectId, threadId, seedPages, seedDrawing, seedArtifact, seedTalkRecording, pluginRpc, talkRpc, bbCli, launchRoomThread, getLaunchRoomId, sleep }) => [
  {
    id: "pages",
    packageDir: "bb-studio-pages",
    privateSidebar: true,
    setup: async (client) => {
      const { page, cleanup } = await seedPages();
      try {
        await client.navigate(`/plugins/pages/pages/${page.id}`);
        await client.waitForSelector('nav[aria-label="Breadcrumbs"]');
        await client.waitForAriaButton("Comments");
        await client.waitForAriaButton("Page actions");
        await client.waitForText("Work with this page…");
        await client.waitForText("Offline mode launch");
        await client.waitForText("Beta teams");
        await client.waitForText("Crash-free sessions");
        await client.waitForText("Weekly active teams");
        await client.waitForText("Localise onboarding for Japanese and German");
        await client.waitForSelector(".recharts-bar-rectangle");
        // Talk is installed in the staged app, so the page offers dictation.
        await client.waitForSelector('[data-talk-field^="pages:"]');
        await client.waitForAriaButton("Dictate");
        await sleep(1000);
      } catch (error) {
        await cleanup();
        throw error;
      }
      return cleanup;
    },
  },
  {
    id: "pages-comments",
    packageDir: "bb-studio-pages",
    fileName: "comments.png",
    privateSidebar: true,
    setup: async (client) => {
      const { page } = await pluginRpc("pages", "create", {
        projectId, parentId: null, title: "Offline launch review", icon: "🚀",
        markdown: "## Launch checklist\n\nTest offline sync before the beta release.\n\n- [ ] Try reconnecting after editing a note\n- [ ] Check the first-run onboarding",
      });
      const cleanup = () => pluginRpc("pages", "remove", { id: page.id }).catch(() => {});
      const original = await pluginRpc("pages", "markdown", { id: page.id });
      const insert = async (text, selector = ".pages-comment-dictation") => {
        const accepted = await client.evaluate(`(() => {
          const field = document.querySelector(${JSON.stringify(selector)});
          if (!field) throw new Error('Comment draft not found');
          return !field.dispatchEvent(new CustomEvent('bb-talk:insert', { cancelable: true, detail: { text: ${JSON.stringify(text)} } }));
        })()`);
        if (!accepted) throw new Error("Comment draft did not accept dictation");
      };
      const comments = () => pluginRpc("pages", "comments", { id: page.id });
      const waitForComments = async (count) => {
        for (let attempt = 0; attempt < 40; attempt++) {
          const result = await comments();
          if (result.threads[0]?.comments.length === count) return result;
          await sleep(250);
        }
        throw new Error(`Expected ${count} saved comments: ${JSON.stringify(await comments())}`);
      };
      const selectThread = async () => {
        if (!await client.evaluate(`Boolean(document.querySelector('aside[aria-label="Comments"]'))`)) await client.clickAriaButtonWithPointer("Comments");
        await client.waitForSelector(".pages-comments .bn-thread");
        await client.waitForText("One more check:");
        await client.clickElementWithTextAndPointer(".pages-comments .bn-inline-content", "One more check: Please test edits made offline before the beta release.");
        await client.waitForSelector('.pages-comments button[aria-label="Dictate comment"]');
      };
      try {
        await client.navigate(`/plugins/pages/pages/${page.id}`);
        await client.waitForText("Test offline sync");
        await client.waitForAriaButton("Dictate");
        await client.evaluate(`(() => {
          const text = [...document.querySelectorAll('.pages-main .bn-inline-content')].find(el => el.textContent.includes('Test offline sync'));
          text.closest('[contenteditable]').focus();
          const range = document.createRange(); range.selectNodeContents(text);
          const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
          document.dispatchEvent(new Event('selectionchange'));
        })()`);
        await client.waitForAriaButton("Add comment");
        await client.clickAriaButtonWithPointer("Add comment");
        await client.waitForAriaButton("Dictate comment");
        // Real trusted clicks open and stop the synthetic browser microphone.
        await client.clickAriaButtonWithPointer("Dictate comment");
        await client.waitForAriaButton("Stop dictating comment");
        const targetMatches = await client.evaluate(`document.documentElement.dataset.bbTalkField === document.querySelector('.pages-comment-dictation').dataset.talkField`);
        if (!targetMatches) throw new Error("Talk targeted another editor");
        await sleep(1300);
        await client.clickAriaButtonWithPointer("Stop dictating comment");
        await client.waitForSelector('html[data-bb-talk="idle"]', 60000);
        // Synthetic microphone audio contains no speech; deterministic transcripts
        // exercise the same delivery event without relying on ASR guesses.
        await client.evaluate(`(() => { const editor = document.querySelector('.pages-comment-dictation [contenteditable="true"]'); editor.focus(); const range = document.createRange(); range.selectNodeContents(editor); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); })()`);
        await client.command("Input.insertText", { text: "One more check:" });
        await insert("Please test edits made offline before the beta release.\n\nAlso check reconnecting after a network change.");
        await client.waitForText("One more check: Please test edits made offline before the beta release.");
        await client.waitForText("Also check reconnecting after a network change.");
        if ((await comments()).threads.length) throw new Error("Dictation posted a comment before Save");
        await client.clickElementWithTextAndPointer(".bn-comment-actions button", "Save");
        await waitForComments(1);
        await selectThread();
        await client.evaluate(`document.querySelector('.pages-comments .pages-comment-dictation [contenteditable="true"]').focus()`);
        await client.command("Input.insertText", { text: "And also:" });
        await insert("Try turning Wi-Fi off during onboarding.", ".pages-comments .pages-comment-dictation");
        await client.waitForText("And also: Try turning Wi-Fi off during onboarding.");
        if ((await comments()).threads[0].comments.length !== 1) throw new Error("Dictation posted a reply before Save");
        await client.clickElementWithTextAndPointer(".pages-comments .bn-comment-actions button", "Save");
        await waitForComments(2);
        const after = await pluginRpc("pages", "markdown", { id: page.id });
        if (after.markdown !== original.markdown) throw new Error("Comment dictation changed the page body");
        // The same comment sheet and microphone fit on phones.
        await client.command("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
        await sleep(700);
        await selectThread();
        const fits = await client.evaluate(`(() => {
          const mic = document.querySelector('.pages-comments button[aria-label="Dictate comment"]');
          if (!mic) return false;
          const rect = mic.getBoundingClientRect();
          return rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight;
        })()`);
        if (!fits) throw new Error("Comment microphone is outside the mobile viewport");
        await client.capture("packages/bb-studio-pages/assets/comments-mobile.png");
        await client.command("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
        await sleep(700);
        await selectThread();
        await sleep(300);
      } catch (error) {
        await client.capture(`${process.env.TMPDIR ?? "/tmp/"}pages-comment-capture-error.png`);
        await cleanup();
        throw error;
      }
      return cleanup;
    },
  },
  {
    id: "pages-collection",
    packageDir: "bb-studio-pages",
    fileName: "collection.png",
    privateSidebar: true,
    setup: async (client) => {
      const { cleanup } = await seedPages();
      try {
        // With Studio installed, Pages' collection hands over to Studio,
        // filtered to pages. Shows the list view across every project.
        await client.navigate("/plugins/pages/pages");
        await client.evaluate(`localStorage.setItem("studio:collection:view", "list"); localStorage.setItem("studio:query:all", "")`);
        await client.navigate("/plugins/studio/studio/page");
        await client.waitForSelector('input[aria-label="Search and filter studio"]');
        await client.waitForSelector('button[aria-label="Remove Kind Pages"]');
        await client.waitForSelector('[role="grid"]');
        await client.waitForText("New page");
        await client.waitForText("Offline mode launch");
        await client.waitForText("Rollout risks");
        await client.waitForText("Release notes: October");
        await sleep(800);
      } catch (error) {
        await cleanup();
        throw error;
      }
      return cleanup;
    },
  }
];
