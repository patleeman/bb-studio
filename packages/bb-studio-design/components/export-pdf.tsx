// Export PDF: loads the screen's print page (src/server/print.ts) in a hidden
// frame, which opens the print dialog once its screens have loaded. Save as
// PDF there makes the file: one page per slide or step, at the frame's size.
import { useEffect, useState } from "react";
import { ICON_BUTTON, Icon, cn } from "@bb-studio/kit/app";
import { printUrl, type ScreenView } from "../src/shared";

/** Gives up on a print page that never reports back. */
const PRINT_TIMEOUT_MS = 120_000;

export function ExportPdfButton({ designId, screen }: { designId: string; screen: ScreenView }) {
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    if (!printing) return;
    const onMessage = (event: MessageEvent) => {
      if ((event.data as { bbDesignPrint?: string } | null)?.bbDesignPrint === "done") setPrinting(false);
    };
    const timer = setTimeout(() => setPrinting(false), PRINT_TIMEOUT_MS);
    window.addEventListener("message", onMessage);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("message", onMessage);
    };
  }, [printing]);

  const pages = screen.steps.length || 1;
  return (
    <>
      <button
        type="button"
        aria-label="Export PDF"
        title={printing ? "Preparing the PDF…" : `Export PDF (${pages} ${pages === 1 ? "page" : "pages"})`}
        disabled={printing}
        className={ICON_BUTTON}
        onClick={() => setPrinting(true)}
      >
        <Icon name={printing ? "Loading" : "Pdf01"} className={cn("size-4", printing && "animate-spin motion-reduce:animate-none")} />
      </button>
      {printing ? (
        <iframe
          title="PDF export"
          aria-hidden
          tabIndex={-1}
          src={printUrl(designId, screen.id, screen.updatedAt)}
          className="pointer-events-none fixed left-[-10000px] top-0 h-px w-px border-0 opacity-0"
        />
      ) : null}
    </>
  );
}
