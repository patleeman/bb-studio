import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@bb/shared-ui/button";
import { Checkbox } from "@bb/shared-ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@bb/shared-ui/dialog";
import { getBbDesktopInfo } from "@/lib/bb-desktop";
import {
  claimPairing,
  listPendingApprovals,
  nextApprovalForBrowser,
  readApproverSession,
  resolveApproval,
  startPairing,
  type PendingApproval,
} from "./fork-approvals";

const POLL_MS = 3_000;
const CLAIM_POLL_MS = 2_000;

type Pairing = { pairingId: string; secret: string; approvalId: string };

export function ForkApprovalHost() {
  const [pending, setPending] = useState<PendingApproval[]>([]);
  const [approver, setApprover] = useState(false);
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [failed, setFailed] = useState<string | null>(null);
  const sentToDesktop = useRef(new Set<string>());
  const [desktopHandled, setDesktopHandled] = useState<ReadonlySet<string>>(
    new Set(),
  );

  useEffect(() => {
    let live = true;
    const load = async () => {
      if (document.visibilityState !== "visible") return;
      const approvals = await listPendingApprovals();
      if (!live) return;
      setPending(approvals);
      const answer = getBbDesktopInfo()?.experimental_answerApproval;
      if (answer === undefined) return;
      for (const approval of approvals) {
        if (sentToDesktop.current.has(approval.id)) continue;
        sentToDesktop.current.add(approval.id);
        setDesktopHandled(new Set(sentToDesktop.current));
        void answer(approval.id).then((result) => {
          if (result === "answered" || !live) return;
          sentToDesktop.current.delete(approval.id);
          setDesktopHandled(new Set(sentToDesktop.current));
        });
      }
    };
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);

  const current = nextApprovalForBrowser(
    pending,
    desktopHandled,
    pairing?.approvalId ?? null,
  );
  const currentId = current?.id ?? null;

  useEffect(() => {
    if (currentId === null) return;
    setFailed(null);
    setPicked({});
    void readApproverSession().then(setApprover);
  }, [currentId]);

  useEffect(() => {
    if (pairing === null) return;
    let live = true;
    const timer = setInterval(() => {
      void claimPairing(pairing.pairingId, pairing.secret).then((paired) => {
        if (!live || !paired) return;
        setPairing(null);
        setApprover(true);
      });
    }, CLAIM_POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [pairing]);

  const answer = useCallback(
    async (approved: boolean) => {
      if (current === null) return;
      const ok = await resolveApproval(current.id, {
        approved,
        picked: approved
          ? current.items
              .filter((item) => picked[item.id] !== false)
              .map((item) => item.id)
          : [],
      });
      if (ok) {
        setPending((list) => list.filter((each) => each.id !== current.id));
      } else {
        setFailed("Could not answer. Pair this browser again.");
        setApprover(false);
      }
    },
    [current, picked],
  );

  if (current === null) return null;
  return (
    <Dialog
      open
      onOpenChange={(open) => (open ? undefined : void answer(false))}
    >
      <DialogContent data-testid="fork-approval-dialog">
        <DialogHeader>
          <DialogTitle>{current.title}</DialogTitle>
          <DialogDescription>{current.message}</DialogDescription>
        </DialogHeader>
        {current.items.length > 0 ? (
          <ul className="flex flex-col gap-2 text-sm">
            {current.items.map((item) => (
              <li key={item.id}>
                <label className="flex items-center gap-2">
                  <Checkbox
                    checked={picked[item.id] !== false}
                    disabled={!approver}
                    onCheckedChange={(checked) =>
                      setPicked((state) => ({
                        ...state,
                        [item.id]: checked === true,
                      }))
                    }
                  />
                  <span>{item.label}</span>
                </label>
              </li>
            ))}
          </ul>
        ) : null}
        {current.detail ? (
          <p className="text-xs text-muted-foreground">{current.detail}</p>
        ) : null}
        <p className="text-xs text-muted-foreground">
          Asked by the {current.pluginId} plugin.
        </p>
        {approver ? null : (
          <p className="text-sm" data-testid="fork-approval-pairing">
            {pairing === null
              ? "This browser is not paired."
              : "Waiting for the bb desktop app."}
          </p>
        )}
        {failed ? <p className="text-sm text-destructive">{failed}</p> : null}
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => void answer(false)}
            disabled={!approver}
          >
            Deny
          </Button>
          {approver ? (
            <Button onClick={() => void answer(true)}>
              {current.confirmLabel}
            </Button>
          ) : (
            <Button
              disabled={pairing !== null}
              onClick={() => void startPairing().then(setPairing)}
            >
              Pair this browser
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
