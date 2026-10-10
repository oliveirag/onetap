// Card-order helpers. All are worklets so the drag can run them on the UI thread every frame.
export type Positions = Record<string, number>;

export function moveId(order: string[], id: string, to: number): string[] {
  'worklet';
  const rest = order.filter((x) => x !== id);
  rest.splice(to, 0, id);
  return rest;
}

// Which slot the dragged row's top edge is closest to, clamped to the list.
export function indexForOffset(top: number, rowHeight: number, count: number): number {
  'worklet';
  return Math.min(count - 1, Math.max(0, Math.round(top / rowHeight)));
}

export function positionsFromOrder(order: string[]): Positions {
  'worklet';
  const out: Positions = {};
  order.forEach((id, i) => {
    out[id] = i;
  });
  return out;
}

export function orderFromPositions(positions: Positions): string[] {
  'worklet';
  return Object.keys(positions).sort((a, b) => positions[a] - positions[b]);
}
