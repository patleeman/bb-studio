import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { isBareWindow } from "@/lib/fork-bare-window";
import { listenForTabReturns } from "@/lib/fork-tab-return";
import { getThreadRoutePath } from "@/lib/route-paths";

export function ForkTabReturnHost() {
  const navigate = useNavigate();
  useEffect(() => {
    if (isBareWindow()) return;
    return listenForTabReturns((threadId, projectId) => {
      void navigate(getThreadRoutePath({ projectId, threadId }));
    });
  }, [navigate]);
  return null;
}
