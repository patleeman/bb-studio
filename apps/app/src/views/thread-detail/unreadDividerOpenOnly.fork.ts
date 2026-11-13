interface OpenThreadDividerSnapshot<TPlacement> {
  attentionAt: number;
  autoScroll: boolean;
  placement: TPlacement | null;
  threadId: string;
}

export function keepDividerWhileReading<TPlacement>(
  current: OpenThreadDividerSnapshot<TPlacement> | null,
  thread: { id: string; latestAttentionAt: number },
): OpenThreadDividerSnapshot<TPlacement> | null {
  if (current === null || current.threadId !== thread.id) return null;
  return {
    ...current,
    attentionAt: thread.latestAttentionAt,
    autoScroll: false,
    placement: null,
  };
}
