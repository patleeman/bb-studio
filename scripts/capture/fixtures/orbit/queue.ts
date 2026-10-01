// Uploads waiting to be sent, oldest first.
export interface Upload {
  id: string;
  send: () => Promise<void>;
}

const pending: Upload[] = [];
const failed = new Set<string>();

export function enqueue(upload: Upload): void {
  pending.push(upload);
}

export function nextUpload(): Upload | undefined {
  return pending.pop();
}

export function markFailed(id: string): void {
  failed.add(id);
}
