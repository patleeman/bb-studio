// Live sidebar regression: empty threads only; never sends messages or wakes bots.
// BB_SIDEBAR_QA_SESSION=<session> [BB_SIDEBAR_QA_BOT_ID=<idle fixture>] [BB_SIDEBAR_QA_ORIGIN=<bb url>] [BB_SIDEBAR_QA_MODEL=<codex model>] node scripts/qa-bot-teams-sidebar.mjs
// Needs the browser-automation plugin. The sections render through the Studio Sidebar (thread-list-plus).
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const session = process.env.BB_SIDEBAR_QA_SESSION;
const origin = process.env.BB_SIDEBAR_QA_ORIGIN ?? 'http://127.0.0.1:38886';
if (!session) throw new Error('Set BB_SIDEBAR_QA_SESSION.');
const suffix = randomUUID().slice(0, 8);
const createdRooms = [], createdThreads = [], sections = [];
const results = [];
const groups = (process.env.BB_SIDEBAR_QA_GROUPS ?? 'navigation,selection,channels,display,direct,bot-pages,errors,integration,creation,deletion,mobile').split(',');
let bot;
let fixtureValidated = false;
let wasRetired = true;
const existingThreads = new Set();
const rpc = async (method, input) => {
  const request = () => fetch(`${origin}/api/v1/plugins/bot-teams/rpc/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
  });
  const response = await request().catch(error => {
    if (['list', 'get', 'retire', 'deleteRoom'].includes(method)) return request();
    throw error;
  });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(JSON.stringify(data));
  return data.result;
};
const api = async (path, method = 'GET', body) => {
  const request = () => fetch(`${origin}/api/v1/${path}`, {
    method, ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}),
  });
  const response = await request().catch(error => { if (['GET','DELETE'].includes(method)) return request(); throw error; });
  if (method === 'DELETE' && response.status === 404) return null;
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${await response.text()}`);
  return response.status === 204 ? null : response.json();
};
try {
  bot = process.env.BB_SIDEBAR_QA_BOT_ID
    ? await rpc('get', { id: process.env.BB_SIDEBAR_QA_BOT_ID })
    : JSON.parse(execFileSync('bb', ['bots', 'create', `Sidebar QA ${suffix}`, '--mission',
      'Temporary sidebar verification fixture. No work is requested.', '--provider', 'codex',
      '--model', process.env.BB_SIDEBAR_QA_MODEL ?? 'gpt-6.1-sol', '--interval', '0', '--json'], { encoding: 'utf8' }));
  // get returns the profile with documents; use only the bot record.
  bot = bot.bot ?? bot;
  if (!/^Sidebar QA\b/.test(bot.name) || bot.intervalMinutes !== 0)
    throw new Error('Use a dedicated Sidebar QA bot with its mission schedule disabled.');
  fixtureValidated = true;
  wasRetired = process.env.BB_SIDEBAR_QA_BOT_ID ? !!bot.retired : true;
  for (const c of (await rpc('list', null)).directConversations[bot.id] ?? []) existingThreads.add(c.threadId);
  if (bot.retired) bot = await rpc('retire', { id: bot.id, retired: false });
  const alpha = await rpc('createRoom', { name: `Sidebar QA Alpha ${suffix}`, memberIds: [] });
  createdRooms.push(alpha.id);
  const zulu = await rpc('createRoom', { name: `Sidebar QA Zulu ${suffix}`, memberIds: [] });
  createdRooms.push(zulu.id);
  alpha.threadId = (await rpc('openChannelThread', { id: alpha.id })).threadId;
  zulu.threadId = (await rpc('openChannelThread', { id: zulu.id })).threadId;
  const direct = await rpc('newConversation', { id: bot.id });
  createdThreads.push(direct.threadId);
  const section = await api('thread-sections', 'POST', { name: `Sidebar QA Section ${suffix}` });
  sections.push(section.id);
  const fixture = { origin, bot, alpha, zulu, direct, section, suffix };
  for (const group of groups) {
    try {
      const output = JSON.parse(execFileSync('bb', ['browser-automation', 'run', session,
        '--script', `const p=await browser.getPage("main"); await (${exercise.toString()})(p,${JSON.stringify(fixture)},${JSON.stringify(group)});`,
        '--timeout', '60s', '--json'], { encoding: 'utf8' }));
      if (output.exitCode) throw new Error(output.text);
      results.push({ group, passed: true, detail: output.text });
      console.log(`PASS ${group}: ${output.text}`);
    } catch (error) {
      let detail = error.message;
      if (error.stdout) { try { detail = JSON.parse(String(error.stdout)).text; } catch {} }
      results.push({ group, passed: false, detail });
      console.log(`FAIL ${group}: ${detail}`);
    }
  }
} finally {
  if (fixtureValidated) {
    // Include empty threads created by the UI's + and New thread menu tests.
    const roster = await rpc('list', null);
    for (const c of roster.directConversations[bot.id] ?? [])
      if (!existingThreads.has(c.threadId) && !createdThreads.includes(c.threadId)) createdThreads.push(c.threadId);
    await rpc('retire', { id: bot.id, retired: wasRetired });
  }
  for (const id of createdThreads) await api(`threads/${id}`, 'DELETE', { childThreadsConfirmed: false }).catch(console.error);
  for (const id of createdRooms) await rpc('deleteRoom', { id }).catch(console.error);
  for (const id of sections) await api('thread-sections', 'DELETE', { id }).catch(console.error);
}
console.log(JSON.stringify(results, null, 2));
if (results.some((result) => !result.passed)) process.exitCode = 1;

async function exercise(p, f, group) {
  const completed = [];
  const wait = async (label, predicate, ...args) => {
    try { await p.waitForFunction(predicate, ...args); }
    catch(error){throw new Error(`${label}: ${error.message}; ${JSON.stringify(await p.evaluate(()=>({url:location.href,panes:document.querySelectorAll('[data-split-pane-id]').length,menus:[...document.querySelectorAll('[role="menu"]')].map(e=>e.textContent)})))}`);}
  };
  const check = (value, message) => { if (!value) throw new Error(message); completed.push(message); };
  const rpc = (method, input) => p.evaluate(async (method, input) => {
    const response = await fetch(`/api/v1/plugins/bot-teams/rpc/${method}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(JSON.stringify(data));
    return data.result;
  }, method, input);
  const channelRow = (name) => `.channel-sidebar-row:has(button[aria-label="${name} options"])`;
  const directRow = `.direct-thread-nav-row:has(a[data-sidebar-thread-id="${f.direct.threadId}"])`;
  const menuItem = async (text) => {
    await p.waitForFunction((text) => [...document.querySelectorAll('[role^="menuitem"]')].some(e => e.textContent.trim() === text), {}, text);
    await p.evaluate((text) => {
      const item = [...document.querySelectorAll('[role^="menuitem"]')].find(e => e.textContent.trim() === text);
      if (!item) throw new Error(`Missing menu item: ${text}`);
      item.click();
    }, text);
  };
  const frame = () => p.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const fill = async (selector, value) => {
    await p.waitForSelector(selector); await p.focus(selector);
    await p.evaluate(selector => document.querySelector(selector).select(), selector);
    await p.keyboard.press('Backspace');
    if (value) await p.keyboard.type(value);
    await frame();
  };
  const absent = (selector) => p.waitForFunction(selector => !document.querySelector(selector), {}, selector);
  const closeMenus = async () => { await p.keyboard.press('Escape'); await p.keyboard.press('Escape'); await absent('[role="menu"]'); };
  const channelMenu = async (name = f.alpha.name) => {
    await absent('[role="menu"]');
    await p.click(`${channelRow(name)} button[aria-label="${name} options"]`);
  };
  const directMenu = async () => { await absent('[role="menu"]'); await p.click(`${directRow} .direct-thread-menu-trigger`); await p.waitForSelector('[role="menu"]'); };
  const submenu = async (label) => {
    await p.waitForFunction((label) => [...document.querySelectorAll('[role^="menuitem"]')].some(e => e.textContent.trim() === label || e.getAttribute('aria-label') === label), {}, label);
    await p.evaluate((label) => {
      const e = [...document.querySelectorAll('[role^="menuitem"]')].find(e => e.textContent.trim() === label || e.getAttribute('aria-label') === label);
      if (!e) throw new Error(`Missing submenu: ${label}`);
      e.focus();
    }, label);
    await p.keyboard.press('ArrowRight');
  };
  const waitChannel = (name) => p.waitForSelector(channelRow(name),{visible:true});
  const waitDirect = () => p.waitForSelector(directRow,{visible:true});
  // Establish the BB origin before browser-side RPCs, including a fresh about:blank tab.
  await p.goto(`${f.origin}/`); await p.waitForSelector('section[aria-label="Channels"]');
  if (group !== 'mobile') {
    await rpc('updateRoom', { id:f.alpha.id, name:f.alpha.name });
    await rpc('channelState', { id:f.alpha.id, archived:false, pinned:false });
    await rpc('retire', { id:f.bot.id, retired:false });
  }
  for (const key of ['Meta','Control','Shift','Alt']) await p.keyboard.up(key);
  await p.setViewport({ width: 1440, height: 1000, isMobile: false, hasTouch: false });
  await p.goto(`${f.origin}/`);
  await waitChannel(f.alpha.name);
  await p.evaluate(() => {
    window.__sidebarPopups = 0;
    window.open = () => { window.__sidebarPopups++; return null; };
    window.__sidebarClipboard = [];
    Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: async (text) => { window.__sidebarClipboard.push(text); } });
    window.__sidebarConfirms = [];
    window.__sidebarConfirmAnswer = false;
    window.confirm = (text) => { window.__sidebarConfirms.push(text); return window.__sidebarConfirmAnswer; };
  });
  if (group === 'navigation') {
    await p.click(`${channelRow(f.alpha.name)} a`);
    await p.waitForFunction((id) => location.pathname.endsWith(id), {}, f.alpha.threadId);
    check(await p.evaluate((name) => document.querySelector('.channel-sidebar-row[data-selected] .channel-nav-name')?.textContent === name, f.alpha.name), 'Channel selected state follows route');
    await waitDirect(); await p.click(`${directRow} a`);
    await p.waitForFunction((id) => location.pathname.endsWith(id), {}, f.direct.threadId);
    await wait('DM selection',(selector) => document.querySelector(`${selector} a`)?.getAttribute('aria-current') === 'page', {}, directRow);
    check(await p.evaluate((selector) => document.querySelector(`${selector} a`)?.getAttribute('aria-current') === 'page', directRow), 'DM selected state follows route');
    await absent('.channel-sidebar-row[data-selected]');
    check(true, 'Opening a DM clears the previous channel highlight');
    await directMenu(); await menuItem('Copy thread link');
    const copied = await p.evaluate(() => window.__sidebarClipboard.at(-1));
    check(copied === `${f.origin}/threads/${f.direct.threadId}`, 'Copied personal DM link uses its valid route');
    check(await p.evaluate(() => window.__sidebarPopups === 0), 'Navigation never opens a browser popup');
    await p.goto(copied); await p.waitForFunction((id) => location.pathname.endsWith(id), {}, f.direct.threadId); await waitChannel(f.alpha.name); await waitDirect();
    await p.evaluate(() => {window.__sidebarPopups=0;window.open=()=>{window.__sidebarPopups++;return null;};});
    await p.waitForSelector('[data-split-pane-id]');
    const beforePanes = await p.evaluate(()=>document.querySelectorAll('[data-split-pane-id]').length);
    await p.keyboard.down('Meta'); try { await p.click(`${channelRow(f.alpha.name)} a`); } finally { await p.keyboard.up('Meta'); }
    // The split first shows the channel route, which ends in the same id; wait for its thread.
    await wait('Command-click opens channel',(id)=>location.pathname.endsWith(`/threads/${id}`),{},f.alpha.threadId);
    check(await p.evaluate(()=>window.__sidebarPopups===0), 'Command-click channel stays in BB');
    await p.keyboard.down('Control'); try { await p.click(`${directRow} a`); } finally { await p.keyboard.up('Control'); }
    await p.waitForSelector('[role="menu"]');
    check(await p.evaluate(()=>window.__sidebarPopups===0), 'Mac Control-click opens the context menu without a popup');
    await closeMenus();
    // Exercise the Windows/Linux control-click event without macOS translating it to a context menu.
    await p.evaluate((selector)=>document.querySelector(`${selector} a`).dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,ctrlKey:true,view:window})),directRow);
    await wait('Control-click event opens DM',(id)=>location.pathname.endsWith(id),{},f.direct.threadId);
    check(await p.evaluate(()=>window.__sidebarPopups===0), 'Control-click event stays in BB');
    await frame();
    const existingPanes = await p.evaluate(()=>document.querySelectorAll('[data-split-pane-id]').length);
    await directMenu(); await menuItem('Open in split'); await frame();
    check(await p.evaluate(()=>document.querySelectorAll('[data-split-pane-id]').length) === existingPanes, 'Reopening an existing split adds no duplicate pane');
  }
  if (group === 'selection') {
    const threadApi = (method, suffix = '', body) => p.evaluate(async (id, method, suffix, body) => {
      const response = await fetch(`/api/v1/threads/${id}${suffix}`, {
        method, headers: {'content-type':'application/json'}, ...(body ? {body:JSON.stringify(body)} : {}),
      });
      if (!response.ok) throw new Error(await response.text());
    }, f.direct.threadId, method, suffix, body);
    // Expose only the empty fixture thread in the native pinned list.
    await threadApi('PATCH', '', {visibility:'visible'});
    await threadApi('POST', '/pin');
    try {
      await p.goto(`${f.origin}/`); await waitChannel(f.alpha.name);
      await p.click(`${channelRow(f.alpha.name)} a`);
      await wait('Channel highlight', id=>document.querySelector(`.channel-sidebar-row[data-selected] a`)?.getAttribute('href')===`/threads/${id}`,{},f.alpha.threadId);
      const pinnedRow = `[data-sidebar-thread-id="${f.direct.threadId}"]:not(.direct-thread-nav-row):not(.direct-thread-nav-link)`;
      await p.waitForSelector(pinnedRow); await p.click(pinnedRow);
      await wait('Pinned thread route', id=>location.pathname.endsWith(id),{},f.direct.threadId);
      await absent('.channel-sidebar-row[data-selected]');
      check(true,'Opening a native pinned thread clears the previous channel highlight');
      await p.click(`${channelRow(f.zulu.name)} a`);
      await wait('Next channel highlight', id=>document.querySelector(`.channel-sidebar-row[data-selected] a`)?.getAttribute('href')===`/threads/${id}`,{},f.zulu.threadId);
      await p.click(`${directRow} a`);
      await wait('DM route', id=>location.pathname.endsWith(id),{},f.direct.threadId);
      await absent('.channel-sidebar-row[data-selected]');
      check(true,'Opening a DM clears the previous channel highlight');
    } finally {
      await threadApi('POST', '/unpin');
      await threadApi('PATCH', '', {visibility:'hidden'});
    }
  }
  if (group === 'channels') {
    await channelMenu(); await menuItem('Copy channel ID');
    check(await p.evaluate((id) => window.__sidebarClipboard.at(-1) === id, f.alpha.id), 'Copy channel ID');
    await channelMenu(); await menuItem('Copy channel link');
    check(await p.evaluate((id) => window.__sidebarClipboard.at(-1).endsWith(`/plugins/bot-teams/channels/${id}`), f.alpha.id), 'Copy channel link');
    await channelMenu(); await menuItem('Pin');
    await p.waitForFunction((selector) => !!document.querySelector(`${selector} .channel-nav-row svg`), {}, channelRow(f.alpha.name));
    check((await rpc('list', null)).rooms.find(r => r.id === f.alpha.id).pinned === true, 'Pin channel persists');
    await channelMenu(); await menuItem('Unpin');
    check((await rpc('list', null)).rooms.find(r => r.id === f.alpha.id).pinned === false, 'Unpin channel persists');
    await channelMenu();
    const readLabel = await p.evaluate(() => [...document.querySelectorAll('[role^="menuitem"]')].find(e => /^Mark /.test(e.textContent.trim()))?.textContent.trim());
    if (readLabel === 'Mark read') { await menuItem('Mark read'); await channelMenu(); }
    await menuItem('Mark unread'); await channelMenu();
    await p.waitForFunction(() => [...document.querySelectorAll('[role^="menuitem"]')].some(e => e.textContent.trim() === 'Mark read'));
    check(await p.evaluate(() => [...document.querySelectorAll('[role^="menuitem"]')].some(e => e.textContent.trim() === 'Mark read')), 'Mark channel unread updates menu');
    await menuItem('Mark read');
    await channelMenu(); await menuItem('Rename');
    await p.waitForSelector('input[aria-label="Channel name"]'); await fill('input[aria-label="Channel name"]', `${f.alpha.name} renamed`); await p.keyboard.press('Enter');
    await waitChannel(`${f.alpha.name} renamed`);
    check((await rpc('list', null)).rooms.find(r => r.id === f.alpha.id).name.endsWith('renamed'), 'Rename channel persists');
    await channelMenu(`${f.alpha.name} renamed`); await menuItem('Rename');
    await p.waitForSelector('input[aria-label="Channel name"]'); await fill('input[aria-label="Channel name"]', '   '); await p.keyboard.press('Enter'); await frame();
    check(await p.evaluate(() => document.querySelector('input[aria-label="Channel name"]')?.getAttribute('aria-invalid') === 'true'), 'Empty channel rename is rejected');
    await p.keyboard.press('Escape'); await channelMenu(`${f.alpha.name} renamed`); await menuItem('Rename');
    await p.waitForSelector('input[aria-label="Channel name"]'); await fill('input[aria-label="Channel name"]', f.alpha.name); await p.keyboard.press('Enter'); await waitChannel(f.alpha.name);
    await channelMenu(); await menuItem('Rename');
    await fill('input[aria-label="Channel name"]', 'Cancelled rename'); await p.keyboard.press('Escape'); await waitChannel(f.alpha.name);
    check(true, 'Escape cancels channel rename');
    await channelMenu(); await menuItem('Archive');
    await absent(channelRow(f.alpha.name));
    await p.click('button[aria-label="Channel list options"]'); await menuItem('Show archived channels'); await waitChannel(f.alpha.name);
    await p.click('button[aria-label="Search channels"]'); await fill('input[aria-label="Search channels"]', f.zulu.name); await waitChannel(f.zulu.name);
    check(true, 'Archived view search also finds active channels');
    await fill('input[aria-label="Search channels"]', f.alpha.name); await waitChannel(f.alpha.name);
    await p.click('button[aria-label="Search channels"]');
    await channelMenu(); await menuItem('Restore'); await absent(channelRow(f.alpha.name));
    await p.click('button[aria-label="Channel list options"]'); await menuItem('Show active channels'); await waitChannel(f.alpha.name);
    check(true, 'Archive and restore channel through the list');
    await channelMenu(); await menuItem('Delete'); await p.waitForSelector('[role="dialog"]');
    await p.evaluate(() => [...document.querySelectorAll('[role="dialog"] button')].find(e => e.textContent.trim() === 'Cancel').click());
    await waitChannel(f.alpha.name); check(true, 'Cancel channel deletion keeps the channel');
  }
  if (group === 'display') {
    await p.click('button[aria-label="Collapse Channels section"]');
    check(await p.evaluate(() => getComputedStyle(document.querySelector('section[aria-label="Channels"] > div[id]')).display === 'none'), 'Collapse channels');
    await p.click('button[aria-label="Search channels"]'); await fill('input[aria-label="Search channels"]', `  SIDEBAR QA ALPHA ${f.suffix}  `);
    await waitChannel(f.alpha.name);
    check(await p.evaluate((selector) => !document.querySelector(selector), channelRow(f.zulu.name)), 'Search trims whitespace and ignores case');
    await fill('input[aria-label="Search channels"]', 'no-sidebar-qa-match');
    check(await p.evaluate(() => document.querySelector('section[aria-label="Channels"]').textContent.includes('No matching channels')), 'Empty channel search');
    await fill('input[aria-label="Search channels"]', `Sidebar QA`);
    await p.click('button[aria-label="Channel list options"]'); await submenu('Organize by'); await menuItem('No grouping'); await closeMenus();
    await p.click('button[aria-label="Channel list options"]'); await submenu('Sort by'); await menuItem('Alphabetical'); await closeMenus();
    check(await p.evaluate(() => JSON.parse(localStorage.getItem('bb:bots:channel-sidebar-display')).sort === 'alpha'), 'Alphabetical sort persists');
    const names = await p.evaluate(() => [...document.querySelectorAll('.channel-sidebar-row .channel-nav-name')].map(e=>e.textContent));
    check(names.indexOf(f.alpha.name) < names.indexOf(f.zulu.name), 'Alphabetical row order');
    await p.click('button[aria-label="Channel list options"]'); await submenu('Sort by'); await menuItem('Alphabetical'); await closeMenus();
    const reversed = await p.evaluate(() => [...document.querySelectorAll('.channel-sidebar-row .channel-nav-name')].map(e=>e.textContent));
    check(reversed.indexOf(f.zulu.name) < reversed.indexOf(f.alpha.name), 'Repeated sort reverses direction');
    for (const [label, first] of [['Updated at',f.alpha.name],['Created at',f.zulu.name]]) {
      await p.click('button[aria-label="Channel list options"]'); await submenu('Sort by'); await menuItem(label); await closeMenus();
      const order=await p.evaluate(()=>[...document.querySelectorAll('.channel-sidebar-row .channel-nav-name')].map(e=>e.textContent));
      const second=first===f.alpha.name?f.zulu.name:f.alpha.name;
      check(order.indexOf(first)<order.indexOf(second), `${label} sort order`);
    }
    await rpc('channelState',{id:f.alpha.id,pinned:true});
    await p.click('button[aria-label="Channel list options"]'); await submenu('Organize by'); await menuItem('Pinned first'); await closeMenus();
    await p.waitForFunction((alpha,zulu)=>{const order=[...document.querySelectorAll('.channel-sidebar-row .channel-nav-name')].map(e=>e.textContent);return order.indexOf(alpha)<order.indexOf(zulu);},{},f.alpha.name,f.zulu.name);
    check(true,'Pinned-first grouping puts pinned channels first');
    await rpc('channelState',{id:f.alpha.id,pinned:false});
    await p.click('button[aria-label="Channel list options"]'); await submenu('Organize by'); await menuItem('By activity'); await closeMenus();
    check(await p.evaluate(() => !!document.querySelector('section[aria-label="Channels"] .channels-sidebar-group > p')), 'Activity grouping');
    await p.click('button[aria-label="Search channels"]');
    await p.click('button[aria-label="Collapse Direct messages section"]');
    await p.click('button[aria-label="Search direct messages"]'); await fill('input[aria-label="Search direct messages"]', f.bot.name.toUpperCase()); await waitDirect();
    await fill('input[aria-label="Search direct messages"]', `@${f.bot.handle}`); await waitDirect(); check(true,'DM search matches bot handles');
    await fill('input[aria-label="Search direct messages"]', 'no-sidebar-qa-match');
    check(await p.evaluate(() => document.querySelector('section[aria-label="Direct messages"]').textContent.includes('No matching direct messages')), 'Empty DM search');
    await p.click('button[aria-label="Search direct messages"]'); await waitDirect(); check(true, 'Closing DM search clears its filter');
  }
  if (group === 'direct') {
    await waitDirect(); await directMenu(); await menuItem('Rename');
    await p.waitForSelector('input[aria-label="Thread name"]'); await fill('input[aria-label="Thread name"]', `Sidebar QA thread ${f.suffix}`); await p.keyboard.press('Enter');
    await p.waitForFunction((selector) => document.querySelector(`${selector} .channel-nav-name`)?.textContent.startsWith('Sidebar QA thread'), {}, directRow);
    check(true, 'Rename DM');
    await directMenu(); await menuItem('Rename'); await fill('input[aria-label="Thread name"]', '  '); await p.keyboard.press('Enter'); await frame();
    check(await p.evaluate(()=>document.querySelector('input[aria-label="Thread name"]')?.getAttribute('aria-invalid')==='true'), 'Empty DM rename is rejected');
    await p.keyboard.press('Escape');
    await directMenu(); await menuItem('Pin'); await directMenu(); await menuItem('Unpin'); check(true, 'Pin and unpin DM');
    await directMenu(); const label = await p.evaluate(() => [...document.querySelectorAll('[role^="menuitem"]')].find(e => /^Mark /.test(e.textContent.trim()))?.textContent.trim());
    if (label === 'Mark read') { await menuItem('Mark read'); await directMenu(); }
    await menuItem('Mark unread'); await directMenu(); await menuItem('Mark read'); check(true, 'Mark DM unread and read');
    const sectionOf = async (want) => {
      for (let tries = 0; tries < 40; tries++) {
        const sectionId = (await rpc('list', null)).directThreadInfo[f.direct.threadId].sectionId;
        if (sectionId === want) return sectionId;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      return (await rpc('list', null)).directThreadInfo[f.direct.threadId].sectionId;
    };
    await directMenu(); await submenu('Move to section'); await menuItem(f.section.name);
    check(await sectionOf(f.section.id) === f.section.id, 'Move DM to section');
    await directMenu(); await submenu('Move to section'); await menuItem('Threads');
    check(await sectionOf(null) === null, 'Move DM back to Threads');
    await p.click(`${directRow} .direct-thread-archive`); await absent(directRow);
    await p.click('button[aria-label="Direct message list options"]'); await menuItem('Show archived threads'); await waitDirect();
    await directMenu(); await menuItem('Unarchive'); await waitDirect();
    await p.waitForFunction(selector=>{const row=document.querySelector(selector);return row&&!row.querySelector('.channel-nav-archived');},{},directRow); check(true, 'Archive and unarchive DM');
    await directMenu(); await menuItem('Delete');
    await p.waitForFunction(()=>window.__sidebarConfirms.at(-1)?.startsWith('Delete'));
    check(await p.evaluate(() => window.__sidebarConfirms.at(-1)?.startsWith('Delete')), 'DM delete asks for confirmation');
    await waitDirect(); check(true, 'Cancel DM delete keeps thread');
  }
  if (group === 'bot-pages') {
    let stage = 'opening profile';
    try {
    for (const [label, tab] of [['View profile','profile'],['View mission','mission'],['View memory','memory'],['View activity','activity']]) {
      stage = `row for ${label}`; await waitDirect(); stage = `menu for ${label}`; await directMenu(); stage = `submenu for ${label}`; await submenu(f.bot.name); stage = label; await menuItem(label);
      await wait(label, (tab) => location.pathname.endsWith(`/${tab}`), {}, tab);
      check(await p.evaluate(() => window.__sidebarPopups === 0), `${label} navigates inside BB`);
    }
    stage = 'archive bot';
    await rpc('retire', { id: f.bot.id, retired: true }); await wait('Retired bot hides its threads', selector => !document.querySelector(selector), {}, directRow);
    stage = 'show archived bots';
    await p.click('button[aria-label="Direct message list options"]'); await menuItem('Show archived bots'); await waitDirect();
    check(true, 'Show archived bots reveals their direct threads');
    await closeMenus();
    stage = 'hide archived bots'; await p.click('button[aria-label="Direct message list options"]'); await menuItem('Hide archived bots');
    await absent(directRow);check(true,'Hide archived bots removes their direct threads');
    await rpc('retire', { id: f.bot.id, retired: false });
    } catch(error) { throw new Error(`${stage}: ${error.message}; ${JSON.stringify(await p.evaluate(()=>({url:location.href,menus:[...document.querySelectorAll('[role="menu"]')].map(e=>e.textContent),sidebar:document.querySelector('section[aria-label="Direct messages"]')?.textContent})))}`); }
  }
  if (group === 'errors') {
    await p.evaluate(()=>Object.defineProperty(navigator.clipboard,'writeText',{configurable:true,value:async()=>{throw new Error('Clipboard blocked for QA');}}));
    await directMenu(); await menuItem('Copy thread link');
    await p.waitForFunction(()=>[...document.querySelectorAll('[role="alert"]')].some(e=>e.textContent.includes('Clipboard blocked for QA')));
    check(true, 'DM clipboard failure is shown in the sidebar');
    await channelMenu(); await menuItem('Copy channel link');
    await p.waitForFunction(()=>document.querySelector('section[aria-label="Channels"]').textContent.includes('Could not copy channel link'));
    check(true, 'Channel clipboard failure is shown in the sidebar');
    await channelMenu(); await menuItem('Rename'); await fill('input[aria-label="Channel name"]', f.zulu.name); await p.keyboard.press('Enter');
    try { await p.waitForSelector('.sidebar-inline-rename-error'); }
    catch(error){throw new Error(`Rejected rename: ${error.message}; ${JSON.stringify(await p.evaluate(()=>({input:document.querySelector('input[aria-label="Channel name"]')?.value,focused:document.activeElement?.getAttribute('aria-label'),alerts:[...document.querySelectorAll('[role="alert"]')].map(e=>e.textContent)})))}`);}
    check((await rpc('list',null)).rooms.find(r=>r.id===f.alpha.id).name===f.alpha.name, 'Failed rename preserves the channel name');
    await p.keyboard.press('Escape');
    // Shared renderer supplies identical items in both DM menu surfaces.
    await p.click(`${directRow} a`,{button:'right'}); await p.waitForSelector('[role="menu"]');
    const labels=await p.evaluate(()=>[...document.querySelectorAll('[role^="menuitem"]')].map(e=>e.textContent.trim()));
    check(['Open in split','Copy thread link','Rename','Archive','Delete'].every(label=>labels.includes(label)), 'DM right-click menu has the same thread actions');
    await closeMenus();
    await p.focus(`${channelRow(f.alpha.name)} a`); await p.keyboard.down('Shift'); await p.keyboard.press('F10'); await p.keyboard.up('Shift');
    await p.waitForSelector('[role="menu"]'); check(true, 'Channel options are keyboard accessible'); await closeMenus();
    const beforeRooms=(await rpc('list',null)).rooms.length;
    for(const path of ['thread/not-a-thread','invalid-channel-link']){
      await p.goto(`${f.origin}/plugins/bot-teams/channels/${path}`);
      await p.waitForFunction(()=>document.body.textContent.includes('Invalid channel link.'));
      check((await rpc('list',null)).rooms.length===beforeRooms, `Invalid route ${path} creates no channel`);
    }
  }
  if (group === 'integration') {
    await waitDirect(); await directMenu();
    await p.waitForSelector('[data-bot-teams-channel-handoff]');
    check(true,'DM options button exposes Start channel from thread');
    const hasCopySession=await p.evaluate(()=>!!document.querySelector('[data-copy-session-id-item]'));
    if(hasCopySession){await menuItem('Copy session ID');await p.waitForFunction(id=>window.__sidebarClipboard.at(-1)===id,{},f.direct.threadId);check(true,'Copy session ID identifies the selected DM');}
    else await closeMenus();
    const before=(await rpc('list',null)).rooms.map(r=>r.id);
    await directMenu(); await menuItem('Start channel from thread');
    await p.waitForFunction(()=>location.pathname.startsWith('/threads/'),{timeout:20000});
    const threadId=await p.evaluate(()=>location.pathname.split('/').at(-1));
    const roomId=await rpc('channelForThread',{threadId});
    check(!!roomId&&!before.includes(roomId),'Thread handoff creates its own new channel');
    const room=(await rpc('list',null)).rooms.find(r=>r.id===roomId);
    try {
      await p.waitForFunction(()=>location.pathname.startsWith('/threads/'),{timeout:20000});
      await p.waitForFunction(()=>[...document.querySelectorAll('[contenteditable="true"]')].some(e=>e.textContent.includes('Continue from')),{timeout:20000});
      check((await rpc('room',{id:room.id,limit:10})).messages.length===0,'Thread handoff pre-fills a draft without sending it');
    } finally { await rpc('deleteRoom',{id:room.id}); }
  }
  if (group === 'creation') {
    const before = (await rpc('list', null)).rooms.map(r=>r.id);
    await p.click('section[aria-label="Channels"] button[aria-label="New channel"]');
    await p.waitForFunction(()=>location.pathname.startsWith('/threads/'),{timeout:20000});
    const createdThread=await p.evaluate(()=>location.pathname.split('/').at(-1));
    const createdRoom=await rpc('channelForThread',{threadId:createdThread});
    check(!!createdRoom&&!before.includes(createdRoom), 'New channel creates its own channel');
    await rpc('deleteRoom', { id:createdRoom });
    const previous = (await rpc('list', null)).directConversations[f.bot.id].map(c=>c.threadId);
    await p.click('button[aria-label="New direct message"]'); await menuItem(f.bot.name);
    await p.waitForFunction(async (botId,count)=>{const r=await fetch('/api/v1/plugins/bot-teams/rpc/list',{method:'POST',headers:{'content-type':'application/json'},body:'null'});return (await r.json()).result.directConversations[botId].length===count;},{timeout:20000},f.bot.id,previous.length+1);
    const next = (await rpc('list', null)).directConversations[f.bot.id].filter(c=>!previous.includes(c.threadId));
    check(next.length === 1, 'New direct message creates exactly one empty thread');
    await p.waitForFunction(id=>location.pathname.endsWith(id),{timeout:20000},next[0].threadId);
    const nextRow = `.direct-thread-nav-row:has(a[data-sidebar-thread-id="${next[0].threadId}"])`;
    await p.click(`${nextRow} .direct-thread-menu-trigger`); await menuItem(`New thread with ${f.bot.name}`);
    await p.waitForFunction(async (botId,count)=>{const r=await fetch('/api/v1/plugins/bot-teams/rpc/list',{method:'POST',headers:{'content-type':'application/json'},body:'null'});return (await r.json()).result.directConversations[botId].length===count;},{timeout:20000},f.bot.id,previous.length+2);
    const after = (await rpc('list', null)).directConversations[f.bot.id];
    check(after.length === previous.length + 2, 'Row new-thread action preserves earlier conversations');
    await directMenu(); const readLabel=await p.evaluate(()=>[...document.querySelectorAll('[role^="menuitem"]')].find(e=>/^Mark /.test(e.textContent.trim()))?.textContent.trim());
    if(readLabel==='Mark read'){await menuItem('Mark read');await directMenu();}
    await menuItem('Mark unread');
    await p.waitForSelector(`${directRow} [aria-label="Unread direct message"]`); check(true,'Older direct threads show unread status');
  }
  if (group === 'deletion') {
    await channelMenu(f.zulu.name); await menuItem('Delete'); await p.waitForSelector('[role="dialog"]');
    await p.evaluate(() => [...document.querySelectorAll('[role="dialog"] button')].find(e=>e.textContent.trim()==='Delete channel').click());
    await absent(channelRow(f.zulu.name));
    check(!(await rpc('list', null)).rooms.some(r=>r.id===f.zulu.id), 'Confirmed channel deletion removes only fixture');
    await waitDirect(); await p.evaluate(()=>{window.__sidebarConfirmAnswer=true;}); await directMenu(); await menuItem('Delete');
    await absent(directRow); check(true, 'Confirmed DM deletion removes only fixture');
  }
  if (group === 'mobile') {
    await p.setViewport({ width:390, height:844, isMobile:true, hasTouch:true });
    await p.goto(`${f.origin}/threads/${f.alpha.threadId}`); await p.waitForSelector('button[aria-label^="Toggle sidebar"]');
    await p.evaluate(()=>document.querySelector('button[aria-label^="Toggle sidebar"][aria-expanded="false"]')?.click());
    await waitChannel(f.alpha.name); await p.click(`${channelRow(f.alpha.name)} a`);
    await p.waitForFunction(()=>document.querySelector('button[aria-label^="Toggle sidebar"]')?.getAttribute('aria-expanded')==='false');
    check(await p.evaluate(()=>document.querySelector('button[aria-label^="Toggle sidebar"]')?.getAttribute('aria-expanded')==='false'), 'Mobile row navigation closes drawer');
  }
  return completed;
}
