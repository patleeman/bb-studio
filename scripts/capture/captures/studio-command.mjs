import layouts from "./studio-command-layouts.mjs";

export default context => {
  const { pluginRpc, launchSpace, getLaunchSpaceId } = context;
  const merged = async client => {
    await launchSpace();
    const id = getLaunchSpaceId();
    await client.navigate(`/plugins/studio/studio/command/${id}`);
    await client.waitForSelector('[data-command-composer] .ProseMirror');
    await client.clickElementWithTextAndPointer('[aria-label="Layout"] button', "Merged");
    await client.waitForSelector('[data-command-timeline]');
    await client.waitForText("Logged: release check passed.");
    await client.waitForText("To Atlas");
    const { threads } = await pluginRpc("studio", "command", { spaceId: id });
    if (!threads.some(t => t.title === "Atlas") || !threads.some(t => t.title === "Scribe")) throw new Error("Command lost its ordinary threads");
    if (threads.some(t => Object.hasOwn(t, "botId"))) throw new Error("Command still depends on bot profiles");
    await client.evaluate(`(() => {
      const view = document.querySelector('[data-command-view]');
      if (!view || !view.innerText.includes('Launch work') || !view.innerText.includes('Command')) throw new Error('Command breadcrumb missing');
      if (view.innerText.includes('Work as bot')) throw new Error('Retired profile picker is visible');
      document.querySelector('[data-command-composer] .ProseMirror').focus();
    })()`);
    await client.command("Input.insertText", { text: "@" });
    await client.waitForText("This Space");
    await client.waitForText("Atlas");
    await client.waitForText("Scribe");
    await client.command("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await client.command("Input.dispatchKeyEvent", { type: "keyDown", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 });
  };
  return [
    { id: "studio-command-merged", packageDir: "bb-studio", fileName: "command-merged.png", privateSidebar: true, setup: merged },
    ...layouts(context),
  ];
};
