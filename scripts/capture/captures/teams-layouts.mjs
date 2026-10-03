// Exercise native transcripts through the full staged stable BB application.
export default ({ pluginRpc, launchRoomThread, getLaunchRoomId, bbCli, projectId, sleep }) => {
 let fixture;
 const settleBots = async page => {
  // Their fixed launch replies are already present. Freeze any remaining
  // demo coordination so the Active check can start one known worker.
  await Promise.all(page.threads.filter(thread => thread.botId).map(thread => bbCli(["thread", "stop", thread.id])));
 };
 const seed = async () => {
  if (fixture) return fixture;
  const existing = (await pluginRpc("bot-teams", "views", {})).find(view => view.name === "Channel layouts" && !view.archived);
  if (existing) {
   const page = await pluginRpc("bot-teams", "view", { id: existing.id });
   await settleBots(page);
   fixture = { id: existing.id, threadId: page.view.members.at(-1).id };
   return fixture;
  }
  await launchRoomThread();
  const launch = await pluginRpc("bot-teams", "view", { id: getLaunchRoomId() });
  const brief = launch.entries.filter(entry => entry.role === "user" && entry.text.includes("Here's the ORBIT-42 launch brief."));
  if (brief.length !== 1 || !brief[0].groupId) throw new Error("Hidden channel context lost merged receipt grouping");
  await settleBots(launch);
  const thread = JSON.parse(await bbCli(["thread", "spawn", "--project", projectId, "--provider", "codex", "--model", "gpt-6-luna", "--reasoning-level", "low", "--title", "Release checklist", "--prompt", 'This is a deterministic UI fixture. Do not use tools or change files. Reply exactly with these two lines:\nThe launch checklist is ready.\n::reactions{items="✅ Approve|🔍 Review"}', "--json"]));
  await bbCli(["thread", "wait", thread.id, "--timeout", "1m"]);
  const members = [...launch.threads.filter(thread => !thread.parentThreadId).map(thread => ({ kind: "thread", id: thread.id })), { kind: "thread", id: thread.id }];
  const view = await pluginRpc("bot-teams", "viewCreate", { name: "Channel layouts", members, requestId: crypto.randomUUID() });
  fixture = { id: view.id, threadId: thread.id };
  return fixture;
 };
 const wait = (client, expression) => client.evaluate(`new Promise((resolve,reject)=>{const end=Date.now()+20000;const tick=()=>(${expression})?resolve():Date.now()>end?reject(new Error('Channel assertion failed: '+${JSON.stringify(expression)})):setTimeout(tick,200);tick();})`, true);
 const mode = async (client, value) => {
  await client.evaluate(`(()=>{const button=document.querySelector('[aria-label="Channel view"] button[data-layout=${JSON.stringify(value)}]');if(!button)throw new Error('Missing view switcher button');button.click();if(button.getAttribute('aria-pressed')!=='true')throw new Error('View switcher did not select '+${JSON.stringify(value)});})()`);
  await client.waitForSelector(value === "merged" ? "[data-view-timeline]" : `[data-channel-layout="${value}"]`);
 };
 const open = async (client, value) => {
  const data = await seed();
  await client.navigate(`/plugins/bot-teams/channels/${data.id}`);
  await client.waitForSelector('[data-view-composer] .ProseMirror');
  await mode(client, value);
  return data;
 };
 const guard = setup => async client => {
  try { return await setup(client); }
  catch (error) {
   console.error(await client.evaluate("document.body.innerText.slice(-5000)").catch(() => "Page unavailable"));
   await client.capture(process.env.BB_CAPTURE_DEBUG_PATH || "/tmp/bb-channel-layout-error.png").catch(() => {});
   throw error;
  }
 };
 const clearDraft = async client => {
  await client.evaluate("document.querySelector('[data-view-composer] .ProseMirror').focus()");
  for (const type of ["keyDown", "keyUp"]) await client.command("Input.dispatchKeyEvent", { type, key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 4 });
  for (const type of ["keyDown", "keyUp"]) await client.command("Input.dispatchKeyEvent", { type, key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 });
 };
 const concise = client => client.evaluate(`(()=>{
  const text=Array.from(document.querySelectorAll('[data-channel-thread]')).map(pane=>pane.innerText).join('\\n');
  for(const marker of ['[Studio view message','[End owner message]','Channel: /plugins/bot-teams/','Recipients:','Recent channel replies (context'])if(text.includes(marker))throw new Error('Native transcript exposed transport context: '+marker);
  if(!text.includes("Here's the ORBIT-42 launch brief."))throw new Error('Native transcript lost the owner request');
 })()`);
 return [
  { id: "bots-grid", packageDir: "bb-studio-teams", fileName: "channel-grid.png", setup: guard(async client => {
   const data = await open(client, "grid");
   await wait(client, "document.querySelectorAll('[data-channel-thread]').length===3");
   await client.waitForText("The launch checklist is ready.");
   await client.waitForSelector(`[data-channel-thread="${data.threadId}"] [aria-label="Suggested reactions"]`);
   await client.waitForText("Ready. I checked the brief:");
   await concise(client);
   await clearDraft(client);
   await client.command("Input.insertText", { text: "Keep this channel draft." });
   await client.evaluate("(()=>{window.channelCaptureComposer=document.querySelector('[data-view-composer] .ProseMirror');return true;})()");
   for (const value of ["merged", "active", "focus", "grid"]) {
    await mode(client, value);
    await client.evaluate("(()=>{const editor=document.querySelector('[data-view-composer] .ProseMirror');if(editor!==window.channelCaptureComposer||!editor.textContent.includes('Keep this channel draft.'))throw new Error('View switch lost the channel draft');})()");
   }
   await clearDraft(client);
   const reactionSelector = `[data-channel-thread="${data.threadId}"] [aria-label="Suggested reactions"] button`;
   const reactionText = await client.evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(reactionSelector)})).find(button=>button.textContent.includes('Approve'))?.textContent.trim()`);
   if (!reactionText) throw new Error("Native reactions lack Approve");
   await client.clickElementWithTextAndPointer(reactionSelector, reactionText);
   await wait(client, "document.querySelector('[data-view-composer] .ProseMirror').textContent.includes('Approve')");
   await client.waitForText("Replying to Release checklist");
   await clearDraft(client);
   await client.clickAriaButtonWithPointer("Cancel reply");
   await client.evaluate("document.activeElement?.blur()");
  }) },
  { id: "bots-focus", packageDir: "bb-studio-teams", fileName: "channel-focus.png", setup: guard(async client => {
   const data = await open(client, "grid");
   await client.clickAriaButtonWithPointer("Focus Release checklist");
   await wait(client, `document.querySelectorAll('[data-channel-thread]').length===1&&!!document.querySelector('[data-channel-thread="${data.threadId}"]')`);
   await client.waitForSelector(`[data-channel-thread="${data.threadId}"] [aria-label="Suggested reactions"]`);
   await client.evaluate("(()=>{if(document.querySelectorAll('[aria-label=\"Channel threads\"] button').length!==3)throw new Error('Focus lost its other members');})()");
  }) },
  { id: "bots-active", packageDir: "bb-studio-teams", fileName: "channel-active.png", setup: guard(async client => {
   const data = await open(client, "active");
   await bbCli(["thread", "tell", data.threadId, "For a staged UI activity check, use the terminal to run sleep 45, then reply only Check finished. Change no files."]);
   try {
    await client.waitForSelector(`[data-channel-thread="${data.threadId}"]`);
    await client.waitForText("Working");
    await client.evaluate("(()=>{if(document.querySelectorAll('[data-channel-thread]').length!==1||document.querySelectorAll('[aria-label=\"Channel threads\"] button').length!==3)throw new Error('Active view did not retain idle members in its roster');})()");
   } catch (error) { await bbCli(["thread", "stop", data.threadId]).catch(() => {}); throw error; }
   return async () => {
    await bbCli(["thread", "stop", data.threadId]);
    await client.waitForText("Nobody is working right now");
    await client.waitForText("Last reply from");
    await client.clickElementWithTextAndPointer('[aria-label="Channel threads"] button .channel-rail-name', "Release checklist");
    await client.waitForSelector('[data-channel-layout="focus"]');
   };
  }) },
  { id: "bots-grid-mobile", packageDir: "bb-studio-teams", fileName: "channel-grid-mobile.png", privateSidebar: false, setup: guard(async client => {
   await client.command("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
   await open(client, "grid");
   await wait(client, "document.querySelectorAll('[data-channel-thread]').length===3");
   await client.waitForText("Ready. I checked the brief:");
   await concise(client);
   await client.evaluate("(()=>{if(document.documentElement.scrollWidth>innerWidth)throw new Error('Grid overflows the phone');const composer=document.querySelector('[data-view-composer]');if(!composer||composer.getBoundingClientRect().bottom>innerHeight)throw new Error('Grid composer is offscreen');})()");
   return () => client.command("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  }) },
  { id: "bots-focus-mobile", packageDir: "bb-studio-teams", fileName: "channel-focus-mobile.png", privateSidebar: false, setup: guard(async client => {
   await client.command("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
   await open(client, "grid");
   await client.clickAriaButtonWithPointer("Focus Atlas");
   await client.waitForSelector('[data-channel-layout="focus"]');
   await client.waitForText("Ready. I checked the brief:");
   await concise(client);
   await client.evaluate("(()=>{if(document.querySelectorAll('[data-channel-thread]').length!==1||document.querySelectorAll('[aria-label=\"Channel threads\"] button').length!==3)throw new Error('Phone focus lost its selected thread or member rail');if(document.documentElement.scrollWidth>innerWidth||document.querySelector('[data-view-composer]').getBoundingClientRect().bottom>innerHeight)throw new Error('Phone focus exceeds the viewport');})()");
   return () => client.command("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  }) },
  { id: "bots-thread-drop", packageDir: "bb-studio-teams", fileName: "channel-thread-drop.png", showSidebar: true, setup: guard(async client => {
   const data = await seed();
   const { preferences } = await pluginRpc("thread-list-plus", "listPreferences", null);
   await pluginRpc("thread-list-plus", "setPreference", { key: "organizationMode", value: "chronological" });
   await client.navigate(`/projects/${projectId}/threads/${data.threadId}`);
   await client.waitForSelector(`[data-sidebar-thread-id="${data.threadId}"]`);
   const projectThreads = JSON.parse(await bbCli(["thread", "list", "--project", projectId, "--json"]));
   const target = projectThreads.find(thread => thread.title === "Review the launch checklist")?.id;
   if (!target) throw new Error("Missing ordinary checklist target in the live sidebar");
   await client.waitForSelector(`[data-sidebar-thread-id="${target}"]`);
   const before = projectThreads.filter(thread => [data.threadId, target].includes(thread.id)).map(thread => ({ id: thread.id, projectId: thread.projectId, parentThreadId: thread.parentThreadId }));
   const points = await client.evaluate(`(()=>{const point=id=>{const row=document.querySelector('[data-sidebar-thread-id="'+id+'"]');row.scrollIntoView({block:'nearest'});const rect=row.getBoundingClientRect();return {x:rect.left+100,y:rect.top+rect.height/2};};return {from:point(${JSON.stringify(data.threadId)}),to:point(${JSON.stringify(target)})};})()`);
   await client.command("Input.dispatchMouseEvent", { type: "mouseMoved", ...points.from, buttons: 0 });
   await client.command("Input.dispatchMouseEvent", { type: "mousePressed", ...points.from, button: "left", buttons: 1, clickCount: 1 });
   for (let step = 1; step <= 12; step++) {
    await client.command("Input.dispatchMouseEvent", { type: "mouseMoved", x: points.from.x + (points.to.x-points.from.x)*step/12, y: points.from.y + (points.to.y-points.from.y)*step/12, button: "left", buttons: 1 });
    await sleep(25);
   }
   await sleep(450);
   await client.command("Input.dispatchMouseEvent", { type: "mouseReleased", ...points.to, button: "left", buttons: 0, clickCount: 1 });
   await client.waitForText("Combine threads");
   await client.waitForText("Nest threads");
   await client.evaluate("(()=>{const dialog=document.querySelector('[aria-label=\"Channel name\"]').closest('[role=\"dialog\"]');if(!dialog.textContent.includes('Release checklist')||!dialog.textContent.includes('Review the launch checklist'))throw new Error('Drop dialog lost either source');})()");
   await wait(client, "Array.from(document.querySelectorAll('[role=\"dialog\"]:has([aria-label=\"Channel name\"]) button')).some(button=>button.textContent==='Create channel'&&!button.disabled)");
   await sleep(350); // Capture the settled dialog after its opening animation.
   return async () => {
    await sleep(400);
    await client.clickElementWithTextAndPointer('[role="dialog"]:has([aria-label="Channel name"]) button', "Create channel");
    await client.waitForSelector('[data-thread-view]');
    const id = await client.evaluate("location.pathname.split('/').at(-1)");
    const page = await pluginRpc("bot-teams", "view", { id });
    const ids = page.view.members.map(member => member.id).sort();
    if (JSON.stringify(ids) !== JSON.stringify([target, data.threadId].sort()) || page.view.members.some(member=>member.kind!=="thread")) throw new Error("Drop did not create a channel of both ordinary threads");
    const after = JSON.parse(await bbCli(["thread", "list", "--project", projectId, "--json"])).filter(thread => [data.threadId, target].includes(thread.id)).map(thread => ({ id: thread.id, projectId: thread.projectId, parentThreadId: thread.parentThreadId }));
    if (JSON.stringify(before.sort((a,b)=>a.id.localeCompare(b.id))) !== JSON.stringify(after.sort((a,b)=>a.id.localeCompare(b.id)))) throw new Error("Creating the channel moved or nested its member threads");
    await pluginRpc("thread-list-plus", "setPreference", { key: "organizationMode", value: preferences.organizationMode });
   };
  }) },
 ];
};
