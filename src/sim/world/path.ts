// Ordinary single-cell A* over the wrapped hex map (master Section 14.3). God footprint search is a
// separate M02 concern. Costs are positive integers; the heuristic is the wrapped hex distance times
// the minimum step cost, which is admissible. Exhausting the expansion budget is BUDGET_EXCEEDED,
// never reported as NO_PATH.

import { distance, neighbors, type MapDimensions } from './hex.ts';

export type PathResult =
  | { readonly kind: 'FOUND'; readonly cells: number[]; readonly cost: number; readonly expanded: number }
  | { readonly kind: 'NO_PATH'; readonly expanded: number }
  | { readonly kind: 'BUDGET_EXCEEDED'; readonly expanded: number };

export interface PathQuery {
  readonly dims: MapDimensions;
  readonly from: number;
  readonly to: number;
  /** Cost to enter `to` from `from`, or null when the edge is impassable. Must be >= minStepCost. */
  readonly stepCost: (from: number, to: number) => number | null;
  readonly minStepCost: number;
  readonly maxExpansions: number;
}

/** Binary min-heap keyed by (f, h, key) for a stable, deterministic expansion order. */
export class OpenSet {
  private readonly items: { f: number; h: number; cell: number }[] = [];

  get size(): number {
    return this.items.length;
  }

  private less(a: { f: number; h: number; cell: number }, b: { f: number; h: number; cell: number }): boolean {
    if (a.f !== b.f) return a.f < b.f;
    if (a.h !== b.h) return a.h < b.h;
    return a.cell < b.cell;
  }

  push(item: { f: number; h: number; cell: number }): void {
    const items = this.items;
    items.push(item);
    let index = items.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (!this.less(items[index] as typeof item, items[parent] as typeof item)) break;
      [items[index], items[parent]] = [items[parent] as typeof item, items[index] as typeof item];
      index = parent;
    }
  }

  pop(): { f: number; h: number; cell: number } | undefined {
    const items = this.items;
    const top = items[0];
    const last = items.pop();
    if (items.length > 0 && last) {
      items[0] = last;
      let index = 0;
      for (;;) {
        const left = index * 2 + 1;
        const right = left + 1;
        let smallest = index;
        if (left < items.length && this.less(items[left] as typeof last, items[smallest] as typeof last)) smallest = left;
        if (right < items.length && this.less(items[right] as typeof last, items[smallest] as typeof last)) smallest = right;
        if (smallest === index) break;
        [items[index], items[smallest]] = [items[smallest] as typeof last, items[index] as typeof last];
        index = smallest;
      }
    }
    return top;
  }
}

export function findPath(query: PathQuery): PathResult {
  const { dims, from, to, stepCost, minStepCost, maxExpansions } = query;
  if (from === to) return { kind: 'FOUND', cells: [from], cost: 0, expanded: 0 };
  const heuristic = (cell: number): number => distance(dims, cell, to) * minStepCost;
  const best = new Map<number, number>([[from, 0]]);
  const cameFrom = new Map<number, number>();
  const closed = new Set<number>();
  const open = new OpenSet();
  open.push({ f: heuristic(from), h: heuristic(from), cell: from });
  let expanded = 0;
  while (open.size > 0) {
    const node = open.pop();
    if (!node || closed.has(node.cell)) continue;
    if (node.cell === to) {
      const cells = [to];
      let cursor = to;
      while (cursor !== from) {
        cursor = cameFrom.get(cursor) as number;
        cells.push(cursor);
      }
      return { kind: 'FOUND', cells: cells.reverse(), cost: best.get(to) as number, expanded };
    }
    if (expanded >= maxExpansions) return { kind: 'BUDGET_EXCEEDED', expanded };
    expanded += 1;
    closed.add(node.cell);
    const g = best.get(node.cell) as number;
    for (const next of neighbors(dims, node.cell)) {
      if (next < 0 || closed.has(next)) continue;
      const cost = stepCost(node.cell, next);
      if (cost === null) continue;
      if (cost < minStepCost) throw new RangeError(`step cost ${cost} below declared minimum ${minStepCost}`);
      const tentative = g + cost;
      if (tentative < (best.get(next) ?? Number.POSITIVE_INFINITY)) {
        best.set(next, tentative);
        cameFrom.set(next, node.cell);
        const h = heuristic(next);
        open.push({ f: tentative + h, h, cell: next });
      }
    }
  }
  return { kind: 'NO_PATH', expanded };
}
