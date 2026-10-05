import { launchReplies } from "../bb.mjs";
import teamsCommand from "./teams-command.mjs";
import teamsComposer from "./teams-composer.mjs";

export default context => {
 const {pluginRpc, launchSpace, getLaunchSpaceId} = context;
 const merged = async client => {
  await launchSpace(); const spaceId=getLaunchSpaceId();
  await client.evaluate(`localStorage.setItem("bot-teams:command-layout:${spaceId}","merged")`);
  await client.navigate(`/plugins/bot-teams/command/${spaceId}`);
  await client.waitForSelector('[data-command-timeline]');
 };
 return [
 ...teamsCommand(context),
 ...teamsComposer(context),
 {
  id:"bots-broadcasts",packageDir:"bb-studio-teams",fileName:"command-broadcasts.png",
  setup:async client=>{
   await launchSpace(); const spaceId=getLaunchSpaceId();
   // Merged shows the receipts the broadcast check waits for.
   await client.evaluate(`localStorage.setItem("bot-teams:command-layout:${spaceId}","merged")`);
   await client.navigate(`/plugins/bot-teams/command/${spaceId}`);
   await client.waitForSelector('[data-command-composer] .ProseMirror');
   const key=async(k,code,vk)=>{for(const type of ["keyDown","keyUp"])await client.command("Input.dispatchKeyEvent",{type,key:k,code,windowsVirtualKeyCode:vk});};
   await client.evaluate(`document.querySelector('[data-command-composer] .ProseMirror').focus()`);
   await client.command("Input.insertText",{text:"@all"});
   await client.waitForText("Everyone");
   await client.evaluate(`(()=>{const row=document.querySelector('button[title="Everyone: @all"]');if(!row?.textContent.includes("Every thread in this Command view"))throw new Error("Missing @all completion");row.click();})()`);
   await client.evaluate(`(()=>{const editor=document.querySelector('[data-command-composer] .ProseMirror');if(!editor.textContent.includes("@all"))throw new Error("Missing broadcast mention pill");editor.focus();})()`);
   const text="Broadcast all check: reply with one short acknowledgement.";
   await client.command("Input.insertText",{text:` ${text}`});
   await key("Enter","Enter",13);
   // The owner message appears only after the send succeeds. It must keep @.
   await client.evaluate(`new Promise((resolve,reject)=>{const end=Date.now()+20000;const tick=()=>[...document.querySelectorAll('[data-command-entry="user"]')].some(e=>e.textContent.includes(${JSON.stringify(text)}))?resolve():Date.now()>end?reject(new Error("Broadcast send did not show the owner message")):setTimeout(tick,200);tick();})`,true);
   const {entries}=await pluginRpc("bot-teams","commandFeed",{spaceId});
   if(!entries.some(e=>e.role==="user"&&e.text.includes("@all")&&e.text.includes(text)))throw new Error("Broadcast lost its @ on submit");
   const {threads}=await pluginRpc("bot-teams","command",{spaceId});
   for(const thread of threads.filter(t=>!t.parentThreadId)){
    await context.bbCli(["thread","wait",thread.id,"--timeout","1m"]);
    const messages=JSON.parse(await context.bbCli(["thread","messages",thread.id,"--json"]));
    if(!JSON.stringify(messages).includes(text))throw new Error(`@all didn't reach ${thread.id}`);
   }
   await client.evaluate(`document.querySelector('[data-command-composer] .ProseMirror').focus()`);
   await client.command("Input.insertText",{text:"@al"});
   await client.waitForText("Everyone");
   await client.evaluate(`(()=>{const row=document.querySelector('button[title="Everyone: @all"]');if(!row?.textContent.includes("Every thread in this Command view"))throw new Error("Missing @all broadcast suggestion");})()`);
   return async()=>{await key("Escape","Escape",27);for(let i=0;i<3;i++)await key("Backspace","Backspace",8);};
  }
 },
 {
  id:"bots",packageDir:"bb-studio-teams",fileName:"staged-preview.png",
  setup:async client=>{
   await merged(client);
   for(const text of launchReplies)await client.waitForText(text);
   await client.evaluate(`(()=>{
    const composer=document.querySelector('[data-command-composer] [data-promptbox]');
    if(!composer)throw new Error("Missing Command composer");
    if(!composer.querySelector('[aria-label="Prompt actions"]')||!composer.querySelector('[aria-label="Start voice input"]'))throw new Error("Command composer lacks attachments or voice input");
    const header=document.querySelector('nav[aria-label="Breadcrumb"]');
    if(!header?.textContent.includes("Launch work")||!header.textContent.includes("Command"))throw new Error("Title bar lacks the Space name and Command");
    if(!document.querySelector('[aria-label="Layout"] button[data-layout="merged"][aria-pressed="true"]'))throw new Error("Missing the layout toggles");
    if(!document.querySelector('[data-command-target]')?.textContent.includes("To Atlas · lead"))throw new Error("The composer doesn't default to the lead");
    if(!document.querySelector('button[aria-label="Approval mode"]')?.textContent.includes("Each thread’s own"))throw new Error("Missing approval mode control");
    if(document.body.innerText.includes("New in Float"))throw new Error("Studio Chat's Float bar covers the Command view");
    if(document.querySelectorAll('[data-command-entry="assistant"]').length<3)throw new Error("Missing final thread replies");
    if(!document.querySelector('[data-command-entry="user"]'))throw new Error("Missing owner messages");
   })()`);
   // Recipients come from @-mentions: each of the Space's bots must be offered there.
   const key=async(k,code,vk)=>{for(const type of ["keyDown","keyUp"])await client.command("Input.dispatchKeyEvent",{type,key:k,code,windowsVirtualKeyCode:vk});};
   for(const [query,name] of [["@Atl","Atlas"],["@Scr","Scribe"]]){
    await client.evaluate(`document.querySelector('[data-command-composer] .ProseMirror').focus()`);
    await client.command("Input.insertText",{text:query});
    await client.waitForText("Bots");
    await client.evaluate(`(()=>{const heading=[...document.querySelectorAll("body *")].find(e=>e.children.length===0&&e.textContent.trim()==="Bots");const list=heading?.closest('[role="listbox"],[role="menu"],[data-radix-popper-content-wrapper]')??heading?.parentElement?.parentElement;if(!list?.textContent.includes(${JSON.stringify(name)}))throw new Error("Mentions don't offer ${name}");})()`);
    await key("Escape","Escape",27);
    for(let i=0;i<query.length;i++)await key("Backspace","Backspace",8);
   }
   await client.evaluate(`(()=>{if(document.querySelector('[data-command-composer] .ProseMirror').innerText.trim())throw new Error("Composer draft not cleared after the mention check");if(document.querySelector('[aria-label="Choose recipients"]'))throw new Error("Recipient picker is back");document.activeElement?.blur();})()`);
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
  id:"bots-mobile",packageDir:"bb-studio-teams",fileName:"staged-preview-mobile.png",privateSidebar:false,
  setup:async client=>{
   await client.command("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:1,mobile:true});
   await merged(client);
   await client.waitForText("Logged: release check passed.");
   await client.evaluate(`(()=>{
    if(document.documentElement.scrollWidth>innerWidth)throw new Error("Command view overflows the compact screen");
    const composer=document.querySelector('[data-command-view] form');
    if(!composer||composer.getBoundingClientRect().bottom>innerHeight)throw new Error("Compact composer is offscreen");
    const reply=[...document.querySelectorAll('[data-command-entry="assistant"]')].at(-1);
    const timeline=reply?.closest('[data-command-timeline]');
    const controls=document.querySelector('nav[aria-label="Breadcrumb"]')?.closest("header");
    if(!controls||!timeline||timeline.getBoundingClientRect().top<controls.getBoundingClientRect().bottom-1)throw new Error("Command title bar overlaps the timeline");
    if(!reply||!timeline||reply.getBoundingClientRect().bottom>timeline.getBoundingClientRect().bottom+1)throw new Error("Latest reply is hidden beneath the composer");
   })()`);
   return ()=>client.command("Emulation.setDeviceMetricsOverride",{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  }
 }
 ];
};
