// The Inbox: everything waiting on you, then reports and comments, from every
// project. Requests are acted on in place.
import { PageColumn } from "@bb-studio/kit/app";
import { InboxRow } from "./InboxRow";
import { useLive, type InboxEvent, type TeamBot } from "./model";

export function Inbox() {
  const inbox = useLive<{ events: InboxEvent[] }>("inbox_list", { spaceId: "all" }, { pollMs: 30_000 });
  const team = useLive<{ bots: TeamBot[] }>("team_list", { spaceId: "all" });
  const bots = new Map((team.data?.bots ?? []).map((bot) => [bot.id, bot]));
  const events = inbox.data?.events ?? [];
  const requests = events.filter((event) => event.type === "request");
  const rest = events.filter((event) => event.type !== "request");
  const row = (event: InboxEvent) => <InboxRow key={event.key} event={event} bot={event.botId ? bots.get(event.botId) : undefined} onChanged={inbox.refresh} />;
  return (
    <PageColumn className="max-w-3xl">
      <h1 className="text-2xl font-semibold">Inbox</h1>
      {inbox.error && !inbox.data ? <p role="alert" className="mt-4 text-sm text-destructive">{inbox.error}</p> : null}
      <section aria-label="Needs you" className="mt-8">
        <h2 className="mb-1 text-sm font-medium text-muted-foreground">Needs you</h2>
        {requests.length ? <ul>{requests.map(row)}</ul> : inbox.data ? <p className="py-2 text-sm text-muted-foreground">Nothing is waiting on you.</p> : null}
      </section>
      <section aria-label="Reports and comments" className="mt-8">
        <h2 className="mb-1 text-sm font-medium text-muted-foreground">Reports and comments</h2>
        {rest.length ? <ul>{rest.map(row)}</ul> : inbox.data ? <p className="py-2 text-sm text-muted-foreground">You're caught up.</p> : null}
      </section>
    </PageColumn>
  );
}
