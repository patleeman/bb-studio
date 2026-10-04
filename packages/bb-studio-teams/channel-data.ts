import { Store } from "./store";
import { defaultLimits } from "./workspace-contract";

/** Snapshots of the bot's plain-text documents and channel usage data. */
export class ChannelData {
  constructor(readonly store: Store) {

  }
  snapshot(scope: string, text: string, actor: string) {
    const previous = this.store.db
      .prepare(
        "SELECT text FROM document_revisions WHERE scope=? ORDER BY id DESC LIMIT 1",
      )
      .get(scope) as { text: string } | undefined;
    if (previous?.text === text) return;
    this.store.db
      .prepare(
        "INSERT INTO document_revisions(scope,text,actor,created_at) VALUES (?,?,?,?)",
      )
      .run(scope, text, actor, Date.now());
  }
  revisions(scope: string, before = Number.MAX_SAFE_INTEGER) {
    return this.store.db
      .prepare(
        "SELECT id,text,actor,created_at AS createdAt FROM document_revisions WHERE scope=? AND id<? ORDER BY id DESC LIMIT 20",
      )
      .all(scope, before) as {
      id: number;
      text: string;
      actor: string;
      createdAt: number;
    }[];
  }
  usage(botId: string) {
    const since = Date.now() - 24 * 60 * 60 * 1000;
    const limits = this.store.get(botId).limits ?? defaultLimits;
    const rows = this.store.db
      .prepare(
        `SELECT
      COALESCE(SUM(COALESCE(json_extract(json,'$.startedAt'),json_extract(json,'$.dispatchStartedAt')) IS NOT NULL),0) AS turns,
      COALESCE(SUM(json_extract(json,'$.conversationKey') LIKE '%:fork:%' AND COALESCE(json_extract(json,'$.startedAt'),json_extract(json,'$.dispatchStartedAt')) IS NOT NULL),0) AS forks,
      COALESCE(SUM(status IN ('running','dispatching','queued')),0) AS active,
      COALESCE(SUM(status='error'),0) AS errors
      FROM jobs WHERE COALESCE(json_extract(json,'$.startedAt'),json_extract(json,'$.dispatchStartedAt'),created_at)>=?
      AND bot_id=?`,
      )
      .get(since, botId) as {
      turns: number;
      forks: number;
      active: number;
      errors: number;
    };
    return { ...rows, routingCalls: 0, routingMilliseconds: 0, since, limits };
  }
}
