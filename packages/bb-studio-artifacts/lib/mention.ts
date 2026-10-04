// Pure helper: the agent-visible context for an artifact mention. Kept free of
// bb imports so it can be unit-tested standalone.
import { TYPE_LABELS, artifactHref, formatBytes, type ArtifactType } from "../src/shared";

const MAX_INLINE_CHARS = 60_000;

export interface MentionArtifact {
  id: string;
  title: string;
  description: string;
  type: ArtifactType;
  name: string;
  size: number;
  versions: number;
  updatedAt: number;
  /** The newest version's text, for text types. */
  text: string | null;
}

export function mentionContext(artifact: MentionArtifact): string {
  const lines = [
    `Studio artifact "${artifact.title}" (id ${artifact.id}): ${TYPE_LABELS[artifact.type]}, ${artifact.name}, ` +
      `${formatBytes(artifact.size)}, ${artifact.versions === 1 ? "1 version" : `${artifact.versions} versions`}, ` +
      `updated ${new Date(artifact.updatedAt).toISOString()}.`,
    `Link to it in replies as [${artifact.title.replace(/[[\]]/g, "")}](${artifactHref(artifact.id)}).`,
  ];
  if (artifact.description) lines.push(`Description: ${artifact.description}`);
  if (artifact.text === null) {
    lines.push(
      `To look at it, copy it into your workspace with 'bb artifacts export ${artifact.id}' and open the file it prints.`,
    );
  } else if (artifact.text.length <= MAX_INLINE_CHARS) {
    lines.push(`Contents of ${artifact.name}:\n\n${artifact.text}`);
  } else {
    lines.push(
      `It's ${artifact.text.length.toLocaleString("en-US")} characters, too long to inline. ` +
        `Read it with 'bb artifacts show ${artifact.id}', or copy it into your workspace with 'bb artifacts export ${artifact.id}'.`,
    );
  }
  lines.push(
    `To save a new version after changing it, write the file and call artifacts_save with the same path from this thread, ` +
      `or pass artifactId "${artifact.id}".`,
  );
  return lines.join("\n\n");
}
