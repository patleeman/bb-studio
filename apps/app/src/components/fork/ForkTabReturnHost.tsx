import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { isBareWindow } from "@/lib/fork-bare-window";
import { listenForTabReturns } from "@/lib/fork-tab-return";
import { getThreadLocationPath } from "@/lib/route-paths";

export function ForkTabReturnHost() {
  const navigate = useNavigate();
  useEffect(() => {
    if (isBareWindow()) return;
    return listenForTabReturns((threadId, projectId) => {
      void navigate(getThreadLocationPath({ projectId, threadId }));
    });
  }, [navigate]);
  return null;
}
