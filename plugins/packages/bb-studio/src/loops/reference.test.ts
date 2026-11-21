import { expect, it } from 'vitest';
import { ownerText } from './reference';

it('names the user as "the user" in the agent notes, and other owners as stored', () => {
  expect(['patrick', 'user', 'cos', 'thread:thr_x'].map(ownerText)).toEqual(['the user', 'the user', 'cos', 'thread:thr_x']);
});
