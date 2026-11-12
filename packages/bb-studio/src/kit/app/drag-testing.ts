// For tests: a DataTransfer that keeps what is written to it, and drag
// events that carry one, since jsdom has neither.
export class FakeDataTransfer {
  private data = new Map<string, string>();
  effectAllowed = "uninitialized";
  dropEffect = "none";
  files: File[] = [];
  constructor(files: File[] = []) { this.files = files; }
  get types(): string[] { return [...this.data.keys(), ...(this.files.length ? ["Files"] : [])]; }
  setData(type: string, value: string): void { this.data.set(type, value); }
  getData(type: string): string { return this.data.get(type) ?? ""; }
}

/** A DataTransfer for a test, typed as the DOM's. */
export const fakeTransfer = (files: File[] = []): DataTransfer => new FakeDataTransfer(files) as unknown as DataTransfer;

/** Dispatches a drag event of `type` on `element` carrying `transfer`. Wrap it in `act` where React is listening. */
export function dispatchDrag(type: string, element: Element, transfer: DataTransfer, init: MouseEventInit = {}): MouseEvent {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
  Object.defineProperty(event, "dataTransfer", { value: transfer });
  element.dispatchEvent(event);
  return event;
}
