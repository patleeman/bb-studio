import { usageReportHtml } from "../seed.mjs";
import entrypoints from "./companion-suite-entrypoints.mjs";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export default context => {
  const { projectId, seedPages, seedDrawing, seedTalkRecording, talkRpc, pluginRpc, sleep } = context;
  const native = process.env.BB_CAPTURE_SUITE_HOST === "native";
  const fixtures = [
    { id: "pages", packageDir: "bb-studio-pages", seed: async () => { const { page, cleanup } = await seedPages(); return { path: `/plugins/pages/pages/${page.id}`, title: page.title, ready: '.pages-editor .ProseMirror', cleanup }; } },
    { id: "draw", packageDir: "bb-studio-draw", seed: async () => { const { drawing, cleanup } = await seedDrawing(); return { path: `/plugins/excalidraw/drawings/${drawing.id}`, ready: 'canvas.excalidraw__canvas', cleanup }; } },
    { id: "artifacts", packageDir: "bb-studio-artifacts", seed: async () => { const { id } = await pluginRpc("artifacts", "importFile", { name: "q3-usage-report.html", mime: "text/html", bytes: Buffer.from(usageReportHtml({ draft: false })).toString("base64"), projectId }); return { path: `/plugins/artifacts/artifacts/${id}`, ready: 'iframe[title="q3-usage-report.html"]', cleanup: () => pluginRpc("artifacts", "delete", { id }) }; } },
    { id: "talk", packageDir: "bb-studio-talk", seed: async () => { const id = await seedTalkRecording(projectId, { transcribe: false }); return { path: `/plugins/talk/recordings/${id}`, ready: 'input[aria-label="Title"]', cleanup: () => talkRpc("recording_delete", { id }) }; } },
    { id: "tables", packageDir: "bb-studio-tables", seed: async () => {
      const { table } = await pluginRpc("studio-tables", "create", { title: "Retained release inventory", projectId, columns: [{ id: "name", name: "Name", type: "text", options: [] }] });
      await pluginRpc("studio-tables", "insert", { id: table.id, values: { name: "Review notes" } });
      return { path: `/plugins/studio-tables/tables/${table.id}`, ready: 'input[aria-label="Table title"]', cleanup: () => pluginRpc("studio-tables", "remove", { id: table.id }) };
    } },
    { id: "teams", packageDir: "bb-studio-teams", seed: async () => {
      const { bots } = await pluginRpc("bot-teams", "list", null);
      const existing = bots.find(b => b.handle === "atlas");
      const bot = existing ?? await pluginRpc("bot-teams", "create", { name: "Companion profile check", mission: "Wait for explicit owner input. No scheduled work.", intervalMinutes: 0 });
      return { path: `/plugins/bot-teams/bots/${bot.id}/profile`, ready: '[aria-label="Bot profile"] input[id$="-name"]', cleanup: async () => { if (!existing) await pluginRpc("bot-teams", "retire", { id: bot.id, retired: true }); } };
    } },
    ...entrypoints(context),
  ];
  return fixtures.map(fixture => ({
    id: `suite-${native ? "native" : "stable"}-${fixture.id}`, packageDir: fixture.packageDir,
    fileName: `${fixture.id.includes("-") ? `${fixture.id}-` : ""}companion-transfers-${native ? "native" : "stable"}.png`, privateSidebar: true,
    setup: async client => {
      const seeded = await fixture.seed(client);
      const path = seeded.target ?? seeded.path;
      const key = `path:${path}`;
      const selector = `[data-float-window="${key}"] ${seeded.ready}`;
      let originalFrame;
      let embeddedTarget;
      let frameSession;
      let attachmentDir;
      let originalFile;
      const frameCommand = (method, params = {}) => new Promise((resolve, reject) => {
        const id = client.nextId++;
        const timer = setTimeout(() => { client.pending.delete(id); reject(new Error(`Embedded CDP ${method} timed out`)); }, 15000);
        client.pending.set(id, {
          resolve: result => { clearTimeout(timer); resolve(result); },
          reject: error => { clearTimeout(timer); reject(error); },
        });
        client.socket.send(JSON.stringify({ id, sessionId: frameSession, method, params }));
      });
      let selectionChecked = false;
      const forget = async () => {
        if (frameSession) await client.command('Target.detachFromTarget', { sessionId: frameSession }).catch(() => {});
        await seeded.beforeUnload?.();
        await client.evaluate(`sessionStorage.removeItem('bb-studio-float:windows'); sessionStorage.removeItem('bb:companion-views:v1'); delete window.bbSuiteTransfer`).catch(() => {});
        await client.command('Page.navigate', { url: 'about:blank' });
        await sleep(400);
        await seeded.cleanup();
        if (attachmentDir) await rm(attachmentDir, { recursive: true, force: true });
      };
      const errors = [];
      const onMessage = event => {
        const message = JSON.parse(event.data);
        if (message.method === 'Runtime.exceptionThrown' || message.method === 'Log.entryAdded' || (message.method === 'Runtime.consoleAPICalled' && message.params?.type === 'error')) errors.push(message.params);
      };
      client.socket.addEventListener('message', onMessage);
      await client.command('Runtime.enable');
      await client.command('Log.enable');
      const expectOriginal = async placement => {
        await sleep(350);
        const result = await client.evaluate(`(() => {
          const nodes = [...document.querySelectorAll(${JSON.stringify(selector)})];
          const node = nodes[0];
          const state = JSON.parse(sessionStorage.getItem('bb-studio-float:windows'));
          const tabs = state?.tabs.filter(tab => tab.key === ${JSON.stringify(key)}) ?? [];
          const bounds = node?.getBoundingClientRect();
          return { same: nodes.length === window.bbSuiteTransfer.length && nodes.every((node, index) => node === window.bbSuiteTransfer[index]), connected: window.bbSuiteTransfer.every(node => node.isConnected),
            visible: !!node?.checkVisibility(), count: nodes.length, expectedCount: window.bbSuiteTransfer.length,
            placement: tabs[0]?.placement, tabs: tabs.length, inViewport: !!bounds && bounds.right > 0 && bounds.left < innerWidth && bounds.bottom > 0 && bounds.top < innerHeight };
        })()`);
        if (!result.same || !result.connected || !result.visible || !result.inViewport || result.count !== result.expectedCount || result.tabs !== 1 || result.placement !== placement)
          throw new Error(`${fixture.id} lost its original control in ${placement}: ${JSON.stringify(result)}`);
        if (process.env.BB_CAPTURE_TRANSFER_SELECTION === '1' && fixture.id === 'pages' && !selectionChecked) {
          const selection = await client.evaluate(`(() => { const selection = getSelection(); return { anchor: selection.anchorOffset, focus: selection.focusOffset, sameAnchor: selection.anchorNode === window.bbSuiteSelectionNode, sameFocus: selection.focusNode === window.bbSuiteSelectionNode }; })()`);
          if (!selection.sameAnchor || !selection.sameFocus || selection.anchor !== 8 || selection.focus !== 2) throw new Error(`Backward selection changed in ${placement}: ${JSON.stringify(selection)}`);
          selectionChecked = true;
        }
        if (originalFrame) {
          const { frameTree } = await (frameSession ? frameCommand('Page.getFrameTree') : client.command('Page.getFrameTree'));
          const find = tree => tree.frame.id === originalFrame.id ? tree.frame : tree.childFrames?.map(find).find(Boolean);
          const frame = find(frameTree);
          if (frame?.loaderId !== originalFrame.loaderId) throw new Error(`Embedded document reloaded in ${placement}: ${JSON.stringify({ originalFrame, frame })}`);
        }
        if (embeddedTarget) {
          const { targetInfos } = await client.command('Target.getTargets');
          if (!targetInfos.some(target => target.targetId === embeddedTarget.targetId)) throw new Error(`Embedded browsing context replaced in ${placement}: ${JSON.stringify({ embeddedTarget, targets: targetInfos.filter(target => target.type === 'iframe') })}`);
          const { result } = await frameCommand('Runtime.evaluate', { expression: `window.bbSuiteEmbeddedState === 'Original embedded document'`, returnByValue: true });
          if (result.value !== true) throw new Error(`Embedded document state reset in ${placement}`);
        }
        if (fixture.id === 'teams' && await client.evaluate(`window.bbSuiteTransfer[0].value`) !== 'Companion profile draft') throw new Error(`Teams draft changed in ${placement}`);
        if (seeded.draft) {
          const draft = await client.evaluate(`window.bbSuiteTransfer[0].value ?? window.bbSuiteTransfer[0].textContent`);
          if (draft !== seeded.draft) throw new Error(`${fixture.id} draft changed in ${placement}: ${JSON.stringify(draft)}`);
        }
        if (seeded.initialValue && await client.evaluate(`window.bbSuiteTransfer[0].value`) !== seeded.initialValue) throw new Error(`${fixture.id} choice changed in ${placement}`);
        if (seeded.quoteText && !(await client.evaluate(`window.bbSuiteTransfer[0].textContent.includes(${JSON.stringify(seeded.quoteText)})`))) throw new Error(`${fixture.id} quote context changed in ${placement}`);
        if (originalFile) {
          const file = await client.evaluate(`(() => { const root = document.querySelector(${JSON.stringify(`[data-float-window="${key}"]`)}); const input = window.bbSuiteFile; const attachments = root.querySelectorAll('button[aria-label="Remove review-notes.txt"]'); const attachment = attachments[0]; return { same: input === root.querySelector('input[type="file"]'), connected: input.isConnected, sameAttachment: attachment === window.bbSuiteAttachment, attachmentCount: attachments.length, attachmentConnected: window.bbSuiteAttachment.isConnected, visible: !!attachment?.checkVisibility() }; })()`);
          if (!file.same || !file.connected || !file.sameAttachment || file.attachmentCount !== 1 || !file.attachmentConnected || !file.visible) throw new Error(`${fixture.id} attachment changed in ${placement}: ${JSON.stringify(file)}`);
        }
      };
      const menu = async label => {
        await client.clickAriaButtonWithPointer("Floating tab actions");
        await client.clickElementWithTextAndPointer('[role="menuitem"]', label);
      };
      try {
        await client.navigate(seeded.path);
        await client.waitForSelector(seeded.ready, 90000);
        if (await client.evaluate(`typeof window.__bbPluginRuntime?.pluginSdkApp?.experimental_CompanionOutlet === 'function'`) !== native)
          throw new Error("The suite capture requires its specified host capability");
        await client.evaluate(`(() => { window.bbSuiteTransfer = [...document.querySelectorAll(${JSON.stringify(seeded.ready)})]; return true; })()`);
        if (seeded.initialValue) {
          await client.evaluate(`(() => { const select = window.bbSuiteTransfer[0]; select.focus(); select.value = ${JSON.stringify(seeded.initialValue)}; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
          await sleep(350);
          if (await client.evaluate(`window.bbSuiteTransfer[0].value`) !== seeded.initialValue) throw new Error("Could not choose the staged activity period");
        }
        if (seeded.appendDraft) {
          const previous = await client.evaluate(`window.bbSuiteTransfer[0].textContent`);
          await client.evaluate(`(() => { const node = window.bbSuiteTransfer[0]; node.focus(); const range = document.createRange(); range.selectNodeContents(node); range.collapse(false); getSelection().removeAllRanges(); getSelection().addRange(range); })()`);
          await client.command('Input.insertText', { text: seeded.appendDraft });
          seeded.draft = previous + seeded.appendDraft;
        }
        if (seeded.draft && !seeded.appendDraft) {
          await client.evaluate(`(() => { const node = window.bbSuiteTransfer[0]; node.focus(); if (node.select) node.select(); else { const range = document.createRange(); range.selectNodeContents(node); getSelection().removeAllRanges(); getSelection().addRange(range); } })()`);
          await client.command('Input.insertText', { text: seeded.draft });
        }
        if (seeded.visibleText) await client.waitForText(seeded.visibleText);
        if (seeded.attachment) {
          await client.evaluate(`(() => { const root = document.querySelector(${JSON.stringify(`[data-studio-main-view=${JSON.stringify(seeded.path)}]`)}); root.querySelectorAll('button[aria-label="Remove review-notes.txt"]').forEach(button => button.click()); })()`);
          await sleep(350);
          attachmentDir = await mkdtemp(join(tmpdir(), 'bb-suite-attachment-'));
          const file = join(attachmentDir, 'review-notes.txt');
          await writeFile(file, 'Keep this original attachment through every move.');
          const { root } = await client.command('DOM.getDocument');
          const { nodeId } = await client.command('DOM.querySelector', { nodeId: root.nodeId, selector: `[data-studio-main-view=${JSON.stringify(seeded.path)}] input[type="file"]` });
          if (!nodeId) throw new Error(`Missing original composer file input: ${JSON.stringify(await client.evaluate(`({ views: [...document.querySelectorAll('[data-studio-main-view]')].map(node => node.getAttribute('data-studio-main-view')), inputs: [...document.querySelectorAll('input[type="file"]')].map(node => node.closest('[data-studio-main-view]')?.getAttribute('data-studio-main-view')) })`))}`);
          await client.command('DOM.setFileInputFiles', { nodeId, files: [file] });
          await client.waitForSelector('button[aria-label="Remove review-notes.txt"]');
          originalFile = await client.evaluate(`(() => { const root = document.querySelector(${JSON.stringify(`[data-studio-main-view=${JSON.stringify(seeded.path)}]`)}); window.bbSuiteFile = root.querySelector('input[type="file"]'); window.bbSuiteAttachment = root.querySelector('button[aria-label="Remove review-notes.txt"]'); return !!window.bbSuiteFile && !!window.bbSuiteAttachment; })()`);
          if (!originalFile) throw new Error('Original attachment was not staged');
        }
        if (fixture.id === 'teams') {
          await client.evaluate(`window.bbSuiteTransfer[0].focus(); window.bbSuiteTransfer[0].select()`);
          await client.command('Input.insertText', { text: 'Companion profile draft' });
        }
        if (process.env.BB_CAPTURE_TRANSFER_SELECTION === '1' && fixture.id === 'pages') {
          await client.evaluate(`(() => { const editor = window.bbSuiteTransfer[0]; editor.focus(); const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT); let node; while ((node = walker.nextNode())) { if (node.textContent.length >= 8) { window.bbSuiteSelectionNode = node; getSelection().setBaseAndExtent(node, 8, node, 2); return true; } } throw new Error('Missing staged text to select'); })()`);
        }
        if (process.env.BB_CAPTURE_TRANSFER_FRAME === '1' && (fixture.id === 'artifacts' || seeded.embedded)) {
          await sleep(1500);
          const { frameTree } = await client.command('Page.getFrameTree');
          const matchesFrame = frame => seeded.embedded ? frame.url === 'about:srcdoc' : frame.url.includes('/api/');
          originalFrame = frameTree.childFrames?.find(tree => matchesFrame(tree.frame))?.frame;
          if (!originalFrame) {
            const { targetInfos } = await client.command('Target.getTargets');
            embeddedTarget = targetInfos.find(target => target.type === 'iframe' && matchesFrame(target));
            if (!embeddedTarget) throw new Error(`Missing embedded report frame: ${JSON.stringify({ frameTree, targetInfos })}`);
            ({ sessionId: frameSession } = await client.command('Target.attachToTarget', { targetId: embeddedTarget.targetId, flatten: true }));
            originalFrame = (await frameCommand('Page.getFrameTree')).frameTree.frame;
            await frameCommand('Runtime.evaluate', { expression: `window.bbSuiteEmbeddedState = 'Original embedded document'` });
          }
        }
        if (process.env.BB_CAPTURE_TRANSFER_SELECTION === '1' && fixture.id === 'pages') {
          await client.evaluate(`window.__bbStudioFloat_v1.host.open({kind: 'path', path: ${JSON.stringify(path)}, title: ${JSON.stringify(seeded.title)}})`);
        } else {
          await client.clickElementWithTextAndPointer(`[data-studio-main-view=${JSON.stringify(seeded.path)}] button[aria-label="Move"]`, '');
          await client.clickElementWithTextAndPointer('[role="menuitem"]', "Float this");
        }
        await client.waitForSelector(selector);
        await expectOriginal("floating");
        if (native) {
          await menu("Move to workbench");
          await expectOriginal("workbench");
          await client.clickElementWithTextAndPointer("button", "Main view");
        } else await menu("Move to main view");
        await expectOriginal("main");
        await client.clickElementWithTextAndPointer("button", "Float");
        await expectOriginal("floating");
        if (native) { await menu("Move to workbench"); await expectOriginal("workbench"); }
        else { await menu("Move to main view"); await expectOriginal("main"); }
        console.log(`Verified ${fixture.id}: original main control retained through ${native ? "Float/workbench/main/Float/workbench" : "Float/main/Float/main"}, one tab and visible viewport`);
      } catch (error) {
        console.error(JSON.stringify(errors.filter(error => error.type === 'error' || error.exceptionDetails || error.entry?.level === 'error').map(error => ({ type: error.type, details: error.exceptionDetails?.text ?? error.entry?.text ?? error.args?.map(arg => arg.value ?? arg.description?.slice(0, 1400)) }))));
        console.error(await client.evaluate(`JSON.stringify({ path: location.pathname, text: document.body.innerText.slice(-2500), panels: [...(window.__bbStudioFloat_v1?.panels ?? [])], state: sessionStorage.getItem('bb-studio-float:windows') })`).catch(() => "Capture unavailable"));
        await forget(); throw error;
      } finally {
        client.socket.removeEventListener('message', onMessage);
      }
      return forget;
    },
  }));
};
