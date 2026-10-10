import { useMemo } from 'react';
import { useNodesInitialized } from '@xyflow/react';
import { findLoops, findLoopByBackEdge } from '@/lib/cycles';
import type { Rect } from '@/lib/edgeRouting';
import type { WFEdge, WFNode, WorkflowDoc } from '@/types';

/**
 * The render-time decoration both canvases share. Neither result is ever written back to the
 * doc — loops and obstacles are derived on demand, never stored (see CLAUDE.md conventions).
 */

/**
 * Every edge as React Flow should draw it: `loopback` for an edge that closes a feedback loop
 * (with its guarded flag stamped on), `smart` for everything else.
 */
export function useDecoratedEdges<E extends WFEdge>(
  doc: WorkflowDoc,
  flowId: string,
  nodes: WFNode[],
  edges: E[],
) {
  // Loop detection (Tarjan's SCC) only cares about node types and edge source/target, not
  // about `doc` reference identity — which changes on every store write, including ones
  // that touch a totally different flow (e.g. typing in the Inspector). Keying the memo on
  // this topology string instead of on `doc` keeps findLoops from re-running on every
  // keystroke; see the FlowNode `handleKey` precedent for the same technique.
  const topoKey =
    nodes.map((n) => `${n.id}:${n.type}`).join('|') +
    '#' +
    edges.map((e) => `${e.id}:${e.source}>${e.target}`).join('|');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const loops = useMemo(() => findLoops(doc, flowId), [topoKey, flowId]);

  return edges.map((e) => {
    const loop = findLoopByBackEdge(loops, e.id);
    if (!loop) return { ...e, type: 'smart' };
    return { ...e, type: 'loopback', data: { ...e.data, loop: { guarded: loop.guarded } } };
  });
}

/**
 * Obstacle rects for edge routing, keyed by node id so an edge can exclude its own
 * source/target. Derived from measured node size, which React Flow writes back onto the
 * nodes via onNodesChange('dimensions') — see the topology-key precedent above for why this
 * is a string key rather than a node-array dependency. Recomputed on every position change,
 * including mid-drag: the key already changes on every drag frame (the dragged node's position
 * is part of it), so gating this on `dragging` bought no savings — it only made the memo return
 * `null` and drop every edge back to its plain, unrouted path for the duration of the drag,
 * which read as a jarring style change rather than a live update.
 */
export function useObstacleMap(nodes: WFNode[]): Map<string, Rect> | null {
  const nodesInitialized = useNodesInitialized();
  const geometryKey = nodes
    .map((n) => `${n.id}:${Math.round(n.position.x)}:${Math.round(n.position.y)}:${n.measured?.width ?? 0}:${n.measured?.height ?? 0}`)
    .join('|');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo<Map<string, Rect> | null>(() => {
    if (!nodesInitialized) return null;
    const map = new Map<string, Rect>();
    for (const n of nodes) {
      if (!n.measured?.width || !n.measured?.height) continue;
      map.set(n.id, { x: n.position.x, y: n.position.y, width: n.measured.width, height: n.measured.height });
    }
    return map;
  }, [geometryKey, nodesInitialized]);
}
