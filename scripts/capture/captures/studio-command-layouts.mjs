// Exercise a Space's Command view and its native transcripts through the full staged stable BB application.
export default ({ pluginRpc, launchSpace, getLaunchSpaceId, bbCli, projectId, sleep }) => {
 let fixture;
 const settleThreads = async space => {
  // Their fixed launch replies are already present. Freeze any remaining
  // demo coordination so the Active check can start one known worker.
  await Promise.all(space.threads.map(thread => bbCli(["thread", "stop", thread.id])));
 };
 const seed = async () => {
  if (fixture) return fixture;
  await launchSpace();
  const spaceId = getLaunchSpaceId();
  const space = await pluginRpc("studio", "command", { spaceId });
  await settleThreads(space);
  const existing = space.threads.find(thread => thread.title === "Release checklist");
  if (existing) return (fixture = { id: spaceId, threadId: existing.id });
  const { entries } = await pluginRpc("studio", "commandFeed", { spaceId });
  if (entries.filter(entry => entry.role === "user" && entry.text.includes("Here's the ORBIT-42 launch brief.")).length !== 1) throw new Error("Merged layout shows the brief sent to two threads more than once");
  // An ordinary thread joins the Space beside the two other threads.
  const thread = JSON.parse(await bbCli(["thread", "spawn", "--project", projectId, "--provider", "codex", "--model", "gpt-6-luna", "--reasoning-level", "low", "--title", "Release checklist", "--prompt", 'This is a deterministic UI fixture. Do not use tools or change files. Reply exactly with these two lines:\nThe launch checklist is ready.\n::reactions{items="✅ Approve|🔍 Review"}', "--json"]));
  await bbCli(["thread", "wait", thread.id, "--timeout", "1m"]);
  await pluginRpc("studio", "spaceMembers", { id: spaceId, add: [{ pluginId: "bb-thread", id: thread.id }] });
  fixture = { id: spaceId, threadId: thread.id };
  return fixture;
 };
 const wait = (client, expression) => client.evaluate(`new Promise((resolve,reject)=>{const end=Date.now()+20000;const tick=()=>(${expression})?resolve():Date.now()>end?reject(new Error('Command view assertion failed: '+${JSON.stringify(expression)})):setTimeout(tick,200);tick();})`, true);
 const mode = async (client, value) => {
  await client.evaluate(`(()=>{const button=document.querySelector('[aria-label="Layout"] button[data-layout=${JSON.stringify(value)}]');if(!button)throw new Error('Missing view switcher button');button.click();})()`);
  await client.waitForSelector(`[aria-label="Layout"] button[data-layout="${value}"][aria-pressed="true"]`);
  await client.waitForSelector(value === "merged" ? "[data-command-timeline]" : `[data-channel-layout="${value}"]`);
 };
 const open = async (client, value) => {
  const data = await seed();
  await client.navigate(`/plugins/studio/studio/command/${data.id}`);
  await client.waitForSelector('[data-command-composer] .ProseMirror');
  await mode(client, value);
  return data;
 };
 const guard = setup => async client => {
  try { return await setup(client); }
  catch (error) {
   console.error(await client.evaluate("document.body.innerText.slice(-5000)").catch(() => "Page unavailable"));
   await client.capture(process.env.BB_CAPTURE_DEBUG_PATH || "/tmp/bb-command-view-error.png").catch(() => {});
   throw error;
  }
 };
 const margin = client => client.evaluate("(()=>{const box=document.querySelector('.channel-switcher');const scroller=document.querySelector('.channel-single .channel-pane-body > div > [class~=\\'overflow-y-auto\\']');if(!box||!scroller)throw new Error('Missing member box or thread transcript');const content=scroller.getBoundingClientRect().left+parseFloat(getComputedStyle(scroller).paddingLeft);if(box.getBoundingClientRect().right>content)throw new Error('Member box overlaps the transcript');if(scroller.getBoundingClientRect().width<innerWidth*0.6)throw new Error('Transcript does not scroll edge to edge');})()");
 const rows = "document.querySelectorAll('.channel-switcher-row > button').length";
 const clearDraft = async client => {
  await client.evaluate("document.querySelector('[data-command-composer] .ProseMirror').focus()");
  for (const type of ["keyDown", "keyUp"]) await client.command("Input.dispatchKeyEvent", { type, key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 4 });
  for (const type of ["keyDown", "keyUp"]) await client.command("Input.dispatchKeyEvent", { type, key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 });
 };
 const concise = client => client.evaluate(`(()=>{
  const text=Array.from(document.querySelectorAll('[data-channel-thread]')).map(pane=>pane.innerText).join('\\n');
  for(const marker of ['[Studio Command message','Recipients:'])if(text.includes(marker))throw new Error('Native transcript exposed transport context: '+marker);
  if(!text.includes("Here's the ORBIT-42 launch brief."))throw new Error('Native transcript lost the owner request');
 })()`);
 return [
  { id: "studio-command-grid", packageDir: "bb-studio", fileName: "command-grid.png", setup: guard(async client => {
   const data = await open(client, "grid");
   await wait(client, "document.querySelectorAll('[data-channel-thread]').length===3");
   await client.waitForText("The launch checklist is ready.");
   await client.waitForSelector(`[data-channel-thread="${data.threadId}"] [aria-label="Suggested reactions"]`);
   await client.waitForText("Ready. I checked the brief:");
   await concise(client);
   await clearDraft(client);
   await client.command("Input.insertText", { text: "Keep this Command draft." });
   await client.evaluate("(()=>{window.commandCaptureComposer=document.querySelector('[data-command-composer] .ProseMirror');return true;})()");
   for (const value of ["merged", "active", "focus", "grid"]) {
    await mode(client, value);
    await client.evaluate("(()=>{const editor=document.querySelector('[data-command-composer] .ProseMirror');if(editor!==window.commandCaptureComposer||!editor.textContent.includes('Keep this Command draft.'))throw new Error('Layout switch lost the Command draft');})()");
   }
   await clearDraft(client);
   const reactionSelector = `[data-channel-thread="${data.threadId}"] [aria-label="Suggested reactions"] button`;
   const reactionText = await client.evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(reactionSelector)})).find(button=>button.textContent.includes('Approve'))?.textContent.trim()`);
   if (!reactionText) throw new Error("Native reactions lack Approve");
   await client.clickElementWithTextAndPointer(reactionSelector, reactionText);
   await wait(client, "document.querySelector('[data-command-composer] .ProseMirror').textContent.includes('Approve')");
   await wait(client, "document.querySelector('[data-command-target]')?.textContent.includes('To Release checklist')");
   await clearDraft(client);
   await client.clickAriaButtonWithPointer("Send to the lead instead");
   await wait(client, "document.querySelector('[data-command-target]')?.textContent.includes('To Atlas · lead')");
   await client.evaluate("document.activeElement?.blur()");
  }) },
  { id: "studio-command-grid-arrange", packageDir: "bb-studio", fileName: "command-grid-arrange.png", setup: guard(async client => {
   const data = await open(client, "grid");
   await wait(client, "document.querySelectorAll('[data-channel-thread]').length===3");
   await client.evaluate("(()=>{const reset=Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Reset order');if(reset)reset.click();})()");
   const order = "Array.from(document.querySelectorAll('[data-channel-thread]')).map(p=>p.getAttribute('data-channel-thread'))";
   const before = await client.evaluate(order);
   const dragged = data.threadId, target = before.find(id => id !== dragged);
   // Drive the real pane handlers with a browser DataTransfer, holding the drag over the first other pane.
   await client.evaluate(`(()=>{const pane=id=>document.querySelector('[data-channel-thread="'+id+'"]');const dt=new DataTransfer();window.commandArrangeDrag=dt;const rect=pane(${JSON.stringify(target)}).getBoundingClientRect();pane(${JSON.stringify(dragged)}).querySelector('header').dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:dt}));pane(${JSON.stringify(target)}).dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:dt,clientX:rect.left+12,clientY:rect.top+rect.height/2}));})()`);
   await client.waitForSelector(`[data-channel-thread="${target}"][data-drop="before"]`);
   await client.waitForSelector(`[data-channel-thread="${dragged}"][data-dragging]`);
   return async () => {
    await client.evaluate(`(()=>{const dt=window.commandArrangeDrag;const pane=id=>document.querySelector('[data-channel-thread="'+id+'"]');pane(${JSON.stringify(target)}).dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt}));pane(${JSON.stringify(dragged)}).querySelector('header').dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:dt}));})()`);
    const expected = before.filter(id => id !== dragged).flatMap(id => id === target ? [dragged, id] : [id]);
    await wait(client, `JSON.stringify(${order})===${JSON.stringify(JSON.stringify(expected))}`);
    await client.navigate(`/plugins/studio/studio/command/${data.id}`);
    await client.waitForSelector('[data-command-composer] .ProseMirror');
    await wait(client, `document.querySelectorAll('[data-channel-thread]').length===3&&JSON.stringify(${order})===${JSON.stringify(JSON.stringify(expected))}`);
    await client.clickElementWithTextAndPointer("button.channel-reset-order", "Reset order");
    await wait(client, `JSON.stringify(${order})===${JSON.stringify(JSON.stringify(before))}`);
   };
  }) },
  { id: "studio-command-focus", packageDir: "bb-studio", fileName: "command-focus.png", setup: guard(async client => {
   const data = await open(client, "grid");
   await client.clickAriaButtonWithPointer("Focus Release checklist");
   await wait(client, `document.querySelectorAll('[data-channel-thread]').length===1&&!!document.querySelector('[data-channel-thread="${data.threadId}"]')`);
   await client.waitForSelector(`[data-channel-thread="${data.threadId}"] [aria-label="Suggested reactions"]`);
   await wait(client, `${rows}===3&&document.querySelector('.channel-switcher-row[data-current] button')?.textContent.includes('Release checklist')`);
   await margin(client);
  }) },
  { id: "studio-command-focus-compact", packageDir: "bb-studio", fileName: "command-focus-compact.png", setup: guard(async client => {
   // A narrower window keeps the member box in the margin as avatars only.
   await client.command("Emulation.setDeviceMetricsOverride", { width: 1040, height: 800, deviceScaleFactor: 1, mobile: false });
   const data = await open(client, "focus");
   await client.clickAriaButtonWithPointer("Release checklist, Idle");
   await wait(client, `!!document.querySelector('[data-channel-thread="${data.threadId}"]')&&${rows}===3&&getComputedStyle(document.querySelector('.channel-switcher .channel-rail-name')).display==='none'`);
   await margin(client);
   return () => client.command("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  }) },
  { id: "studio-command-active", packageDir: "bb-studio", fileName: "command-active.png", setup: guard(async client => {
   const data = await open(client, "active");
   const page = await pluginRpc("studio", "command", { spaceId: data.id });
   const atlas = page.threads.find(thread => !thread.parentThreadId && thread.title === "Atlas");
   if (!atlas) throw new Error("Missing Atlas's thread in the Space");
   if (page.leadThreadId !== atlas.id) throw new Error("Atlas's thread is not the Space's lead");
   const workers = [data.threadId, atlas.id];
   const stop = () => Promise.all(workers.map(id => bbCli(["thread", "stop", id]).catch(() => {})));
   for (const id of workers) await bbCli(["thread", "tell", id, "For a staged UI activity check, use the terminal to run sleep 45, then reply only Check finished. Change no files."]);
   const panes = "Array.from(document.querySelectorAll('[data-channel-layout=\"active\"] [data-channel-thread]')).map(p=>p.getAttribute('data-channel-thread'))";
   try {
    // Active shows every working thread side by side, beside the member box.
    await wait(client, `${panes}.length===2&&${JSON.stringify(workers)}.every(id=>${panes}.includes(id))&&document.querySelectorAll('.channel-switcher-row[data-current][data-activity="Working"]').length===2`);
    await client.evaluate("(()=>{const box=document.querySelector('.channel-switcher').getBoundingClientRect();const panes=Array.from(document.querySelectorAll('[data-channel-layout=\"active\"] [data-channel-thread]')).map(p=>p.getBoundingClientRect());if(panes.some(p=>p.left<box.right))throw new Error('Member box overlaps an Active pane');if(Math.abs(panes[0].top-panes[1].top)>2)throw new Error('Active panes are not side by side');})()");
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
  { id: "studio-command-grid-mobile", packageDir: "bb-studio", fileName: "command-grid-mobile.png", privateSidebar: false, setup: guard(async client => {
   await client.command("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
   await open(client, "grid");
   await wait(client, "document.querySelectorAll('[data-channel-thread]').length===3");
   // Phone panes stack; scroll to the last one as a reader would, then return to the top.
   await client.evaluate("document.querySelector('[data-channel-thread]:last-of-type').scrollIntoView({block:'start'})");
   await client.waitForText("Ready. I checked the brief:");
   await concise(client);
   await client.evaluate("document.querySelector('.channel-thread-stage').scrollTop=0");
   await client.evaluate("(()=>{if(document.documentElement.scrollWidth>innerWidth)throw new Error('Grid overflows the phone');const composer=document.querySelector('[data-command-composer]');if(!composer||composer.getBoundingClientRect().bottom>innerHeight)throw new Error('Grid composer is offscreen');})()");
   return () => client.command("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  }) },
  { id: "studio-command-focus-mobile", packageDir: "bb-studio", fileName: "command-focus-mobile.png", privateSidebar: false, setup: guard(async client => {
   await client.command("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
   await open(client, "grid");
   await client.evaluate("document.querySelector('[aria-label=\"Focus Atlas\"]').closest('[data-channel-thread]').scrollIntoView({block:'start'})");
   await client.clickAriaButtonWithPointer("Focus Atlas");
   await client.waitForSelector('[data-channel-layout="focus"]');
   await client.waitForText("Ready. I checked the brief:");
   await concise(client);
   await client.evaluate("(()=>{if(document.querySelectorAll('[data-channel-thread]').length!==1||document.querySelectorAll('.channel-switcher-row > button').length!==3)throw new Error('Phone focus lost its selected thread or member row');if(document.documentElement.scrollWidth>innerWidth||document.querySelector('[data-command-composer]').getBoundingClientRect().bottom>innerHeight)throw new Error('Phone focus exceeds the viewport');})()");
   return () => client.command("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  }) },
 ];
};
