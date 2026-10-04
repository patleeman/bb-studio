// An explainer's HTML document in a sandboxed iframe that fits its content.
// The same frame as Pages' HTML blocks (bb-studio-pages/src/ui/html.tsx).
import { useEffect, useRef, useState } from "react";

const HEIGHT_MESSAGE = "bb-explore-html-height";
const MIN_HEIGHT = 80;

// Reports the document's height to the page, so the frame fits its content,
// and opts HTML without its own color-scheme into BB's light or dark theme.
const FRAME_SCRIPT = `<script>(function(){var root=document.documentElement;if(getComputedStyle(root).colorScheme==="normal")root.style.colorScheme="light dark";var post=function(){parent.postMessage({type:"${HEIGHT_MESSAGE}",height:Math.ceil(root.getBoundingClientRect().height)},"*")};var observer=new ResizeObserver(post);observer.observe(root);if(document.body)observer.observe(document.body);addEventListener("load",post);post()})()</script>`;

function useDarkMode(): boolean {
  const read = () => document.documentElement.classList.contains("dark") || document.body.classList.contains("dark");
  const [dark, setDark] = useState(read);
  useEffect(() => {
    const observer = new MutationObserver(() => setDark(read()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme", "style"] });
    observer.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return dark;
}

/**
 * Same isolation as artifact embeds: scripts run, but in an opaque origin
 * with no access to BB, its cookies or storage, and no popups or navigation.
 */
export function HtmlFrame({ source, title, maxHeight }: { source: string; title: string; maxHeight: number }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const dark = useDarkMode();
  const [height, setHeight] = useState(MIN_HEIGHT * 2);
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!frame.current || event.source !== frame.current.contentWindow) return;
      const data = event.data as { type?: unknown; height?: unknown } | null;
      if (data?.type !== HEIGHT_MESSAGE || typeof data.height !== "number" || !Number.isFinite(data.height)) return;
      setHeight(Math.min(maxHeight, Math.max(MIN_HEIGHT, Math.ceil(data.height))));
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [maxHeight]);
  return (
    <iframe
      ref={frame}
      title={title}
      srcDoc={`${source}\n${FRAME_SCRIPT}`}
      sandbox="allow-scripts"
      loading="lazy"
      // The frame's prefers-color-scheme follows this, so HTML can match BB's theme.
      style={{ height, colorScheme: dark ? "dark" : "light" }}
      className="block w-full border-0 bg-transparent"
    />
  );
}
