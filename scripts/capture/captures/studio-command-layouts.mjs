// Exercise a Space's Command view and its native transcripts through the full staged stable BB application.
export default ({ pluginRpc, launchSpace, getLaunchSpaceId, bbCli, projectId, sleep }) => {
 let fixture;
 const settleThreads = async space => {
  // Their fixed launch replies are already present. Freeze any remaining
  // demo coordination so the follow check can start one known worker.
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
  if (entries.filter(entry => entry.role === "user" && entry.text.includes("Here's the ORBIT-42 launch brief.")).length !== 1) throw new Error("The feed shows the brief sent to two threads more than once");
  // An ordinary thread joins the Space beside the two other threads.
  const thread = JSON.parse(await bbCli(["thread", "spawn", "--project", projectId, "--provider", "codex", "--model", "gpt-6-luna", "--reasoning-level", "low", "--title", "Release checklist", "--prompt", 'This is a deterministic UI fixture. Do not use tools or change files. Reply exactly with these two lines:\nThe launch checklist is ready.\n::reactions{items="✅ Approve|🔍 Review"}', "--json"]));
  await bbCli(["thread", "wait", thread.id, "--timeout", "1m"]);
  await pluginRpc("studio", "spaceMembers", { id: spaceId, add: [{ pluginId: "bb-thread", id: thread.id }] });
  fixture = { id: spaceId, threadId: thread.id };
  return fixture;
 };
 const wait = (client, expression) => client.evaluate(`new Promise((resolve,reject)=>{const end=Date.now()+20000;const tick=()=>(${expression})?resolve():Date.now()>end?reject(new Error('Command view assertion failed: '+${JSON.stringify(expression)})):setTimeout(tick,200);tick();})`, true);
 const panes = "Array.from(document.querySelectorAll('[data-command-panes] [data-channel-thread]')).map(p=>p.getAttribute('data-channel-thread'))";
 // Opens a thread from the list beside the composer; one already open stays put.
 const show = (client, title) => client.evaluate(`(()=>{const row=Array.from(document.querySelectorAll('[aria-label="Space threads"] button[aria-pressed]')).find(b=>b.getAttribute('aria-label').startsWith(${JSON.stringify(title + ", ")}));if(!row)throw new Error('Missing thread row: '+${JSON.stringify(title)});if(row.getAttribute('aria-pressed')!=='true')row.click();})()`);
 const follow = async client => {
  await client.evaluate("(()=>{const back=document.querySelector('[aria-label=\"Follow work\"]');if(back&&back.getAttribute('aria-pressed')!=='true')back.click();})()");
  await wait(client, `${panes}.length===1&&!!document.querySelector('[data-command-following]')`);
 };
 const open = async (client, titles = []) => {
  const data = await seed();
  await client.navigate(`/plugins/studio/studio/command/${data.id}`);
  await client.waitForSelector('[data-command-composer] .ProseMirror');
  await client.waitForSelector('[data-command-panes]');
  await follow(client);
  for (const title of titles) await show(client, title);
  if (titles.length) await wait(client, `${panes}.length===${new Set(titles).size + 1}||${panes}.length===${new Set(titles).size}`);
  return data;
 };
 const all = client => open(client, ["Atlas", "Scribe", "Release checklist"]).then(async data => { await wait(client, `${panes}.length===3`); return data; });
 const guard = setup => async client => {
  try { return await setup(client); }
  catch (error) {
   console.error(await client.evaluate("document.body.innerText.slice(-5000)").catch(() => "Page unavailable"));
   await client.capture(process.env.BB_CAPTURE_DEBUG_PATH || "/tmp/bb-command-view-error.png").catch(() => {});
   throw error;
  }
 };
 // The thread list sits beside the composer, never over the panes.
 const docked = client => client.evaluate("(()=>{const list=document.querySelector('.channel-switcher')?.getBoundingClientRect();const composer=document.querySelector('[data-command-composer]')?.getBoundingClientRect();const stage=document.querySelector('.channel-thread-stage')?.getBoundingClientRect();if(!list||!composer||!stage)throw new Error('Missing thread list, composer or panes');if(list.top<stage.bottom-1)throw new Error('Thread list overlaps the panes');if(innerWidth>820&&list.left<composer.right)throw new Error('Thread list is not beside the composer');const box=document.querySelector('[data-command-composer] form')?.getBoundingClientRect(),rows=document.querySelector('.channel-switcher-list')?.getBoundingClientRect();if(innerWidth>820&&(!box||!rows||Math.abs(box.top-rows.top)>1||Math.abs(box.bottom-rows.bottom)>1))throw new Error('Thread list is not as tall as the composer box');})()");
 const rows = "document.querySelectorAll('[aria-label=\"Space threads\"] button[aria-pressed]').length";
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
 const captures = [
  { id: "studio-command-grid", packageDir: "bb-studio", fileName: "command-grid.png", setup: guard(async client => {
   const data = await all(client);
   await client.waitForText("The launch checklist is ready.");
   await client.waitForSelector(`[data-channel-thread="${data.threadId}"] [aria-label="Suggested reactions"]`);
   await client.waitForText("Ready. I checked the brief:");
   await concise(client);
   await docked(client);
   await clearDraft(client);
   await client.command("Input.insertText", { text: "Keep this Command draft." });
   await client.evaluate("(()=>{window.commandCaptureComposer=document.querySelector('[data-command-composer] .ProseMirror');return true;})()");
   // Closing panes and following again keep the draft.
   await client.clickAriaButtonWithPointer("Close Scribe");
   await wait(client, `${panes}.length===2&&!document.querySelector('[data-command-panes] [aria-label="Scribe transcript"]')`);
   await follow(client);
   for (const title of ["Atlas", "Scribe", "Release checklist"]) await show(client, title);
   await wait(client, `${panes}.length===3`);
   await client.evaluate("(()=>{const editor=document.querySelector('[data-command-composer] .ProseMirror');if(editor!==window.commandCaptureComposer||!editor.textContent.includes('Keep this Command draft.'))throw new Error('Opening and closing panes lost the Command draft');})()");
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
   const data = await all(client);
   const before = await client.evaluate(panes);
   const dragged = data.threadId, target = before.find(id => id !== dragged);
   // Drive the real pane handlers with a browser DataTransfer, holding the drag over the first other pane.
   await client.evaluate(`(()=>{const pane=id=>document.querySelector('[data-channel-thread="'+id+'"]');const dt=new DataTransfer();window.commandArrangeDrag=dt;const rect=pane(${JSON.stringify(target)}).getBoundingClientRect();pane(${JSON.stringify(dragged)}).querySelector('header').dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:dt}));pane(${JSON.stringify(target)}).dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:dt,clientX:rect.left+12,clientY:rect.top+rect.height/2}));})()`);
   await client.waitForSelector(`[data-channel-thread="${target}"][data-drop="before"]`);
   await client.waitForSelector(`[data-channel-thread="${dragged}"][data-dragging]`);
   return async () => {
    await client.evaluate(`(()=>{const dt=window.commandArrangeDrag;const pane=id=>document.querySelector('[data-channel-thread="'+id+'"]');pane(${JSON.stringify(target)}).dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt}));pane(${JSON.stringify(dragged)}).querySelector('header').dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:dt}));})()`);
    const expected = before.filter(id => id !== dragged).flatMap(id => id === target ? [dragged, id] : [id]);
    await wait(client, `JSON.stringify(${panes})===${JSON.stringify(JSON.stringify(expected))}`);
    // The open panes and their order survive a reload.
    await client.navigate(`/plugins/studio/studio/command/${data.id}`);
    await client.waitForSelector('[data-command-composer] .ProseMirror');
    await wait(client, `JSON.stringify(${panes})===${JSON.stringify(JSON.stringify(expected))}`);
   };
  }) },
  { id: "studio-command-close", packageDir: "bb-studio", fileName: "command-close.png", setup: guard(async client => {
   const data = await all(client);
   // Closing hides a pane; the thread list opens it again.
   await client.clickAriaButtonWithPointer("Close Release checklist");
   await wait(client, `${panes}.length===2&&!${panes}.includes(${JSON.stringify(data.threadId)})&&document.querySelector('[aria-label="Space threads"] button[aria-label^="Release checklist, "]')?.getAttribute('aria-pressed')==='false'`);
   await show(client, "Release checklist");
   await wait(client, `${panes}.length===3&&${panes}[2]===${JSON.stringify(data.threadId)}`);
   await client.clickAriaButtonWithPointer("Show only Release checklist");
   await wait(client, `${panes}.length===1&&${panes}[0]===${JSON.stringify(data.threadId)}&&!document.querySelector('[data-command-following]')`);
   await client.waitForSelector(`[data-channel-thread="${data.threadId}"] [aria-label="Suggested reactions"]`);
   await wait(client, `${rows}===3&&document.querySelector('.channel-switcher-row[data-current] button')?.textContent.includes('Release checklist')`);
   await docked(client);
  }) },
  { id: "studio-command-follow", packageDir: "bb-studio", fileName: "command-follow.png", setup: guard(async client => {
   const data = await open(client);
   const page = await pluginRpc("studio", "command", { spaceId: data.id });
   const scribe = page.threads.find(thread => !thread.parentThreadId && thread.title === "Scribe");
   if (!scribe) throw new Error("Missing Scribe's thread in the Space");
   const stop = () => bbCli(["thread", "stop", scribe.id]).catch(() => {});
   await bbCli(["thread", "tell", scribe.id, "For a staged UI activity check, use the terminal to run sleep 45, then reply only Check finished. Change no files."]);
   try {
    // One pane follows whichever thread is working.
    await wait(client, `${panes}.length===1&&${panes}[0]===${JSON.stringify(scribe.id)}&&!!document.querySelector('[data-command-following]')&&document.querySelector('[data-channel-thread] .channel-status')?.textContent.includes('Working')`);
    await docked(client);
   } catch (error) { await stop(); throw error; }
   return async () => {
    await stop();
    // When the work stops the pane stays; opening another thread makes a grid.
    await wait(client, `${panes}.length===1&&${panes}[0]===${JSON.stringify(scribe.id)}&&!document.querySelector('.channel-switcher-row[data-activity="Working"]')`);
    await show(client, "Atlas");
    await wait(client, `${panes}.length===2&&!document.querySelector('[data-command-following]')`);
    await follow(client);
   };
  }) },
  { id: "studio-command-grid-mobile", packageDir: "bb-studio", fileName: "command-grid-mobile.png", privateSidebar: false, setup: guard(async client => {
   await client.command("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
   await all(client);
   // Native transcripts virtualize offscreen panes. Read Atlas before scrolling to Scribe.
   await client.evaluate("document.querySelector('[data-channel-thread]:first-of-type').scrollIntoView({block:'start'})");
   await client.waitForText("Ready. I checked the brief:");
   await concise(client);
   await client.evaluate("document.querySelector('[data-channel-thread]:nth-of-type(2)').scrollIntoView({block:'start'})");
   await client.waitForText("Ready. I'll keep the decision log");
   await client.evaluate("document.querySelector('.channel-thread-stage').scrollTop=0");
   await client.evaluate("(()=>{if(document.documentElement.scrollWidth>innerWidth)throw new Error('Grid overflows the phone');const composer=document.querySelector('[data-command-composer]');if(!composer||composer.getBoundingClientRect().bottom>innerHeight)throw new Error('Grid composer is offscreen');const list=document.querySelector('.channel-switcher').getBoundingClientRect();if(list.bottom>composer.getBoundingClientRect().top+1)throw new Error('Phone thread chips are not above the composer');})()");
   return () => client.command("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  }) },
  { id: "studio-command-follow-mobile", packageDir: "bb-studio", fileName: "command-follow-mobile.png", privateSidebar: false, setup: guard(async client => {
   await client.command("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
   // With nothing working, the one pane follows the lead.
   await open(client);
   await wait(client, `${panes}.length===1&&!!document.querySelector('[data-command-panes] [aria-label="Atlas transcript"]')&&!!document.querySelector('[data-command-following]')`);
   await client.waitForText("Ready. I checked the brief:");
   await concise(client);
   await client.evaluate(`(()=>{if(${rows}!==3)throw new Error('Phone lost a thread chip');if(document.documentElement.scrollWidth>innerWidth||document.querySelector('[data-command-composer]').getBoundingClientRect().bottom>innerHeight)throw new Error('Phone view exceeds the viewport');})()`);
   return () => client.command("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  }) },
 ];
 // The follow check starts real work, so it runs last.
 return [...captures.filter(capture => capture.id !== "studio-command-follow"), ...captures.filter(capture => capture.id === "studio-command-follow")];
};
