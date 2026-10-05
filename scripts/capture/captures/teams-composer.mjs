// Work as bot in BB's composer, where BB puts plugin composer actions.
export default ({ pluginRpc, projectId, threadId }) => {
 const atlas = async () => {
  const bot = (await pluginRpc("bot-teams", "profiles", {})).find(b => b.handle === "atlas");
  if (!bot) throw new Error("Missing staged Atlas");
  return bot;
 };
 const wait = (client, expression, message) => client.evaluate(`new Promise((resolve,reject)=>{const end=Date.now()+20000;const tick=()=>{try{if(${expression})return resolve();}catch{}Date.now()>end?reject(new Error(${JSON.stringify(message)})):setTimeout(tick,200);};tick();})`, true);
 const inRow = label => `!!document.querySelector('[data-promptbox] button[aria-label=${JSON.stringify(label)}]')`;
 // The composer and the row under it, with room for an open menu above.
 const clip = client => client.evaluate(`(()=>{const box=document.querySelector('[data-promptbox]').getBoundingClientRect();const top=Math.max(0,box.top-120);return {x:Math.max(0,box.left-24),y:top,width:Math.min(innerWidth,box.width+48),height:Math.min(innerHeight-top,box.bottom-top+72)};})()`);
 // Reload: the page caches the thread's bot, and the RPCs here change it behind its back.
 const openThread = async client => {
  await client.navigate(`/projects/${projectId}/threads/${threadId}`);
  await client.command("Page.reload", {});
  await client.waitForSelector('[data-promptbox] [contenteditable=true]', 60000);
 };
 return [
  {
   id: "bots-composer-thread", packageDir: "bb-studio-teams", fileName: "composer-thread-bot.png", clip,
   setup: async client => {
    const bot = await atlas();
    await pluginRpc("bot-teams", "setThreadProfile", { threadId, botId: null });
    await openThread(client);
    await wait(client, inRow("Work as a bot"), "A thread without a bot doesn't show Work as bot in its composer");
    await pluginRpc("bot-teams", "setThreadProfile", { threadId, botId: bot.id });
    await openThread(client);
    await wait(client, inRow(`Working as ${bot.name}`), "A thread working as a bot doesn't show it in its composer");
    return () => pluginRpc("bot-teams", "setThreadProfile", { threadId, botId: null });
   },
  },
  {
   id: "bots-composer-new", packageDir: "bb-studio-teams", fileName: "composer-new-thread-bot.png", clip,
   setup: async client => {
    const bot = await atlas();
    await client.evaluate(`sessionStorage.removeItem(${JSON.stringify(`bb:bots:new-thread-profile:${projectId}`)})`).catch(() => {});
    await client.navigate(`/projects/${projectId}`);
    await client.waitForSelector('[data-promptbox] [contenteditable=true]');
    await wait(client, inRow("Work as a bot"), "A new thread doesn't show Work as bot in its composer");
    await client.clickAriaButtonWithPointer("Work as a bot");
    await client.waitForText(bot.description || `@${bot.handle}`);
    await client.clickElementWithTextAndPointer('[role="menuitem"] > span.flex > span:first-child', bot.name);
    await wait(client, inRow(`Working as ${bot.name}`), "Picking a bot in a new thread didn't keep it in its composer");
    await client.evaluate("document.activeElement?.blur()");
    return async () => {
     await pluginRpc("bot-teams", "pendingThreadProfile", { projectId, botId: null });
     await client.evaluate(`sessionStorage.removeItem(${JSON.stringify(`bb:bots:new-thread-profile:${projectId}`)})`);
    };
   },
  },
 ];
};
