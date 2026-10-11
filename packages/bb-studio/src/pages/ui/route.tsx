// A page as a Studio tab: /plugins/studio/studio/pages/<page id>, and
// `<page id>/chat/<thread id>` with that chat's card showing. Loaded by
// app.tsx the first time a page opens: it brings the editor (BlockNote, Yjs,
// Mermaid, Shiki, Recharts).
import { PagesPanel } from "./PagesPanel";

export default function PageRoute({ id, rest }: { id: string; rest?: string }) {
  return <PagesPanel subPath={[id, rest ?? ""].filter(Boolean).join("/")} />;
}
