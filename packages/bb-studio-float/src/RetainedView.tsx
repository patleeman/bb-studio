import { useEffect, useState, type ReactNode } from "react";

/** Realize a tab on first use, then retain its editor and composer until close. */
export function RetainedView({ visible, children }: { visible: boolean; children: ReactNode }) {
  const [realized, setRealized] = useState(visible);
  useEffect(() => {
    if (visible) setRealized(true);
  }, [visible]);
  return (
    <div hidden={!visible} className={visible ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
      {visible || realized ? children : null}
    </div>
  );
}
