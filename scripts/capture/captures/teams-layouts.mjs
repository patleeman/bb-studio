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
  // Quinn joins without a thread here, so every layout shows a member that hasn't started.
  const quinn = (await pluginRpc("bot-teams", "profiles", {})).find(bot => bot.handle === "quinn");
  if (!quinn) throw new Error("Missing the seeded Quinn bot");
  const members = [...launch.threads.filter(thread => !thread.parentThreadId).map(thread => ({ kind: "thread", id: thread.id })), { kind: "thread", id: thread.id }, { kind: "bot", id: quinn.id }];
  const view = await pluginRpc("bot-teams", "viewCreate", { name: "Channel layouts", members, requestId: crypto.randomUUID() });
  fixture = { id: view.id, threadId: thread.id };
  return fixture;
 };
 const wait = (client, expression) => client.evaluate(`new Promise((resolve,reject)=>{const end=Date.now()+20000;const tick=()=>(${expression})?resolve():Date.now()>end?reject(new Error('Channel assertion failed: '+${JSON.stringify(expression)})):setTimeout(tick,200);tick();})`, true);
 const mode = async (client, value) => {
  await client.evaluate(`(()=>{const button=document.querySelector('[aria-label="Channel view"] button[data-layout=${JSON.stringify(value)}]');if(!button)throw new Error('Missing view switcher button');button.click();})()`);
  await client.waitForSelector(`[aria-label="Channel view"] button[data-layout="${value}"][aria-pressed="true"]`);
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
 const margin = client => client.evaluate("(()=>{const box=document.querySelector('.channel-switcher');const scroller=document.querySelector('.channel-single .channel-pane-body > div > [class~=\\'overflow-y-auto\\']');if(!box||!scroller)throw new Error('Missing member box or thread transcript');const content=scroller.getBoundingClientRect().left+parseFloat(getComputedStyle(scroller).paddingLeft);if(box.getBoundingClientRect().right>content)throw new Error('Member box overlaps the transcript');if(scroller.getBoundingClientRect().width<innerWidth*0.6)throw new Error('Transcript does not scroll edge to edge');})()");
 const rows = "document.querySelectorAll('.channel-switcher-row > button').length";
 const unstarted = scope => client => client.evaluate(`(()=>{const quinn=Array.from(document.querySelectorAll('[data-channel-layout="${scope}"] .channel-member-unstarted')).find(node=>node.textContent.includes('Quinn'));if(!quinn)throw new Error('${scope} lost the unstarted member');if(getComputedStyle(quinn).borderTopStyle!=='dashed')throw new Error('${scope} unstarted member lacks the dashed outline');})()`);
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
   await unstarted("grid")(client);
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
  { id: "bots-grid-arrange", packageDir: "bb-studio-teams", fileName: "channel-grid-arrange.png", setup: guard(async client => {
   const data = await open(client, "grid");
   await wait(client, "document.querySelectorAll('[data-channel-thread]').length===3");
   await client.evaluate("(()=>{const reset=Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Reset order');if(reset)reset.click();})()");
   const order = "Array.from(document.querySelectorAll('[data-channel-thread]')).map(p=>p.getAttribute('data-channel-thread'))";
   const before = await client.evaluate(order);
   const dragged = data.threadId, target = before.find(id => id !== dragged);
   // Drive the real pane handlers with a browser DataTransfer, holding the drag over the first other pane.
   await client.evaluate(`(()=>{const pane=id=>document.querySelector('[data-channel-thread="'+id+'"]');const dt=new DataTransfer();window.channelArrangeDrag=dt;const rect=pane(${JSON.stringify(target)}).getBoundingClientRect();pane(${JSON.stringify(dragged)}).querySelector('header').dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:dt}));pane(${JSON.stringify(target)}).dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:dt,clientX:rect.left+12,clientY:rect.top+rect.height/2}));})()`);
   await client.waitForSelector(`[data-channel-thread="${target}"][data-drop="before"]`);
   await client.waitForSelector(`[data-channel-thread="${dragged}"][data-dragging]`);
   return async () => {
    await client.evaluate(`(()=>{const dt=window.channelArrangeDrag;const pane=id=>document.querySelector('[data-channel-thread="'+id+'"]');pane(${JSON.stringify(target)}).dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt}));pane(${JSON.stringify(dragged)}).querySelector('header').dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:dt}));})()`);
    const expected = before.filter(id => id !== dragged).flatMap(id => id === target ? [dragged, id] : [id]);
    await wait(client, `JSON.stringify(${order})===${JSON.stringify(JSON.stringify(expected))}`);
    await client.navigate(`/plugins/bot-teams/channels/${data.id}`);
    await client.waitForSelector('[data-view-composer] .ProseMirror');
    await wait(client, `document.querySelectorAll('[data-channel-thread]').length===3&&JSON.stringify(${order})===${JSON.stringify(JSON.stringify(expected))}`);
    await client.clickElementWithTextAndPointer("button.channel-reset-order", "Reset order");
    await wait(client, `JSON.stringify(${order})===${JSON.stringify(JSON.stringify(before))}`);
   };
  }) },
  { id: "bots-focus", packageDir: "bb-studio-teams", fileName: "channel-focus.png", setup: guard(async client => {
   const data = await open(client, "grid");
   await client.clickAriaButtonWithPointer("Focus Release checklist");
   await wait(client, `document.querySelectorAll('[data-channel-thread]').length===1&&!!document.querySelector('[data-channel-thread="${data.threadId}"]')`);
   await client.waitForSelector(`[data-channel-thread="${data.threadId}"] [aria-label="Suggested reactions"]`);
   await wait(client, `${rows}===3&&document.querySelector('.channel-switcher-row[data-current] button')?.textContent.includes('Release checklist')`);
   await margin(client);
   await unstarted("focus")(client);
  }) },
  { id: "bots-focus-compact", packageDir: "bb-studio-teams", fileName: "channel-focus-compact.png", setup: guard(async client => {
   // A narrower window keeps the member box in the margin as avatars only.
   await client.command("Emulation.setDeviceMetricsOverride", { width: 1040, height: 800, deviceScaleFactor: 1, mobile: false });
   const data = await open(client, "focus");
   await client.clickAriaButtonWithPointer("Release checklist, Idle");
   await wait(client, `!!document.querySelector('[data-channel-thread="${data.threadId}"]')&&${rows}===3&&getComputedStyle(document.querySelector('.channel-switcher .channel-rail-name')).display==='none'`);
   await margin(client);
   return () => client.command("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  }) },
  { id: "bots-active", packageDir: "bb-studio-teams", fileName: "channel-active.png", setup: guard(async client => {
   const data = await open(client, "active");
   const bots = await pluginRpc("bot-teams", "profiles", {});
   const page = await pluginRpc("bot-teams", "view", { id: data.id });
   const atlas = page.threads.find(thread => !thread.parentThreadId && thread.botId === bots.find(bot => bot.handle === "atlas")?.id);
   if (!atlas) throw new Error("Missing Atlas's channel thread");
   const workers = [data.threadId, atlas.id];
   const stop = () => Promise.all(workers.map(id => bbCli(["thread", "stop", id]).catch(() => {})));
   for (const id of workers) await bbCli(["thread", "tell", id, "For a staged UI activity check, use the terminal to run sleep 45, then reply only Check finished. Change no files."]);
   const panes = "Array.from(document.querySelectorAll('[data-channel-layout=\"active\"] [data-channel-thread]')).map(p=>p.getAttribute('data-channel-thread'))";
   try {
    // Active shows every working thread side by side, beside the member box.
    await wait(client, `${panes}.length===2&&${JSON.stringify(workers)}.every(id=>${panes}.includes(id))&&document.querySelectorAll('.channel-switcher-row[data-current][data-activity="Working"]').length===2`);
    await client.evaluate("(()=>{const box=document.querySelector('.channel-switcher').getBoundingClientRect();const panes=Array.from(document.querySelectorAll('[data-channel-layout=\"active\"] [data-channel-thread]')).map(p=>p.getBoundingClientRect());if(panes.some(p=>p.left<box.right))throw new Error('Member box overlaps an Active pane');if(Math.abs(panes[0].top-panes[1].top)>2)throw new Error('Active panes are not side by side');})()");
    await unstarted("active")(client);
   } catch (error) { await stop(); throw error; }
   return async () => {
    await stop();
    // Finished threads stay, and a pick joins them first without leaving Active.
    await wait(client, `${panes}.length===2&&!document.querySelector('.channel-switcher-row[data-activity="Working"]')`);
    await client.clickAriaButtonWithPointer("Scribe, Idle");
    await wait(client, `!!document.querySelector('[data-channel-layout="active"]')&&${panes}.length===3&&!!document.querySelector('[aria-label="Stop showing Scribe"]')`);
    await client.clickAriaButtonWithPointer("Stop showing Scribe");
    await wait(client, `${panes}.length===2`);
   };
  }) },
  { id: "bots-grid-mobile", packageDir: "bb-studio-teams", fileName: "channel-grid-mobile.png", privateSidebar: false, setup: guard(async client => {
   await client.command("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
   await open(client, "grid");
   await wait(client, "document.querySelectorAll('[data-channel-thread]').length===3");
   // Phone panes stack; scroll to the last one as a reader would, then return to the top.
   await client.evaluate("document.querySelector('[data-channel-thread]:last-of-type').scrollIntoView({block:'start'})");
   await client.waitForText("Ready. I checked the brief:");
   await concise(client);
   await client.evaluate("document.querySelector('.channel-thread-stage').scrollTop=0");
   await client.evaluate("(()=>{if(document.documentElement.scrollWidth>innerWidth)throw new Error('Grid overflows the phone');const composer=document.querySelector('[data-view-composer]');if(!composer||composer.getBoundingClientRect().bottom>innerHeight)throw new Error('Grid composer is offscreen');})()");
   return () => client.command("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  }) },
  { id: "bots-focus-mobile", packageDir: "bb-studio-teams", fileName: "channel-focus-mobile.png", privateSidebar: false, setup: guard(async client => {
   await client.command("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
   await open(client, "grid");
   await client.evaluate("document.querySelector('[aria-label=\"Focus Atlas\"]').closest('[data-channel-thread]').scrollIntoView({block:'start'})");
   await client.clickAriaButtonWithPointer("Focus Atlas");
   await client.waitForSelector('[data-channel-layout="focus"]');
   await client.waitForText("Ready. I checked the brief:");
   await concise(client);
   await client.evaluate("(()=>{if(document.querySelectorAll('[data-channel-thread]').length!==1||document.querySelectorAll('.channel-switcher-row > button').length!==3)throw new Error('Phone focus lost its selected thread or member row');if(document.documentElement.scrollWidth>innerWidth||document.querySelector('[data-view-composer]').getBoundingClientRect().bottom>innerHeight)throw new Error('Phone focus exceeds the viewport');})()");
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
