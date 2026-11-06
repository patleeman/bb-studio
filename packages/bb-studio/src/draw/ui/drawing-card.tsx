// A drawing's summary and the name to show for it.

export type DrawingMeta = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  elementCount: number;
};

export function drawingName(drawing: Pick<DrawingMeta, "name">): string {
  return drawing.name.trim() || "Untitled whiteboard";
}
