export const HIDDEN_FOOTER_KEY = "sidebar.hiddenFooterItems";
export const FOOTER_ARRANGED_KV_KEY = "footer.arranged.v1";

export const FOOTER_MOVED_TO_MORE = [
  "builtin:mobile",
  "builtin:report-bug",
  "plugin:bb--provider-usage/usage",
  "plugin:studio/accounts",
  "plugin:studio/health",
  "plugin:studio/report-bug",
] as const;

export function arrangedFooter(hidden: readonly string[]): string[] {
  return [...new Set([...hidden, ...FOOTER_MOVED_TO_MORE])];
}

interface Preference<Value> { value: Value; revision: number }
export interface FooterDeps {
  kv: { get(key: string): Promise<unknown>; set(key: string, value: unknown): Promise<void> };
  list(): Promise<{ preferences: { [HIDDEN_FOOTER_KEY]: Preference<string[]> } }>;
  set(input: { key: string; value: unknown; expectedRevision: number }): Promise<unknown>;
}

export async function arrangeFooterOnce(deps: FooterDeps): Promise<boolean> {
  if (await deps.kv.get(FOOTER_ARRANGED_KV_KEY)) return false;
  for (let attempt = 0; ; attempt++) {
    const { preferences } = await deps.list();
    const hidden = preferences[HIDDEN_FOOTER_KEY];
    const next = arrangedFooter(hidden.value);
    try {
      if (next.length !== hidden.value.length) await deps.set({ key: HIDDEN_FOOTER_KEY, value: next, expectedRevision: hidden.revision });
      break;
    } catch (error) {
      if (attempt > 0) throw error;
    }
  }
  await deps.kv.set(FOOTER_ARRANGED_KV_KEY, true);
  return true;
}
