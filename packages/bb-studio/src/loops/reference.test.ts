import { expect, it } from 'vitest';
import { loopReference } from './reference';

it('drops a loop into the composer as its card line and its title on one line', () => {
  expect(loopReference({ id: 'loop_abc', title: 'Reply to Yassine\n about the  referral' })).toBe('::loop{id="loop_abc"}\nAbout: Reply to Yassine about the referral\n');
});
