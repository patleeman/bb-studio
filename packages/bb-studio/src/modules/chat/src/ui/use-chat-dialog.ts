import { useCallback, useEffect, useRef, useState } from "react";
import type { ItemChatRef } from "@bb-studio/kit/app";
import type { ItemQuote } from "@bb-studio/kit/format";
import type { Viewed } from "../contract";

export interface ChatDialog {
  item: Viewed;
  mode: "compose" | "choose";
  request: number;
  quote?: ItemQuote;
}

/** An explicit action owns its item even when the main route changes. */
export function useChatDialog(
  resolve: (ref: ItemChatRef) => Promise<Viewed | null>,
  onError: (cause: unknown) => void,
) {
  const [dialog, setDialog] = useState<ChatDialog | null>(null);
  const request = useRef(0);
  useEffect(() => () => { request.current += 1; }, []);
  const isCurrent = useCallback((expected: number) => request.current === expected, []);
  const close = useCallback((expected?: number) => {
    if (expected !== undefined && request.current !== expected) return;
    request.current += 1;
    setDialog(null);
  }, []);
  const open = useCallback(async (ref: ItemChatRef, mode: ChatDialog["mode"], quote?: ItemQuote) => {
    const current = ++request.current;
    try {
      const item = await resolve(ref);
      if (request.current !== current) return;
      if (!item) throw new Error("That Studio item is archived or gone.");
      setDialog({ item, mode, request: current, ...(quote ? { quote } : {}) });
    } catch (cause) {
      if (request.current === current) onError(cause);
    }
  }, [resolve, onError]);
  return { dialog, open, close, isCurrent };
}
