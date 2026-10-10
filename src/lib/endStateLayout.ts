import type { EndStateEdge, EndStateNode } from '../types';

/**
 * Positions for the end-state workflow, keeping the original's layout wherever a node survives
 * so the Compare view reads as "the same diagram, changed". Pure and DOM-free, like
 * `edgeRouting.ts`: the viewer hasn't measured anything yet, so sizes are estimates from the
 * node CSS (min/max widths, typical content).
 *
 * 1. A node kept on the same canvas keeps its position.
 * 2. A node that replaces originals takes the left-most of their positions on its canvas.
 * 3. Any other node on a canvas with placed nodes goes next to its placed neighbours — between
 *    predecessor and successor when there's room, else one column right of the predecessor (or
 *    left of the successor) — nudged down until it clears everything already placed.
 * 4. A canvas with nothing placed (a new sub-flow) gets a simple layered layout.
 */

type Point = { x: number; y: number };
interface Rect extends Point {
  width: number;
  height: number;
}

const SIZE: Record<EndStateNode['type'], { width: number; height: number }> = {
  task: { width: 220, height: 90 },
  flow: { width: 220, height: 90 },
  decision: { width: 120, height: 120 },
  start: { width: 110, height: 44 },
  end: { width: 110, height: 44 },
};
const COLUMN = 260;
const ROW = 140;
const NUDGE = 120;
const GAP = 24;

const rectOf = (n: EndStateNode, p: Point): Rect => ({ ...p, ...SIZE[n.type] });

function overlaps(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width + GAP &&
    b.x < a.x + a.width + GAP &&
    a.y < b.y + b.height + GAP &&
    b.y < a.y + a.height + GAP
  );
}

const avg = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length;

/** Longest-path layers from the canvas's sources, ignoring edges that close a cycle. */
function layered(nodes: EndStateNode[], edges: EndStateEdge[]): Map<string, Point> {
  const ids = new Set(nodes.map((n) => n.id));
  const out = new Map<string, string[]>();
  for (const e of edges) {
    if (ids.has(e.source) && ids.has(e.target)) out.set(e.source, [...(out.get(e.source) ?? []), e.target]);
  }

  // DFS from every node, dropping back edges (to a node still on the stack).
  const forward = new Map<string, string[]>();
  const state = new Map<string, 'open' | 'done'>();
  const visit = (id: string) => {
    state.set(id, 'open');
    for (const t of out.get(id) ?? []) {
      if (state.get(t) === 'open') continue;
      forward.set(id, [...(forward.get(id) ?? []), t]);
      if (!state.has(t)) visit(t);
    }
    state.set(id, 'done');
  };
  const ordered = [...nodes].sort((a, b) => Number(b.type === 'start') - Number(a.type === 'start'));
  for (const n of ordered) if (!state.has(n.id)) visit(n.id);

  // Longest path over the forward edges, which the DFS above has made acyclic.
  const layer = new Map<string, number>();
  const depth = (id: string): number => {
    if (layer.has(id)) return layer.get(id)!;
    const preds = nodes.filter((n) => forward.get(n.id)?.includes(id));
    const d = preds.length ? Math.max(...preds.map((p) => depth(p.id))) + 1 : 0;
    layer.set(id, d);
    return d;
  };
  for (const n of nodes) depth(n.id);

  const byLayer = new Map<number, string[]>();
  for (const n of nodes) byLayer.set(layer.get(n.id)!, [...(byLayer.get(layer.get(n.id)!) ?? []), n.id]);
  const positions = new Map<string, Point>();
  for (const [l, members] of byLayer) {
    members.forEach((id, i) => positions.set(id, { x: l * COLUMN, y: (i - (members.length - 1) / 2) * ROW }));
  }
  return positions;
}

export function layoutEndState(
  nodes: EndStateNode[],
  edges: EndStateEdge[],
  original: Map<string, { flowId: string; position: Point }>,
): Map<string, Point> {
  const positions = new Map<string, Point>();
  const flowIds = [...new Set(nodes.map((n) => n.flowId))];

  for (const flowId of flowIds) {
    const onCanvas = nodes.filter((n) => n.flowId === flowId);
    const canvasEdges = edges.filter((e) => e.flowId === flowId);
    const placed = new Map<string, Rect>();
    const place = (n: EndStateNode, p: Point) => {
      positions.set(n.id, p);
      placed.set(n.id, rectOf(n, p));
    };
    const clear = (n: EndStateNode, p: Point): Point => {
      let at = { ...p };
      for (let i = 0; i < 40 && [...placed.values()].some((r) => overlaps(rectOf(n, at), r)); i++) {
        at = { x: at.x, y: at.y + NUDGE };
      }
      return at;
    };

    // 1. Kept on the same canvas.
    for (const n of onCanvas) {
      const o = original.get(n.id);
      if (o && o.flowId === flowId) place(n, o.position);
    }
    // 2. Replacements sit where the work they take over used to be.
    for (const n of onCanvas) {
      if (placed.has(n.id)) continue;
      const spots = (n.replacesNodeIds ?? [])
        .map((id) => original.get(id))
        .filter((o): o is { flowId: string; position: Point } => !!o && o.flowId === flowId)
        .map((o) => o.position)
        .sort((a, b) => a.x - b.x || a.y - b.y);
      if (spots.length) place(n, clear(n, spots[0]));
    }

    if (placed.size === 0) {
      // 4. A wholly new canvas.
      for (const [id, p] of layered(onCanvas, canvasEdges)) positions.set(id, p);
      continue;
    }

    // 3. Everything else, next to its placed neighbours, until nothing more can be placed.
    for (let progress = true; progress; ) {
      progress = false;
      for (const n of onCanvas) {
        if (placed.has(n.id)) continue;
        const preds = canvasEdges.filter((e) => e.target === n.id && placed.has(e.source)).map((e) => placed.get(e.source)!);
        const succs = canvasEdges.filter((e) => e.source === n.id && placed.has(e.target)).map((e) => placed.get(e.target)!);
        if (!preds.length && !succs.length) continue;

        let at: Point;
        if (preds.length && succs.length) {
          const left = Math.max(...preds.map((r) => r.x + r.width));
          const right = Math.min(...succs.map((r) => r.x));
          const width = SIZE[n.type].width;
          at =
            right - left >= width + 2 * GAP
              ? { x: (left + right - width) / 2, y: avg([...preds, ...succs].map((r) => r.y)) }
              : { x: Math.max(...preds.map((r) => r.x)) + COLUMN, y: avg(preds.map((r) => r.y)) };
        } else if (preds.length) {
          at = { x: Math.max(...preds.map((r) => r.x)) + COLUMN, y: avg(preds.map((r) => r.y)) };
        } else {
          at = { x: Math.min(...succs.map((r) => r.x)) - COLUMN, y: avg(succs.map((r) => r.y)) };
        }
        place(n, clear(n, at));
        progress = true;
      }
    }

    // Unconnected leftovers: a row under the canvas.
    const rest = onCanvas.filter((n) => !placed.has(n.id));
    if (rest.length) {
      const rects = [...placed.values()];
      const minX = Math.min(...rects.map((r) => r.x));
      const bottom = Math.max(...rects.map((r) => r.y + r.height));
      rest.forEach((n, i) => place(n, clear(n, { x: minX + i * COLUMN, y: bottom + ROW / 2 })));
    }
  }

  return positions;
}
