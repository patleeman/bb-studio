import { launchRoomReplies } from "../bb.mjs";
import teamsCompanions from "./teams-companions.mjs";

export default context => {
 const {pluginRpc, launchRoomThread, getLaunchRoomId} = context;
 return [
 ...(process.env.BB_CAPTURE_TEAMS_COMPANIONS === "1" ? [teamsCompanions(context)] : []),
 {
  id:"bots",packageDir:"bb-studio-teams",fileName:"staged-preview.png",
  setup:async client=>{
   await launchRoomThread(); const id=getLaunchRoomId();
   await client.navigate(`/plugins/bot-teams/views/${id}`);
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
   await client.clickAriaButtonWithPointer("Choose recipients");
   await client.waitForText("New bot threads");
   await client.evaluate(`(()=>{
    const names=document.querySelector('[role="group"][aria-label="Recipients"]')?.textContent;
    if(!names?.includes("Atlas")||!names.includes("Scribe"))throw new Error("Missing recipient controls");
   })()`);
   await client.command("Input.dispatchKeyEvent",{type:"keyDown",key:"Escape",code:"Escape",windowsVirtualKeyCode:27});
   await client.command("Input.dispatchKeyEvent",{type:"keyUp",key:"Escape",code:"Escape",windowsVirtualKeyCode:27});
   await client.evaluate(`new Promise((resolve,reject)=>setTimeout(()=>document.querySelector('[role="group"][aria-label="Recipients"]')?reject(new Error("Recipient menu stayed open")):resolve(document.activeElement?.blur()),400))`,true);
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
   await client.waitForSelector(`[data-studio-item="/plugins/bot-teams/views/${getLaunchRoomId()}"]`);
   await client.evaluate(`document.querySelector('[data-studio-item="/plugins/bot-teams/views/${getLaunchRoomId()}"]').click()`);
   await client.waitForSelector('[data-thread-view]');
   await client.waitForSelector('section[aria-label="Studio"]');
   await client.waitForSelector(`section[aria-label="Studio"] a[href="/plugins/bot-teams/views/${getLaunchRoomId()}"]`);
   await client.evaluate(`(()=>{if(document.querySelector('section[aria-label="Views"]'))throw new Error("Saved views still have a separate sidebar section");})()`);
  }
 },
 {
  id:"bots-mobile",packageDir:"bb-studio-teams",fileName:"staged-preview-mobile.png",privateSidebar:false,
  setup:async client=>{
   await client.command("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:1,mobile:true});
   await launchRoomThread();await client.navigate(`/plugins/bot-teams/views/${getLaunchRoomId()}`);
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
