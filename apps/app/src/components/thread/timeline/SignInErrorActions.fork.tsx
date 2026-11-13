import { useState, type ReactNode } from "react";
import type { TimelineRow } from "@bb/server-contract";
import { Button } from "@bb/shared-ui/button";
import { useAppCommandRunner } from "@/components/commands/AppCommandProvider";
import { useCreateTerminal } from "@/hooks/queries/thread-terminal-queries";
import { useSystemProviderStates } from "@/hooks/queries/system-queries";
import { useThread } from "@/hooks/queries/thread-queries";
import { useAppNavigationHost } from "@/lib/app-navigation-host";
import { useThreadTimelineNavigation } from "./ThreadTimelineNavigationContext";

const SIGN_IN_TITLE = /^(.+) isn't signed in$/u;
const SIGNED_OUT = new Set(["unauthenticated", "expired"]);

export function signInErrorProviderName(row: TimelineRow): string | null {
  if (row.kind !== "system" || row.systemKind !== "error") return null;
  const title = typeof row.title === "string" ? row.title : "";
  return SIGN_IN_TITLE.exec(title)?.[1] ?? null;
}

function primaryComposer(): Element | null {
  return document.querySelector(
    '[data-app-composer][data-app-composer-role="primary"]',
  );
}

export function SignInErrorActions({
  detail,
  providerName,
}: {
  detail: string | null;
  providerName: string;
}) {
  const threadId = useThreadTimelineNavigation()?.threadId ?? "";
  const thread = useThread(threadId).data;
  const environmentId = thread?.environmentId ?? undefined;
  const states = useSystemProviderStates(
    environmentId === undefined ? {} : { environmentId },
  ).data?.providers;
  const state = states?.find((each) => each.providerId === thread?.providerId);
  const command = state?.localLoginCommand ?? state?.loginCommand ?? null;
  const canSignIn =
    threadId !== "" &&
    command !== null &&
    state !== undefined &&
    SIGNED_OUT.has(state.status);
  const createTerminal = useCreateTerminal();
  const navigation = useAppNavigationHost();
  const commands = useAppCommandRunner();
  const [failed, setFailed] = useState(false);

  const signIn = () => {
    if (!canSignIn || command === null) return;
    setFailed(false);
    createTerminal.mutate(
      {
        cols: 100,
        rows: 30,
        title: `Sign in to ${providerName}`,
        start: { mode: "command", command },
        target: { kind: "thread", threadId },
      },
      {
        onSuccess: (session) => {
          if (!navigation.openTerminal(session)) setFailed(true);
        },
        onError: () => setFailed(true),
      },
    );
  };

  return (
    <div
      data-testid="sign-in-error-actions"
      className="flex flex-col gap-2 rounded-lg border border-border bg-card px-4 py-3 text-sm"
    >
      {detail ? <p className="text-subtle-foreground">{detail}</p> : null}
      {failed ? (
        <p className="text-destructive">Couldn't open the sign-in terminal.</p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {canSignIn ? (
          <Button
            type="button"
            size="sm"
            disabled={createTerminal.isPending}
            onClick={signIn}
          >
            Sign in to {providerName}
          </Button>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            const composer = primaryComposer();
            if (composer !== null) commands.dispatch("modelPicker.toggle", composer);
          }}
        >
          Pick another model
        </Button>
      </div>
    </div>
  );
}

export function forkSignInErrorBody(row: TimelineRow): ReactNode | null {
  const providerName = signInErrorProviderName(row);
  if (providerName === null || row.kind !== "system") return null;
  return (
    <SignInErrorActions
      detail={typeof row.detail === "string" ? row.detail : null}
      providerName={providerName}
    />
  );
}
