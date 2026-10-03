import { seedOffice } from '../seed-office.mjs';

export default ({ seedPages }) => {
  const capture = (id, fileName, route, texts, after) => ({
    id, fileName, packageDir:'bb-studio', showSidebar:true,
    setup: async client => {
      const fixture = await seedOffice();
      await client.navigate(typeof route === 'function' ? route(fixture) : route);
      for (const text of texts) await client.waitForText(text);
      if (after) await after(client, fixture);
      // Every Office capture includes the real team and project sidebar.
      await client.waitForSelector('[aria-label="Team"] button[title^="Atlas"]'); await client.waitForText('Orbit');
    },
  });
  return [
    {
      id:'office-float', packageDir:'bb-studio-float', showSidebar:true,
      setup:async client=>{
        const fixture=await seedPages();
        await client.navigate(`/plugins/pages/pages/${fixture.page.id}`);
        await client.waitForText('Offline mode launch');
        await client.waitForSelector('.ProseMirror[contenteditable=true]');
        await client.evaluate(`window.officeFloatEditor=document.querySelector('.ProseMirror[contenteditable=true]'); true`);
        await client.clickAriaButtonWithPointer('Move');
        await client.clickElementWithTextAndPointer('[role=menuitem]','Float this');
        const selector=`[data-float-window="path:/plugins/pages/pages/${fixture.page.id}"] .ProseMirror[contenteditable=true]`;
        await client.waitForSelector(selector);
        await client.clickElementWithTextAndPointer('button','Home');
        await client.waitForText('ORBIT-42 checks are ready');
        if(!await client.evaluate(`document.querySelector(${JSON.stringify(selector)})===window.officeFloatEditor`)) throw Error('Float replaced the live editor');
        return fixture.cleanup;
      },
    },
    capture('office-home','staged-preview.png','/plugins/studio/office',['ORBIT-42 checks are ready','Atlas wants to edit the release checklist']),
    capture('office-inbox','office-inbox.png','/plugins/studio/office/inbox/all',['All spaces','ORBIT-42 checks are ready','Atlas wants to edit the release checklist']),
    capture('office-sidebar','office-sidebar.png','/plugins/studio/office',['ORBIT-42 release room','Orbit'],async client=>{
      for (const name of ['Atlas','Scribe','Quinn']) await client.waitForSelector(`[aria-label="Team"] button[title^="${name}"]`);
    }),
    capture('office-bot-chat','office-bot-chat.png',f=>`/plugins/studio/office/team/${f.botId}`,['Give a task','Chat','Tasks']),
    capture('office-bot-tasks','office-bot-tasks.png',f=>`/plugins/studio/office/team/${f.botId}/tasks`,['Review the ORBIT-42 release checklist']),
    capture('office-settings','office-settings.png','/plugins/studio/office/settings',['Ask first','Act and report']),
    capture('office-delegate','office-delegate.png',f=>`/plugins/studio/office/team/${f.botId}`,['Give a task'],async client=>{
      await client.clickElementWithTextAndPointer('button','Give a task');
      await client.waitForSelector('[role="dialog"]');
      await client.waitForText('Hand off');
    }),
    capture('office-approval','office-approval.png',f=>`/projects/${f.projectId}/threads/${f.threadId}`,['Atlas wants to edit a page','Ask first: approve this change','Approve','Deny']),
  ];
};
