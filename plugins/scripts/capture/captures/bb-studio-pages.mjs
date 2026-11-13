// Pages, built into Studio: a page as a Studio tab (opened from its old Pages
// address).

/** Opens a page from its old Pages address and checks it lands as a Studio tab. */
async function openPage(client, id) {
  await client.navigate(`/plugins/pages/pages/${id}`);
  await client.waitForSelector(`[data-studio-workspace-editor="/plugins/studio/studio/pages/${id}"]`, 30000);
  const path = await client.evaluate("location.pathname");
  if (path !== "/plugins/studio/studio") throw new Error(`The old page address didn't open in Studio's workspace: ${path}`);
}

export default ({ seedPages, sleep }) => [
  {
    id: "pages",
    packageDir: "bb-studio",
    fileName: "pages-preview.png",
    privateSidebar: true,
    setup: async (client) => {
      const { page, cleanup } = await seedPages();
      try {
        await openPage(client, page.id);
        await client.waitForSelector('nav[aria-label="Breadcrumb"]');
        await client.waitForAriaButton("Page actions");
        await client.waitForSelector('[data-studio-item-header] button');
        // A workspace tab row shows only the item's own tools (docs/merging-add-ons.md).
        const chat = await client.evaluate(`Boolean([...document.querySelectorAll('[data-studio-item-header] button')].find(button => button.innerText.trim() === 'Chat'))`);
        if (chat) throw new Error("The page's Studio tab shows Chat in its row");
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
];
