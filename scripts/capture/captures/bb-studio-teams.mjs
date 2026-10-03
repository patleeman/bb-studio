import { launchRoomReplies } from "../bb.mjs";
import teamsCompanions from "./teams-companions.mjs";

export default context => {
 const {pluginRpc, launchRoomThread, getLaunchRoomId} = context;
 return [
 ...(process.env.BB_CAPTURE_TEAMS_COMPANIONS === "1" ? [teamsCompanions(context)] : []),
 {
  id:"bots-broadcasts",packageDir:"bb-studio-teams",fileName:"channel-broadcasts.png",
  setup:async client=>{
   await launchRoomThread();
   const launch=await pluginRpc("bot-teams","view",{id:getLaunchRoomId()});
   const view=await pluginRpc("bot-teams","viewCreate",{name:"Release review",members:launch.view.members,requestId:crypto.randomUUID()});
   const id=view.id;
   await client.navigate(`/plugins/bot-teams/channels/${id}`);
   await client.waitForSelector('[data-view-composer] .ProseMirror');
   const key=async(k,code,vk)=>{for(const type of ["keyDown","keyUp"])await client.command("Input.dispatchKeyEvent",{type,key:k,code,windowsVirtualKeyCode:vk});};
   for(const handle of ["all","channel"]){
    await client.evaluate(`document.querySelector('[data-view-composer] .ProseMirror').focus()`);
    await client.command("Input.insertText",{text:`@${handle}`});
    await client.waitForText("Channel mentions");
    await client.evaluate(`(()=>{const row=document.querySelector('button[title="Channel mentions: @${handle}"]');if(!row?.textContent.includes("Everyone in this channel"))throw new Error("Missing @${handle} completion");row.click();})()`);
    await client.evaluate(`(()=>{const editor=document.querySelector('[data-view-composer] .ProseMirror');if(!editor.textContent.includes("@${handle}"))throw new Error("Missing broadcast mention pill");editor.focus();})()`);
    const text=`Broadcast ${handle} check: reply with one short acknowledgement.`;
    await client.command("Input.insertText",{text:` ${text}`});
    await key("Enter","Enter",13);
    // The owner receipt appears only after the send succeeds. It must keep @.
    await client.evaluate(`new Promise((resolve,reject)=>{const end=Date.now()+20000;const tick=()=>[...document.querySelectorAll('[data-view-entry="user"]')].some(e=>e.textContent.includes(${JSON.stringify(text)}))?resolve():Date.now()>end?reject(new Error("Broadcast send did not produce an owner receipt")):setTimeout(tick,200);tick();})`,true);
    const page=await pluginRpc("bot-teams","view",{id});
    if(!page.entries.some(e=>e.role==="user"&&e.text.includes(`@${handle}`)&&e.text.includes(text)))throw new Error("Broadcast lost its @ on submit");
    for(const thread of page.threads.filter(t=>!t.parentThreadId)){
     await context.bbCli(["thread","wait",thread.id,"--timeout","1m"]);
     const messages=JSON.parse(await context.bbCli(["thread","messages",thread.id,"--json"]));
     if(!JSON.stringify(messages).includes(text))throw new Error(`@${handle} didn't reach ${thread.id}`);
    }
   }
   await client.evaluate(`document.querySelector('[data-view-composer] .ProseMirror').focus()`);
   await client.command("Input.insertText",{text:"@ch"});
   await client.waitForText("Channel mentions");
   await client.evaluate(`(()=>{const row=document.querySelector('button[title="Channel mentions: @channel"]');if(!row?.textContent.includes("Everyone in this channel"))throw new Error("Missing @channel broadcast suggestion");})()`);
   return async()=>{await key("Escape","Escape",27);for(let i=0;i<3;i++)await key("Backspace","Backspace",8);};
  }
 },
 {
  id:"bots",packageDir:"bb-studio-teams",fileName:"staged-preview.png",
  setup:async client=>{
   await launchRoomThread(); const id=getLaunchRoomId();
   // Channels used to live at /views/<id>; old links must land on the channel.
   await client.navigate(`/plugins/bot-teams/views/${id}`);
   await client.evaluate(`new Promise((resolve,reject)=>{const end=Date.now()+15000;const tick=()=>location.pathname==="/plugins/bot-teams/channels/${id}"?resolve():Date.now()>end?reject(new Error("Old view link stayed at "+location.pathname)):setTimeout(tick,200);tick();})`,true);
   await client.waitForSelector('[data-thread-view]');
   for(const text of launchRoomReplies)await client.waitForText(text);
   await client.evaluate(`(()=>{
    const composer=document.querySelector('[data-view-composer] [data-promptbox]');
    if(!composer)throw new Error("Missing view composer");
    if(!composer.querySelector('[aria-label="Prompt actions"]')||!composer.querySelector('[aria-label="Start voice input"]'))throw new Error("View composer lacks attachments or voice input");
    const header=document.querySelector('[data-view-header]');
    if(!header?.textContent.includes("Launch work"))throw new Error("Title bar lacks the view name");
    if(document.querySelector('[data-testid="app-page-header-content-row"] p')?.textContent==="Views"&&getComputedStyle(document.querySelector('[data-testid="app-page-header-content-row"] > div')).display!=="none")throw new Error("Title bar still shows the panel label");
    if(!document.querySelector('button[aria-label="Approval mode"]')?.textContent.includes("Each bot's own"))throw new Error("Missing approval mode control");
    if(document.body.innerText.includes("New in Float"))throw new Error("Studio Chat's Float bar covers the view");
    if(document.querySelectorAll('[data-view-entry="assistant"]').length<3)throw new Error("Missing final thread replies");
    if(!document.querySelector('[data-view-entry="user"]'))throw new Error("Missing owner messages");
   })()`);
   // Recipients come from @-mentions: each of the view's bots must be offered there.
   const key=async(k,code,vk)=>{for(const type of ["keyDown","keyUp"])await client.command("Input.dispatchKeyEvent",{type,key:k,code,windowsVirtualKeyCode:vk});};
   for(const [query,name] of [["@Atl","Atlas"],["@Scr","Scribe"]]){
    await client.evaluate(`document.querySelector('[data-view-composer] .ProseMirror').focus()`);
    await client.command("Input.insertText",{text:query});
    await client.waitForText("Bots");
    await client.evaluate(`(()=>{const heading=[...document.querySelectorAll("body *")].find(e=>e.children.length===0&&e.textContent.trim()==="Bots");const list=heading?.closest('[role="listbox"],[role="menu"],[data-radix-popper-content-wrapper]')??heading?.parentElement?.parentElement;if(!list?.textContent.includes(${JSON.stringify(name)}))throw new Error("Mentions don't offer ${name}");})()`);
    await key("Escape","Escape",27);
    for(let i=0;i<query.length;i++)await key("Backspace","Backspace",8);
   }
   await client.evaluate(`(()=>{if(document.querySelector('[data-view-composer] .ProseMirror').innerText.trim())throw new Error("Composer draft not cleared after the mention check");if(document.querySelector('[aria-label="Choose recipients"]'))throw new Error("Recipient picker is back");document.activeElement?.blur();})()`);
  }
 },
 {
  id:"bots-profile",packageDir:"bb-studio-teams",fileName:"bot-profile.png",
  setup:async client=>{
   const {bots}=await pluginRpc("bot-teams","list",null);const atlas=bots.find(b=>b.handle==="atlas");
   if(!atlas)throw new Error("Missing staged Atlas");
   await client.navigate(`/plugins/bot-teams/bots/${atlas.id}/profile`);
   await client.waitForText("Research and verify the facts");
  }
 },
 {
  id:"bots-sidebar",packageDir:"bb-studio-teams",fileName:"studio-sidebar.png",showSidebar:true,
  setup:async client=>{
   await launchRoomThread();
   await client.navigate("/plugins/studio/studio/view");
   await client.waitForSelector(`[data-studio-item="/plugins/bot-teams/channels/${getLaunchRoomId()}"]`);
   await client.evaluate(`document.querySelector('[data-studio-item="/plugins/bot-teams/channels/${getLaunchRoomId()}"]').click()`);
   await client.waitForSelector('[data-thread-view]');
   await client.waitForSelector('section[aria-label="Studio"]');
   await client.waitForSelector(`section[aria-label="Studio"] a[href="/plugins/bot-teams/channels/${getLaunchRoomId()}"]`);
   await client.evaluate(`(()=>{if(document.querySelector('section[aria-label="Views"]'))throw new Error("Saved views still have a separate sidebar section");})()`);
  }
 },
 {
  id:"bots-mobile",packageDir:"bb-studio-teams",fileName:"staged-preview-mobile.png",privateSidebar:false,
  setup:async client=>{
   await client.command("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:1,mobile:true});
   await launchRoomThread();await client.navigate(`/plugins/bot-teams/channels/${getLaunchRoomId()}`);
   await client.waitForSelector('[data-thread-view]');
   await client.waitForText("Logged: release check passed.");
   await client.evaluate(`(()=>{
    if(document.documentElement.scrollWidth>innerWidth)throw new Error("Saved view overflows the compact screen");
    const composer=document.querySelector('[data-thread-view] form');
    if(!composer||composer.getBoundingClientRect().bottom>innerHeight)throw new Error("Compact composer is offscreen");
    const reply=[...document.querySelectorAll('[data-view-entry="assistant"]')].at(-1);
    const timeline=reply?.closest('[data-thread-view]')?.querySelector('[data-view-timeline]');
    const controls=document.querySelector('[data-view-header]')?.closest("header");
    if(!controls||!timeline||timeline.getBoundingClientRect().top<controls.getBoundingClientRect().bottom-1)throw new Error("View title bar overlaps the timeline");
    if(!reply||!timeline||reply.getBoundingClientRect().bottom>timeline.getBoundingClientRect().bottom+1)throw new Error("Latest reply is hidden beneath the composer");
   })()`);
   return ()=>client.command("Emulation.setDeviceMetricsOverride",{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  }
 }
 ];
};
