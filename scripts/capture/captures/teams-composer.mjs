// Work as bot in BB's composer: in its action row in a new thread and in a
// thread working as a bot, in the ⋯ menu under it in a thread without one.
export default ({ pluginRpc, projectId, threadId }) => {
 const atlas = async () => {
  const bot = (await pluginRpc("bot-teams", "profiles", {})).find(b => b.handle === "atlas");
  if (!bot) throw new Error("Missing staged Atlas");
  return bot;
 };
 const wait = (client, expression, message) => client.evaluate(`new Promise((resolve,reject)=>{const end=Date.now()+20000;const tick=()=>{try{if(${expression})return resolve();}catch{}Date.now()>end?reject(new Error(${JSON.stringify(message)})):setTimeout(tick,200);};tick();})`, true);
 // The picker is in the composer's own action row, level with the model picker.
 const inline = label => `(()=>{const button=document.querySelector('[data-promptbox] button[aria-label=${JSON.stringify(label)}]');const model=document.querySelector('[data-promptbox] [aria-label^="Provider, model and reasoning"]');if(!button||!model||button.closest('[data-studio-composer-more-panel]'))return false;const a=button.getBoundingClientRect(),b=model.getBoundingClientRect();return Math.abs((a.top+a.bottom)/2-(b.top+b.bottom)/2)<4&&a.left>b.right;})()`;
 const inMenu = label => `!!document.querySelector('[data-studio-composer-more-panel] button[aria-label=${JSON.stringify(label)}]')&&!document.querySelector('[data-promptbox] button[aria-label=${JSON.stringify(label)}]')`;
 // The composer and the row under it, with room for an open menu above.
 const clip = client => client.evaluate(`(()=>{const box=document.querySelector('[data-promptbox]').getBoundingClientRect();const top=Math.max(0,box.top-120);return {x:Math.max(0,box.left-24),y:top,width:Math.min(innerWidth,box.width+48),height:Math.min(innerHeight-top,box.bottom-top+72)};})()`);
 const openThread = async client => {
  await client.navigate(`/projects/${projectId}/threads/${threadId}`);
  await client.waitForSelector('[data-promptbox] [contenteditable=true]');
 };
 return [
  {
   id: "bots-composer-thread", packageDir: "bb-studio-teams", fileName: "composer-thread-bot.png", clip,
   setup: async client => {
    const bot = await atlas();
    await pluginRpc("bot-teams", "setThreadProfile", { threadId, botId: null });
    await openThread(client);
    await wait(client, inMenu("Work as a bot"), "A thread without a bot doesn't keep Work as bot in the ⋯ menu");
    await pluginRpc("bot-teams", "setThreadProfile", { threadId, botId: bot.id });
    await openThread(client);
    await wait(client, inline(`Working as ${bot.name}`), "A thread working as a bot doesn't show it in the composer's action row");
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
    await wait(client, inline("Work as a bot"), "A new thread doesn't show Work as bot in the composer's action row");
    await client.clickAriaButtonWithPointer("Work as a bot");
    await client.waitForText(bot.description || `@${bot.handle}`);
    await client.clickElementWithTextAndPointer('[role="menuitem"] > span.flex > span:first-child', bot.name);
    await wait(client, inline(`Working as ${bot.name}`), "Picking a bot in a new thread didn't keep it in the composer's action row");
    await client.evaluate("document.activeElement?.blur()");
    return async () => {
     await pluginRpc("bot-teams", "pendingThreadProfile", { projectId, botId: null });
     await client.evaluate(`sessionStorage.removeItem(${JSON.stringify(`bb:bots:new-thread-profile:${projectId}`)})`);
    };
   },
  },
 ];
};
