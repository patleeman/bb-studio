import { launchRoomReplies } from "../bb.mjs";

export default ({pluginRpc, launchRoomThread, getLaunchRoomId}) => [
 {
  id:"bots",packageDir:"bb-studio-teams",fileName:"staged-preview.png",
  setup:async client=>{
   await launchRoomThread(); const id=getLaunchRoomId();
   await client.navigate(`/plugins/bot-teams/views/${id}`);
   await client.waitForSelector('[data-thread-view]');
   for(const text of launchRoomReplies)await client.waitForText(text);
   await client.waitForText("New bot threads");
   await client.evaluate(`(()=>{
    if(!document.querySelector('textarea[aria-label="Message to view"], textarea#view-message'))throw new Error("Missing view composer");
    if(document.querySelectorAll('[data-view-entry="assistant"]').length<3)throw new Error("Missing final thread replies");
    const names=document.querySelector('[role="group"][aria-label="Recipients"]')?.textContent;
    if(!names?.includes("Atlas")||!names.includes("Scribe"))throw new Error("Missing recipient controls");
   })()`);
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
   await launchRoomThread();await client.navigate(`/plugins/bot-teams/views/${getLaunchRoomId()}`);
   await client.waitForSelector('section[aria-label="Views"]');await client.waitForText("Design review");
  }
 }
];
