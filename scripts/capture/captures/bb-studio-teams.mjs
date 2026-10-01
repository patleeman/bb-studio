import { launchRoomReplies } from "../bb.mjs";

// bots-profile opens Atlas from bots-collection, and bots-memory from bots-profile.
export default ({ projectId, threadId, pluginRpc, launchRoomThread, getLaunchRoomId, sleep }) => {
  const captures = [
    {
      id: "bots",
      packageDir: "bb-studio-teams",
      fileName: "staged-preview.png",
      setup: async (client) => {
        const threadId = await launchRoomThread();
        await client.navigate(`/threads/${threadId}`);
        for (const text of launchRoomReplies) await client.waitForText(text);
        await client.waitForAriaButton("Channel members: 2 bots");
        await client.waitForAriaButton("Search channel");
        await client.evaluate(`(() => {
          const picker = document.querySelector('[data-app-composer] button[aria-label="Channel mode and bot permissions"]');
          if (!picker?.innerText.includes('Directed') || !picker.innerText.includes("Each bot's own"))
            throw new Error("The composer must show the chat mode and bot permissions");
          if (!document.querySelector('a[href^="/plugins/bot-teams/mention/"]'))
            throw new Error("A bot's @mention must render as a link");
          if (document.body.innerText.includes('bots_channel_thread_post'))
            throw new Error('Posting to the channel must stay a collapsed bookkeeping row');
        })()`);
      },
    },
    {
      id: "bots-mentions",
      packageDir: "bb-studio-teams",
      fileName: "channel-mentions.png",
      setup: async (client) => {
        const threadId = await launchRoomThread();
        await client.navigate(`/threads/${threadId}`);
        await client.waitForText(launchRoomReplies[0]);
        await client.evaluate(`document.querySelector('[data-app-composer] [contenteditable="true"]')?.focus()`);
        // The menu asks providers once a character follows the trigger. A full
        // handle keeps BB's own thread and project suggestions, which are the
        // owner's real data, out of a published screenshot.
        await client.command("Input.insertText", { text: "@atlas" });
        await client.waitForText("Bots");
        await client.evaluate(`(() => {
          const menu = document.body.innerText;
          for (const text of ['Atlas', '@atlas'])
            if (!menu.includes(text)) throw new Error('The @ menu is missing ' + text);
          const headings = [...document.querySelectorAll('[role="listbox"] *, [data-mention-menu] *')]
            .map((e) => e.childElementCount === 0 ? e.textContent.trim() : '');
          if (headings.includes('Threads') || headings.includes('Projects'))
            throw new Error('The @ menu shows real threads or projects; narrow the query');
        })()`);
        return async () => {
          await client.command("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape" });
          await client.evaluate(`(() => {
            const editor = document.querySelector('[data-app-composer] [contenteditable="true"]');
            editor?.focus(); document.execCommand('selectAll'); document.execCommand('delete');
          })()`);
        };
      },
    },
    {
      id: "bots-search",
      packageDir: "bb-studio-teams",
      fileName: "channel-search.png",
      setup: async (client) => {
        const threadId = await launchRoomThread();
        await client.navigate(`/threads/${threadId}`);
        await client.waitForText(launchRoomReplies[0]);
        await client.evaluate(`document.querySelector('button[aria-label="Search channel"]').click()`);
        await client.waitForSelector('input[aria-label="Search channel history"]');
        await client.evaluate(`document.querySelector('input[aria-label="Search channel history"]').focus()`);
        await client.command("Input.insertText", { text: "release check" });
        await client.waitForText("3 messages");
        await client.evaluate(`[...document.querySelectorAll('.channel-search-result')].find(r => r.innerText.includes('Logged'))?.click()`);
        await client.evaluate(`(() => {
          const open = document.querySelector('.channel-search-result[aria-expanded="true"]');
          if (!open?.innerText.includes('Next step: confirm the Friday release window.'))
            throw new Error('Choosing a result must expand the full message in place');
        })()`);
      },
    },
    {
      id: "bots-automations",
      packageDir: "bb-studio-teams",
      fileName: "channel-automations.png",
      setup: async (client) => {
        const threadId = await launchRoomThread();
        const { automations } = await pluginRpc("bot-teams", "automationList", { channelId: getLaunchRoomId(), limit: 50, offset: 0 });
        if (!automations.some((a) => a.name === "Weekday launch status" && !a.enabled))
          throw new Error("Seed the paused Weekday launch status automation in Launch room before capturing.");
        await client.navigate(`/threads/${threadId}`);
        await client.waitForText(launchRoomReplies[0]);
        await client.evaluate(`document.querySelector('button[aria-label="Channel automations"]').click()`);
        await client.waitForText("Weekday launch status");
      },
    },
    {
      id: "bots-creation",
      packageDir: "bb-studio-teams",
      fileName: "bot-creation-thread.png",
      setup: async (client) => {
        const room = await pluginRpc("bot-teams", "createRoom", {
          name: "Bot creation QA", memberIds: [], requestId: crypto.randomUUID(),
        });
        const setupPath = `/plugins/bot-teams/bots/new/${room.id}`;
        const checkComposer = async (channel = false) => {
          await client.waitForText("Help me create a persistent bot in BB Studio Teams");
          if (channel) await client.waitForText(room.id);
          await client.evaluate(`(() => {
            const editor = document.querySelector('[data-bot-creation-thread] [contenteditable="true"]');
            if (!editor || !editor.textContent.includes('bb bots') || document.activeElement !== editor)
              throw new Error('Expected focused native thread composer with bot setup instructions');
            if (document.querySelector('input[aria-label="Bot name"], textarea[aria-label="Mission"]'))
              throw new Error('Bot creation form is still present');
            if (${channel} !== editor.textContent.includes(${JSON.stringify(room.id)}))
              throw new Error('Wrong channel context in setup draft');
          })()`);
        };
        try {
          // Direct links and reload must show the same native composer.
          await client.navigate("/plugins/bot-teams/bots/new");
          await checkComposer();
          await client.navigate(setupPath);
          await checkComposer(true);
          await client.command("Emulation.setDeviceMetricsOverride", {
            width: 390, height: 844, deviceScaleFactor: 1, mobile: true,
          });
          await client.evaluate(`(() => {
            const surface = document.querySelector('[data-bot-creation-thread]');
            if (surface.scrollWidth > surface.clientWidth + 1)
              throw new Error('Bot setup overflows on mobile');
          })()`);
          await client.command("Emulation.setDeviceMetricsOverride", {
            width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false,
          });
          await client.navigate("/plugins/bot-teams/bots/new");
          await checkComposer();
          // Exercise a failed submit without dispatching an agent or creating a bot.
          await client.evaluate(`(() => {
            window.botSetupQaFetch = window.fetch;
            window.fetch = async (input, init) => {
              const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
              if (url.includes('/rpc/createBotSetupThread')) {
                return new Response(JSON.stringify({ ok: false, error: { message: 'QA host unavailable' } }), {
                  status: 503, headers: { 'content-type': 'application/json' },
                });
              }
              return window.botSetupQaFetch(input, init);
            };
          })()`);
          try {
            await client.clickFirstButtonWithAria("Submit (Enter)");
            await client.waitForText("QA host unavailable");
            await client.evaluate(`(() => {
              if (!document.querySelector('[contenteditable="true"]')?.textContent.includes('Help me create') ||
                  document.querySelector('button[aria-label="Submit (Enter)"]').disabled)
                throw new Error('Failed setup must preserve the draft and allow retry');
            })()`);
          } finally {
            await client.evaluate('window.fetch = window.botSetupQaFetch');
          }
          await client.navigate("/plugins/bot-teams/bots/new");
          await checkComposer();
          return async () => { await pluginRpc("bot-teams", "deleteRoom", { id: room.id }); };
        } catch (error) {
          await pluginRpc("bot-teams", "deleteRoom", { id: room.id });
          throw error;
        }
      },
    },
    {
      id: "bots-profile",
      packageDir: "bb-studio-teams",
      fileName: "bot-profile.png",
      setup: async (client) => {
        await captures.find((capture) => capture.id === "bots-collection").setup(client);
        await client.evaluate(`(() => {
          const bot = document.querySelector('[role="link"][aria-label="Atlas"], [role="row"][aria-label="Atlas"]');
          if (!bot) throw new Error('Atlas is missing from the live collection');
          bot.click();
        })()`);
        await client.waitForInputValue("Bot name", "Atlas");
        await client.waitForInputValue("Bot role", "Research and verify the facts");
        await client.waitForText("Mission schedule");
        await client.evaluate(`(() => {
          const hero = document.querySelector('h1')?.parentElement;
          if (hero?.querySelector('h1').textContent !== 'Atlas' || !hero.textContent.includes('@atlas'))
            throw new Error('The bot page must open with its avatar, name and handle');
          const header = Array.from(document.querySelectorAll('button')).map((button) => button.getAttribute('aria-label') || button.textContent.trim());
          for (const label of ['Studio', 'Message', 'Bot options'])
            if (!header.some((text) => text.includes(label))) throw new Error('The bot header is missing ' + label);
          const form = document.querySelector('form[aria-label="Bot profile"]');
          const rows = Array.from(form?.querySelectorAll('[data-form-row] > :first-child') ?? []).map((label) => label.textContent.trim());
          const expected = ['Name', 'Avatar', 'Role', 'Primary model', 'Fallback model', 'Permissions', 'Mission schedule'];
          if (rows.join('|') !== expected.join('|') || !form.querySelector('button[aria-label="Mission schedule"]')) {
            throw new Error('Expected native bot settings rows and schedule picker, got ' + rows.join(', '));
          }
          const width = form.getBoundingClientRect().width;
          if (width > 1024 || width < 880) throw new Error('Bot configuration must use the Studio page column');
          const save = Array.from(form.querySelectorAll('button')).find((button) => button.textContent === 'Save profile');
          if ((save && !save.disabled) || document.body.innerText.includes('Unsaved changes')) throw new Error('Unchanged profiles must not offer Save');
        })()`);
      },
    },
    {
      id: "bots-memory",
      packageDir: "bb-studio-teams",
      fileName: "bot-memory.png",
      setup: async (client) => {
        await captures.find((capture) => capture.id === "bots-profile").setup(client);
        await client.evaluate(`Array.from(document.querySelectorAll('nav[aria-label="Bot sections"] button')).find((button) => button.textContent === 'Memory').click()`);
        await client.waitForText("MEMORY.md");
        // Wait for the real file, not just the empty editor shell.
        const started = Date.now();
        while (!(await client.evaluate(`document.querySelector('[aria-label="MEMORY.md"]')?.textContent.includes('ORBIT-42')`))) {
          if (Date.now() - started > 10000) throw new Error('Atlas memory must contain the staged launch brief');
          await sleep(100);
        }
        await client.evaluate(`(() => {
          const editor = document.querySelector('[aria-label="MEMORY.md"]');
          const source = document.querySelector('.bot-markdown-source').getBoundingClientRect();
          const frame = document.querySelector('.bot-markdown-editor').getBoundingClientRect();
          if (source.height < 208 || frame.bottom > innerHeight || editor.getAttribute('contenteditable') !== 'true')
            throw new Error('Memory editor must fit the page and be editable');
          const save = Array.from(document.querySelectorAll('[data-bot-document] button')).find((button) => button.textContent === 'Save memory');
          if ((save && !save.disabled) || !document.querySelector('[data-bot-document] [data-icon="RotateCcw"]')) throw new Error('Expected native reload and no save for unchanged memory');
        })()`);
      },
    },
    {
      id: "bots-collection",
      packageDir: "bb-studio-teams",
      fileName: "bots-collection.png",
      setup: async (client) => {
        await client.navigate("/");
        await client.waitForText("New thread");
        // BB pins a few nav panels and moves the rest under More.
        const pinned = await client.evaluate(`(() => {
          const buttons = Array.from(document.querySelectorAll('[data-sidebar="sidebar"] button'));
          const button = buttons.find((candidate) => candidate.textContent.trim() === 'Teams');
          if (button) { button.click(); return true; }
          buttons.find((candidate) => candidate.textContent.trim() === 'More')?.click();
          return false;
        })()`);
        if (!pinned) {
          await client.waitForText("Customize sidebar");
          await client.evaluate(`(() => {
            const item = Array.from(document.querySelectorAll('[role="dialog"] button'))
              .find((candidate) => candidate.textContent.trim() === 'Teams');
            if (!item) throw new Error('Teams navigation is missing');
            item.click();
          })()`);
        }
        // Studio Teams hands over to Studio's collection, filtered to bots.
        await client.waitForSelector('input[aria-label="Search and filter studio"]');
        await client.waitForText("Research and verify the facts");
        await client.evaluate(`(() => {
          if (!location.pathname.endsWith("/plugins/studio/studio/bot")) throw new Error("Studio Teams must open Studio's Bots collection, not " + location.pathname);
          if (!document.querySelector('button[aria-label="Remove Kind Bots"]')) throw new Error("The query must filter to bots");
          for (const name of ['Atlas', 'Quinn', 'Relay', 'Scribe']) {
            if (!document.body.innerText.includes(name)) throw new Error('Missing staged bot: ' + name);
          }
        })()`);
      },
    },
    {
      id: "bots-sidebar",
      packageDir: "bb-studio-teams",
      fileName: "studio-sidebar.png",
      showSidebar: true,
      setup: async (client) => {
        // Channels is a Studio Sidebar section: between Studio and Threads, in
        // the sidebar's one scroll area.
        await client.navigate(`/projects/${projectId}/threads/${threadId}`);
        await client.waitForSelector('section[aria-label="Channels"] .channel-sidebar-row');
        const layout = JSON.parse(await client.evaluate(`JSON.stringify((() => {
          const sidebar = document.querySelector('[data-sidebar="sidebar"]');
          const sections = Array.from(sidebar.querySelectorAll('[data-studio-sidebar-sections] > section, [data-studio-sidebar-sections] section[aria-label]'))
            .map((el) => el.getAttribute('aria-label'));
          const root = sidebar.querySelector('[data-studio-sidebar-sections]');
          const threads = Array.from(sidebar.querySelectorAll('button, p, span')).find((el) => el.textContent?.trim() === 'Threads');
          const scrollers = Array.from(root.querySelectorAll('*')).filter((el) => /(auto|scroll)/.test(getComputedStyle(el).overflowY));
          return {
            sections,
            channels: Array.from(sidebar.querySelectorAll('.channel-sidebar-row .channel-nav-name')).map((el) => el.textContent),
            above: Boolean(threads && (root.compareDocumentPosition(threads) & Node.DOCUMENT_POSITION_FOLLOWING)),
            scrollers: scrollers.length,
          };
        })())`));
        if (!layout.sections.includes("Channels")) throw new Error(`Expected a Channels section, got ${layout.sections.join(", ")}`);
        for (const name of ["Launch room", "Design review"])
          if (!layout.channels.includes(name)) throw new Error(`The Channels section is missing ${name}`);
        if (!layout.above) throw new Error("Channels is not above Threads");
        if (layout.scrollers) throw new Error("Channels has its own scroll area");
      },
      // From the Studio sections down, so the rows and the Threads heading below show.
      clip: async (client) => client.evaluate(`(() => {
        const sidebar = document.querySelector('[data-sidebar="sidebar"]').getBoundingClientRect();
        const top = document.querySelector('[data-studio-sidebar-sections]').getBoundingClientRect().top - 12;
        return { x: sidebar.x, y: top, width: sidebar.width, height: Math.min(sidebar.bottom - top, 460) };
      })()`),
    }
  ];
  return captures;
};
