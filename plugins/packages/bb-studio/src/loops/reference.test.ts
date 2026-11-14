import { expect, it } from 'vitest';
import type { Loop } from './contract';
import { loopContext, loopReference, ownerText } from './reference';

it('drops a todo into the composer as its card line and its title on one line', () => {
  expect(loopReference({ id: 'loop_abc', title: 'Reply to Sam\n about the  planning doc' })).toBe('::loop{id="loop_abc"}\nAbout: Reply to Sam about the planning doc\n');
});

it('names the user as "the user" in the agent notes, and other owners as stored', () => {
  expect(['patrick', 'user', 'cos', 'thread:thr_x'].map(ownerText)).toEqual(['the user', 'the user', 'cos', 'thread:thr_x']);
  const loop: Loop = { id: 'loop_a', title: 'Call', why: '', source: null, kind: 'do', options: [], owner: 'patrick', trigger: { type: 'none' }, priority: 'normal', push: false, status: 'surfaced', due: null, area: null, createdAt: 1, updatedAt: 1, closedAt: null, closedBy: null };
  const context = loopContext(loop);
  expect(context).toContain('owner: the user · priority');
  expect(context).not.toContain('patrick');
  expect(loopContext({ ...loop, owner: 'cos' })).toContain('owner: cos · priority');
});
