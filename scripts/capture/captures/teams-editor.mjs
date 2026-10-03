// The large roster reproduces invisible checkbox inputs escaping the member list.
export default ({ pluginRpc, bbCli, projectId, sleep }) => {
  let fixture;
  const seed = async () => {
    if (fixture) return fixture;
    let bots = await pluginRpc("studio", "teams_profiles", {});
    for (let i = 1; i <= 16; i++) {
      const name = `Release reviewer ${String(i).padStart(2, "0")}`;
      if (!bots.some(bot => bot.name === name)) {
        await pluginRpc("studio", "teams_create", { name, mission: "Deterministic member picker fixture. No scheduled work.", intervalMinutes: 0 });
      }
    }
    bots = await pluginRpc("studio", "teams_profiles", {});
    const threads = JSON.parse(await bbCli(["thread", "list", "--project", projectId, "--json"]));
    const members = [...bots.slice(0, 4).map(bot => ({ kind: "bot", id: bot.id })), ...threads.slice(0, 3).map(thread => ({ kind: "thread", id: thread.id }))];
    const existing = (await pluginRpc("studio", "teams_views", {})).find(view => view.name === "Release planning" && !view.archived);
    const view = existing ?? await pluginRpc("studio", "teams_viewCreate", { name: "Release planning", members, requestId: crypto.randomUUID() });
    fixture = { id: view.id, extra: bots.find(bot => bot.name === "Release reviewer 16").id };
    return fixture;
  };
  const check = client => client.evaluate(`(() => {
    const dialog = document.querySelector('[role="dialog"]:has([aria-label="Channel name"])');
    const list = dialog?.querySelector('[aria-label="Channel members"]');
    if (!dialog || !list) throw new Error('Missing channel editor');
    const bounds = dialog.getBoundingClientRect();
    if (bounds.top < 11 || bounds.bottom > innerHeight - 11 || bounds.left < 0 || bounds.right > innerWidth) throw new Error('Channel editor exceeds the viewport');
    if (dialog.scrollHeight > dialog.clientHeight + 1 || dialog.scrollWidth > dialog.clientWidth + 1) throw new Error('Channel editor has outer overflow');
    const scrolls = [dialog, ...dialog.querySelectorAll('*')].filter(element => /^(auto|scroll)$/.test(getComputedStyle(element).overflowY) && element.scrollHeight > element.clientHeight + 1);
    if (scrolls.some(element => element !== list)) throw new Error('Channel editor has nested scroll areas');
    const controls = [dialog.querySelector('header'), dialog.querySelector('[aria-label="Channel name"]'), dialog.querySelector('[aria-label="Find bots and threads"]'), dialog.querySelector('form > div:last-child')];
    for (const element of controls) {
      const rect = element.getBoundingClientRect();
      if (rect.top < bounds.top || rect.bottom > bounds.bottom || !element.checkVisibility()) throw new Error('Channel editor clipped a fixed control');
    }
    if (bounds.bottom - controls.at(-1).getBoundingClientRect().bottom > 20) throw new Error('Channel editor leaves empty space below its actions');
    return { top: controls[0].getBoundingClientRect().top, footer: controls.at(-1).getBoundingClientRect().top, overflow: list.scrollHeight > list.clientHeight + 1, scrollTop: list.scrollTop };
  })()`);
  const filter = async (client, text) => {
    await client.evaluate("(() => { const input = document.querySelector('[aria-label=\"Find bots and threads\"]'); input.focus(); input.select(); })()");
    for (const type of ["keyDown", "keyUp"]) await client.command("Input.dispatchKeyEvent", { type, key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 });
    if (text) await client.command("Input.insertText", { text });
    await sleep(100);
  };
  const setup = (width, height, mobile) => async client => {
    const data = await seed();
    await client.command("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile });
    await client.navigate(`/plugins/studio/channels/${data.id}`);
    await client.waitForSelector('[data-view-composer]');
    await client.evaluate(`(() => {
      const picker = document.querySelector('[aria-label="Channel view"]');
      if (picker.tagName === 'SELECT') { picker.value = 'grid'; picker.dispatchEvent(new Event('change', { bubbles: true })); }
      else picker.querySelector('[data-layout="grid"]').click();
    })()`);
    await client.clickAriaButtonWithPointer("Edit channel");
    await client.waitForSelector('[aria-label="Channel members"] [aria-label="Release reviewer 16"]');
    await sleep(200);
    try {
      const before = await check(client);
      if (!before.overflow) throw new Error("Large roster did not exercise list scrolling");
      const point = await client.evaluate("(() => { const r = document.querySelector('[aria-label=\"Channel members\"]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()");
      await client.command("Input.dispatchMouseEvent", { type: "mouseWheel", ...point, deltaX: 0, deltaY: 2000 });
      await sleep(200);
      const after = await check(client);
      if (!after.scrollTop || before.top !== after.top || before.footer !== after.footer) throw new Error("Member scrolling moved the title or actions");
      // Also exercise a short viewport, as when a phone keyboard reduces space.
      await client.command("Emulation.setDeviceMetricsOverride", { width, height: 480, deviceScaleFactor: 1, mobile });
      await sleep(100);
      await check(client);
      await client.command("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile });
      await filter(client, "Release reviewer 16");
      await check(client);
      await client.clickAriaButtonWithPointer("Release reviewer 16");
      await filter(client, "no matching member");
      await client.waitForText('Nothing matches "no matching member".');
      await check(client);
      await filter(client, "");
      await check(client);
      await client.evaluate("document.activeElement?.blur()");
    } catch (error) {
      await client.capture("/tmp/bb-channel-editor-error.png");
      throw error;
    }
    return async () => {
      await client.clickElementWithTextAndPointer('[role="dialog"]:has([aria-label="Channel name"]) button', "Save channel");
      await client.evaluate("new Promise((resolve,reject) => { const end = Date.now() + 10000; const tick = () => !document.querySelector('[aria-label=\"Channel name\"]') ? resolve() : Date.now() > end ? reject(new Error('Channel save did not close the editor')) : setTimeout(tick, 100); tick(); })", true);
      const page = await pluginRpc("studio", "teams_view", { id: data.id });
      if (!page.view.members.some(member => member.kind === "bot" && member.id === data.extra)) throw new Error("Channel save lost the scrolled member selection");
      await pluginRpc("studio", "teams_viewUpdate", { ...page.view, members: page.view.members.filter(member => member.id !== data.extra), expectedUpdatedAt: page.view.updatedAt });
      await client.command("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    };
  };
  return [
    { id: "bots-channel-editor", packageDir: "bb-studio/src/modules/teams", fileName: "channel-editor.png", setup: setup(1440, 1000, false) },
    { id: "bots-channel-editor-mobile", packageDir: "bb-studio/src/modules/teams", fileName: "channel-editor-mobile.png", privateSidebar: false, setup: setup(390, 844, true) },
  ];
};
