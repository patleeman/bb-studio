type Draft = { id: string; title: string; base: string; at: number; supersedes?: string };
type Page = { title: string; updatedAt: number };
export type TitleTransport = {
  update(input: { id: string; title: string; expectedTitle: string }): Promise<{ page: Page }>;
  get(input: { id: string }): Promise<{ page: Page | null }>;
};
export type TitleSnapshot = {
  title: string;
  status: "saved" | "pending" | "saving" | "recovered" | "failed" | "conflict";
  error: string | null;
  localError: string | null;
  currentTitle: string;
  alternatives: Draft[];
};
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
type TitleRecoveryMemory = {
  drafts: Map<string, Draft>;
  unpersisted: Set<string>;
  persisted?: Set<string>;
  listening: boolean;
  warn(event: BeforeUnloadEvent): void;
};
// Plugin reloads replace modules, but drafts and their exit warning must keep
// the same owner until storage or the server acknowledges them.
const memoryKey = Symbol.for("bb-studio-pages:pending-title-recovery");
const memoryHost = globalThis as typeof globalThis & { [key: symbol]: TitleRecoveryMemory | undefined };
const recoveryMemory: TitleRecoveryMemory = memoryHost[memoryKey] ??= {
  drafts: new Map(),
  unpersisted: new Set(),
  listening: false,
  warn(event) { event.preventDefault(); event.returnValue = ""; },
};
const memoryDrafts = recoveryMemory.drafts;
const unpersisted = recoveryMemory.unpersisted;
const persisted = recoveryMemory.persisted ??= new Set<string>();
function markUnpersisted(key: string, failed: boolean) {
  if (failed) unpersisted.add(key); else unpersisted.delete(key);
  if (unpersisted.size && !recoveryMemory.listening) {
    window.addEventListener("beforeunload", recoveryMemory.warn);
    recoveryMemory.listening = true;
  } else if (!unpersisted.size && recoveryMemory.listening) {
    window.removeEventListener("beforeunload", recoveryMemory.warn);
    recoveryMemory.listening = false;
  }
}

/** Immutable, uniquely keyed versions prevent one tab from replacing another
 * tab's recovery. Only a version we have consumed or saved is removed. */
export class TitleRecovery {
  private readonly prefix: string;
  constructor(readonly origin: string, pageId: string, private readonly storage: () => Storage = () => localStorage) {
    this.prefix = `bb-studio-pages:title:${JSON.stringify([origin, pageId])}:`;
  }
  private decode(key: string, raw: string): Draft {
    try {
      const draft = JSON.parse(raw) as Draft | null;
      if (draft && typeof draft.id === "string" && key === this.prefix + draft.id &&
        typeof draft.title === "string" && draft.title.length <= 200 &&
        typeof draft.base === "string" && draft.base.length <= 200 && Number.isFinite(draft.at) &&
        (draft.supersedes === undefined || typeof draft.supersedes === "string")) return draft;
    } catch { /* Keep corrupt records for export. */ }
    throw new Error("Could not read a saved title draft. Keep this browser's recovery data and retry.");
  }
  load(): Draft[] {
    const storage = this.storage();
    const drafts = new Map(this.memory().map(draft => [draft.id, draft]));
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (!key?.startsWith(this.prefix)) continue;
      try {
        const draft = this.decode(key, storage.getItem(key) ?? "null");
        drafts.set(draft.id, draft);
        persisted.add(key);
      } catch { throw new Error("Could not read a saved title draft. Keep this browser's recovery data and retry."); }
    }
    const checked = new Set<string>();
    for (const draft of drafts.values()) {
      const chain = new Set<string>();
      let id: string | undefined = draft.id;
      while (id && drafts.has(id) && !checked.has(id)) {
        if (chain.has(id)) throw new Error("Could not read a saved title draft. Keep this browser's recovery data and retry.");
        chain.add(id);
        id = drafts.get(id)!.supersedes;
      }
      for (const key of chain) checked.add(key);
    }
    const superseded = new Set([...drafts.values()].map(draft => draft.supersedes));
    return [...drafts.values()].filter(draft => !superseded.has(draft.id)).sort((a, b) => b.at - a.at);
  }
  memory(): Draft[] {
    return [...memoryDrafts].filter(([key]) => key.startsWith(this.prefix)).map(([, draft]) => draft).sort((a, b) => b.at - a.at);
  }
  hasUnpersisted(): boolean { return [...unpersisted].some(key => key.startsWith(this.prefix)); }
  predecessor(draft: Draft): string | undefined {
    return persisted.has(this.prefix + draft.id) ? draft.id : draft.supersedes;
  }
  save(draft: Draft) {
    const key = this.prefix + draft.id;
    memoryDrafts.set(key, draft);
    try {
      this.storage().setItem(key, JSON.stringify(draft));
      persisted.add(key);
      markUnpersisted(key, false);
    }
    catch (error) { markUnpersisted(key, true); throw error; }
    this.removePredecessors(draft);
  }
  private removeKey(key: string) {
    this.storage().removeItem(key);
    memoryDrafts.delete(key);
    persisted.delete(key);
    markUnpersisted(key, false);
  }
  private removePredecessors(draft: Draft) {
    const keys: string[] = [];
    const seen = new Set([draft.id]);
    let id = draft.supersedes;
    while (id) {
      if (seen.has(id)) throw new Error("Could not clean up cyclic title recovery. Download the draft before closing.");
      seen.add(id);
      const key = this.prefix + id;
      const raw = this.storage().getItem(key);
      if (raw === null) break;
      keys.push(key);
      id = this.decode(key, raw).supersedes;
    }
    // Keep each link until its ancestors have gone. If removal fails, the
    // newest durable version still names the entire chain after a reload.
    for (const key of keys.reverse()) this.removeKey(key);
  }
  remove(draft: Draft) {
    this.removePredecessors(draft);
    this.removeKey(this.prefix + draft.id);
  }
  forgetMemory(draft: Draft) {
    const key = this.prefix + draft.id;
    memoryDrafts.delete(key);
    markUnpersisted(key, false);
  }
  exportRecords(): { records: Record<string, string | null>; error?: string } {
    const records: Record<string, string | null> = {};
    try {
      const storage = this.storage();
      for (let index = 0; index < storage.length; index++) {
        const key = storage.key(index);
        if (key?.startsWith(this.prefix)) records[key] = storage.getItem(key);
      }
      return { records };
    } catch (error) { return { records, error: errorText(error) }; }
  }
}

/** One controller owns one captured page/origin and serializes title writes. */
export class PageTitle {
  snapshot: TitleSnapshot;
  private draft: Draft | null;
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private saving = false;
  private disposed = false;
  private epoch = 0;
  private server: Page;
  private readError: string | null = null;
  constructor(readonly pageId: string, page: Page, private readonly transport: TitleTransport, private readonly recovery: TitleRecovery) {
    this.server = page;
    let drafts: Draft[] = recovery.memory();
    let localError: string | null = null;
    try { drafts = recovery.load(); } catch (error) { localError = this.readError = errorText(error); }
    if (recovery.hasUnpersisted()) localError ??= "The title draft is only kept in this open browser. Retry local recovery before closing.";
    this.draft = drafts[0] ?? null;
    this.snapshot = {
      title: this.draft?.title ?? page.title, status: this.draft ? "recovered" : "saved",
      currentTitle: page.title, error: null, localError, alternatives: drafts.slice(1),
    };
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private emit(patch: Partial<TitleSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }
  private persist(next: Draft, previous: Draft | null) {
    try {
      this.recovery.save(next);
      if (previous && previous.id !== next.id) this.recovery.remove(previous);
      this.emit({ localError: this.readError });
    } catch (error) {
      // The newest immutable record is already in memory; retain the previous
      // on-disk record, but do not accumulate stale memory-only keystrokes.
      if (previous && previous.id !== next.id) this.recovery.forgetMemory(previous);
      this.emit({ localError: errorText(error) });
    }
  }
  private replace(title: string, base: string) {
    const previous = this.draft;
    this.draft = { id: crypto.randomUUID(), title, base, at: Math.max(Date.now(), (previous?.at ?? 0) + 1),
      ...(previous ? { supersedes: this.recovery.predecessor(previous) } : {}) };
    this.persist(this.draft, previous);
  }
  observe(page: Page) {
    if (page.updatedAt < this.server.updatedAt) return;
    this.server = page;
    this.emit({ currentTitle: page.title, ...(!this.draft ? { title: page.title } : {}) });
  }
  edit = (title: string) => {
    if (this.disposed) return;
    this.replace(title, this.draft?.base ?? this.server.title);
    this.emit({ title, status: "pending", error: null });
    this.schedule();
  };
  private schedule() {
    if (this.timer) clearTimeout(this.timer);
    if (!this.disposed) this.timer = setTimeout(() => { this.timer = null; void this.save(); }, 400);
  }
  retry = () => { if (!this.draft) this.retryLocal(); else void this.save(); };
  retryLocal = () => {
    try {
      const records = this.recovery.load();
      this.readError = null;
      const alternatives = new Map([...this.snapshot.alternatives, ...records].map(draft => [draft.id, draft]));
      if (this.draft) alternatives.delete(this.draft.id);
      else {
        this.draft = records[0] ?? null;
        if (this.draft) alternatives.delete(this.draft.id);
      }
      this.emit({
        alternatives: [...alternatives.values()], localError: null,
        ...(this.draft && this.snapshot.status === "saved" ? { title: this.draft.title, status: "recovered" } : {}),
      });
      if (this.draft) this.persist(this.draft, null);
    } catch (error) { this.readError = errorText(error); this.emit({ localError: this.readError }); }
  };
  useMine = () => {
    if (!this.draft || this.saving) return;
    this.replace(this.draft.title, this.snapshot.currentTitle);
    void this.save();
  };
  choose = (id: string) => {
    if (this.saving) return;
    const selected = this.snapshot.alternatives.find(draft => draft.id === id);
    if (!selected) return;
    this.epoch++;
    if (this.timer) clearTimeout(this.timer);
    const alternatives = this.snapshot.alternatives.filter(draft => draft.id !== id);
    if (this.draft) alternatives.push(this.draft);
    this.draft = selected;
    this.emit({ title: selected.title, status: "recovered", error: null, alternatives });
  };
  discard = () => {
    if (this.saving || !this.draft) return;
    try { this.recovery.remove(this.draft); }
    catch (error) { this.emit({ localError: errorText(error) }); return; }
    this.epoch++;
    this.draft = null;
    if (this.timer) clearTimeout(this.timer);
    this.emit({ title: this.server.title, status: "saved", error: null, localError: null });
  };
  export = () => {
    const text = JSON.stringify({ origin: this.recovery.origin, pageId: this.pageId, draft: this.draft, otherDrafts: this.snapshot.alternatives, browserRecovery: this.recovery.exportRecords() }, null, 2);
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url; link.download = `${this.pageId}-title-recovery.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  private accept(submitted: Draft, page: Page, epoch: number) {
    this.server = page;
    if (epoch !== this.epoch) return;
    if (this.draft?.id === submitted.id) {
      try { this.recovery.remove(submitted); this.emit({ localError: this.readError }); }
      catch (error) {
        this.recovery.forgetMemory(submitted); // The server has this version.
        this.emit({ localError: errorText(error) });
      }
      this.draft = null;
      this.emit({ title: page.title, status: "saved", error: null, currentTitle: page.title });
    } else if (this.draft) {
      // A successful older request advances only our own newer typing's base.
      this.replace(this.draft.title, page.title);
      this.emit({ status: "pending", error: null, currentTitle: page.title });
      this.schedule();
    }
  }
  private async save() {
    if (this.disposed || this.saving || !this.draft) return;
    if (this.timer) clearTimeout(this.timer);
    const submitted = this.draft;
    const epoch = this.epoch;
    this.persist(submitted, null);
    this.saving = true;
    this.emit({ status: "saving", error: null });
    try {
      const result = await this.transport.update({ id: this.pageId, title: submitted.title.trim(), expectedTitle: submitted.base });
      this.accept(submitted, result.page, epoch);
    } catch (error) {
      // A failed response may follow a committed write. Read the server before
      // deciding whether to retry, report a conflict, or clear recovery.
      let current: Page | null | undefined;
      try { current = (await this.transport.get({ id: this.pageId })).page; } catch { /* Keep the draft on read failure too. */ }
      if (current?.title === submitted.title.trim()) this.accept(submitted, current, epoch);
      else if (epoch === this.epoch) {
        if (current) this.server = current;
        this.emit({
          status: current && current.title !== submitted.base ? "conflict" : "failed",
          currentTitle: current?.title ?? this.server.title,
          error: current === null ? "This page no longer exists. Download your title draft to keep it." : errorText(error),
        });
      }
    } finally { this.saving = false; }
  }
  attach() { this.disposed = false; }
  dispose() { this.disposed = true; if (this.timer) clearTimeout(this.timer); this.listeners.clear(); }
}
