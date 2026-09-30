// Mermaid diagrams: the block shows the rendered diagram and edits its source
// in BlockNote's source popup (click the diagram, or Enter on it).
import { createReactBlockSpec, SourceBlockWithPreview } from "@blocknote/react";
import { useEffect, useState } from "react";
import { MERMAID_PATH, PLUGIN_ID } from "../constants";
import { mermaidConfig } from "../schema-config";
import { useDarkMode } from "./shared";

type Mermaid = typeof import("mermaid").default;

let mermaidModule: Promise<Mermaid> | null = null;
let configuredDark: boolean | null = null;
let renders = 0;

/** Mermaid's browser build, from the Pages server; it sets `window.mermaid`. */
function loadMermaid(): Promise<Mermaid> {
  mermaidModule ??= new Promise<Mermaid>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `/api/v1/plugins/${PLUGIN_ID}/http${MERMAID_PATH}`;
    script.async = true;
    script.onload = () => {
      const mermaid = (window as { mermaid?: Mermaid }).mermaid;
      if (mermaid) resolve(mermaid);
      else reject(new Error("Mermaid didn't load."));
    };
    script.onerror = () => reject(new Error("Mermaid didn't load."));
    document.head.append(script);
  }).catch((error: unknown) => {
    mermaidModule = null;
    throw error;
  });
  return mermaidModule;
}

async function renderMermaid(source: string, dark: boolean): Promise<string> {
  const mermaid = await loadMermaid();
  if (configuredDark !== dark) {
    // "strict" sanitizes labels and disables click handlers in diagrams.
    mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: dark ? "dark" : "default", fontFamily: "inherit" });
    configuredDark = dark;
  }
  await mermaid.parse(source);
  const id = `pages-mermaid-${(renders += 1)}`;
  try {
    return (await mermaid.render(id, source)).svg;
  } finally {
    // Mermaid leaves its scratch element behind when rendering fails.
    document.getElementById(`d${id}`)?.remove();
  }
}

export function plainSource(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((item) => (item && typeof item === "object" && "text" in item ? String(item.text) : "")).join("");
}

function MermaidPreview({ source, children }: { source: string; children(result: { svg: string | null; error: string | null }): React.ReactNode }) {
  const dark = useDarkMode();
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!source.trim()) {
      setSvg(null);
      setError(null);
      return;
    }
    let live = true;
    // Typing in the source popup re-renders; wait for a pause.
    const timer = setTimeout(() => {
      renderMermaid(source, dark)
        .then((next) => {
          if (!live) return;
          setSvg(next);
          setError(null);
        })
        .catch((cause: unknown) => live && setError(cause instanceof Error ? cause.message : String(cause)));
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [source, dark]);
  return <>{children({ svg, error })}</>;
}

export const MermaidBlock = createReactBlockSpec(mermaidConfig, {
  meta: { hasPreview: true, hardBreakShortcut: "enter", code: true },
  render: ({ block, editor, contentRef }) => {
    const source = plainSource(block.content);
    return (
      <MermaidPreview source={source}>
        {({ svg, error }) => (
          <SourceBlockWithPreview
            block={block}
            editor={editor}
            contentRef={contentRef}
            source={source}
            preview={svg ? <div className="pages-mermaid flex w-full justify-center overflow-x-auto" dangerouslySetInnerHTML={{ __html: svg }} /> : undefined}
            error={error}
            emptySourcePlaceholder="Add a Mermaid diagram"
            errorPreview="This diagram has an error"
            sourcePlaceholder="flowchart LR; A --> B"
          />
        )}
      </MermaidPreview>
    );
  },
});
