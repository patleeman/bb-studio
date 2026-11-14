// A todo brought into the Bot chat to talk about (Discuss, or a row dragged
// into the composer). Discuss inserts a `@loop` mention chip; at send time
// the mention provider resolves it to `loopContext`, which the Bot sees and
// the user doesn't. A drag can only carry text, so it carries `loopReference`:
// the todo's card line, which the Bot reads as "this todo is the topic" and
// looks up with todos_get, then its title in words. Pure: the server and the
// app both use it.
import type { Loop } from './contract';

export const ownerText = (owner: string): string => (owner === 'patrick' || owner === 'user' ? 'the user' : owner);

/** The mention provider's id: `@loop` in any composer. */
export const LOOP_MENTION = 'loop';
/** What a user message with this line, or a Todo mention, means to the Bot. */
export const LOOP_TOPIC_HINT = 'A ::loop{id="…"} line or a Todo mention in the user\'s message means that todo is the topic: read it with todos_get before you answer.';

const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();

/** The text a dragged row drops into the composer. */
export function loopReference(loop: Pick<Loop, 'id' | 'title'>): string {
  return `::loop{id="${loop.id}"}\nAbout: ${oneLine(loop.title)}\n`;
}

const iso = (at: number) => new Date(at).toISOString();
function triggerText(trigger: Loop['trigger']): string {
  switch (trigger.type) {
    case 'time': return trigger.at ? `time, ${iso(trigger.at)}` : 'time';
    case 'event': return `event ${trigger.event ?? ''}${trigger.label ? ` (${trigger.label})` : ''}`;
    case 'place': return `place, ${trigger.direction ?? 'arrive'} ${trigger.place ?? ''}`;
    default: return 'none (when there is room in the attention budget)';
  }
}

/** What a Todo mention gives the Bot: the todo's id, title, why and trigger, and how to act on it. */
export function loopContext(loop: Loop): string {
  const lines = [
    `The user brought this todo into the chat to discuss it; it is the topic of their message. Use todos_get for its history and todos_update or todos_act to change it.`,
    `id: ${loop.id}`,
    `title: ${oneLine(loop.title)}`,
    `why: ${oneLine(loop.why) || '(none)'}`,
    `trigger: ${triggerText(loop.trigger)}${loop.push ? ', sends to iPhone' : ''}`,
    `kind: ${loop.kind} · status: ${loop.status} · owner: ${ownerText(loop.owner)} · priority: ${loop.priority}${loop.area ? ` · area: ${loop.area}` : ''}`,
  ];
  if (loop.due) lines.push(`due: ${iso(loop.due)}`);
  if (loop.options.length) lines.push(`options: ${loop.options.join(' | ')}`);
  if (loop.source) lines.push(`source: ${loop.source.kind} · ${loop.source.ref}`);
  if (loop.closedAt) lines.push(`closed: ${iso(loop.closedAt)}${loop.closedBy ? ` by ${loop.closedBy}` : ''}`);
  return lines.join('\n');
}
