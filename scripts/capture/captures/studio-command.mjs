import layouts from "./studio-command-layouts.mjs";

export default context => {
  const { pluginRpc, launchSpace, getLaunchSpaceId } = context;
  const overview = async client => {
    try {
      await launchSpace();
      const id = getLaunchSpaceId();
      await client.navigate(`/plugins/studio/studio/command/${id}`);
      await client.waitForSelector('[data-command-composer] .ProseMirror');
      await client.waitForSelector('[data-command-panes] [data-channel-thread]');
      await client.waitForSelector('[aria-label="Space threads"]');
      await client.waitForText("To Atlas");
      const { threads } = await pluginRpc("studio", "command", { spaceId: id });
      if (!threads.some(t => t.title === "Atlas") || !threads.some(t => t.title === "Scribe")) throw new Error("Command lost its ordinary threads");
      if (threads.some(t => Object.hasOwn(t, "botId"))) throw new Error("Command still depends on bot profiles");
      await client.evaluate(`(() => {
        const view = document.querySelector('[data-command-view]');
        const breadcrumb = document.querySelector('[aria-label="Breadcrumb"]');
        if (!view || !breadcrumb?.innerText.includes('Launch work') || !breadcrumb.innerText.includes('Command')) throw new Error('Command breadcrumb missing');
        if (view.innerText.includes('Work as bot')) throw new Error('Retired profile picker is visible');
        document.querySelector('[data-command-composer] .ProseMirror').focus();
      })()`);
      await client.command("Input.insertText", { text: "@Atlas" });
      await client.waitForText("This Space");
      await client.waitForText("Atlas");
      const clear = async () => {
        for (const type of ["keyDown", "keyUp"]) await client.command("Input.dispatchKeyEvent", { type, key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
        for (const type of ["keyDown", "keyUp"]) await client.command("Input.dispatchKeyEvent", { type, key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 4 });
        for (const type of ["keyDown", "keyUp"]) await client.command("Input.dispatchKeyEvent", { type, key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 });
      };
      await clear();
      await client.command("Input.insertText", { text: "@Scribe" });
      await client.waitForText("This Space");
      await client.waitForText("Scribe");
      await clear();
    } catch (error) {
      console.error(await client.evaluate("document.body.innerText.slice(-5000)").catch(() => "Page unavailable"));
      await client.capture(process.env.BB_CAPTURE_DEBUG_PATH || "/tmp/bb-command-view-error.png").catch(() => {});
      throw error;
    }
  };
  return [
    { id: "studio-command", packageDir: "bb-studio", fileName: "command.png", privateSidebar: true, setup: overview },
    ...layouts(context),
  ];
};
