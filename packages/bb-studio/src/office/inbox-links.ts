/** Retired Office panels must never strand an Inbox event. */
export function retiredOfficeHref(href: string | null): boolean {
  return !!href && /^(?:\/plugins\/studio\/(?:office(?:-(?:team|home|talk))?(?:[/?#]|$)|channels(?:[/?#]|$))|\/office\/talk(?:[/?#]|$))/.test(href);
}
export function inboxHref(event: { href: string | null; threadId: string | null; item: { href: string } | null; projectId: string | null }): string | null {
  if (event.href && !retiredOfficeHref(event.href)) return event.href;
  if (event.threadId) return `/threads/${encodeURIComponent(event.threadId)}`;
  if (event.item?.href && !retiredOfficeHref(event.item.href)) return event.item.href;
  if (event.projectId) return `/plugins/studio/projects/${encodeURIComponent(event.projectId)}`;
  return null;
}
