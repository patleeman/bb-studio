import { expect, it } from 'vitest';
import { loopReference } from './reference';

it('drops a todo into the composer as its card line and its title on one line', () => {
  expect(loopReference({ id: 'loop_abc', title: 'Reply to Sam\n about the  planning doc' })).toBe('::loop{id="loop_abc"}\nAbout: Reply to Sam about the planning doc\n');
});
