import type { WorkflowDoc } from '@/types';

/**
 * A feedback loop: a strongly-connected component of one flow's task/decision/terminal
 * graph. Never stored on the document — always derived from `doc.nodes`/`doc.edges`, the
 * same convention `getFlowExits` uses for sub-flow exits.
 */
export interface Loop {
  /** Deterministic: derived from flowId + sorted member node ids. */
  id: string;
  flowId: string;
  /** SCC members, sorted by id. */
  nodeIds: string[];
  /** Edges with both ends inside the SCC, sorted by id. */
  edgeIds: string[];
  /** The edge(s) a DFS identifies as closing the cycle, sorted by id. */
  backEdgeIds: string[];
  /** Decision nodes in the loop with at least one edge leaving it. */
  guardedBy: string[];
  /** false when removing `guardedBy` still leaves a cycle — the loop can never terminate. */
  guarded: boolean;
}

interface EdgeRef {
  id: string;
  source: string;
  target: string;
}

interface LocalGraph {
  nodeIds: string[];
  adj: Map<string, { to: string; edgeId: string }[]>;
}

/** Adjacency restricted to `nodeIds`, edges sorted by id for deterministic traversal. */
function buildLocalGraph(nodeIds: string[], edges: EdgeRef[]): LocalGraph {
  const sortedIds = [...nodeIds].sort();
  const nodeSet = new Set(sortedIds);
  const adj = new Map<string, { to: string; edgeId: string }[]>();
  for (const id of sortedIds) adj.set(id, []);
  const relevant = edges
    .filter((e) => nodeSet.has(e.source) && nodeSet.has(e.target))
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id));
  for (const e of relevant) {
    adj.get(e.source)!.push({ to: e.target, edgeId: e.id });
  }
  return { nodeIds: sortedIds, adj };
}

/**
 * Iterative Tarjan's SCC algorithm (no recursion, so an unusually deep chain of tasks
 * can't blow the call stack). Returns components — including singletons — each sorted.
 */
function tarjanSCC(graph: LocalGraph): string[][] {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const result: string[][] = [];
  let counter = 0;

  for (const start of graph.nodeIds) {
    if (index.has(start)) continue;

    const work: { node: string; iter: number }[] = [{ node: start, iter: 0 }];

    while (work.length > 0) {
      const frame = work[work.length - 1];
      const { node } = frame;

      if (frame.iter === 0) {
        index.set(node, counter);
        low.set(node, counter);
        counter++;
        stack.push(node);
        onStack.add(node);
      }

      const neighbours = graph.adj.get(node) ?? [];
      let recursed = false;
      while (frame.iter < neighbours.length) {
        const next = neighbours[frame.iter].to;
        frame.iter++;
        if (!index.has(next)) {
          work.push({ node: next, iter: 0 });
          recursed = true;
          break;
        } else if (onStack.has(next)) {
          low.set(node, Math.min(low.get(node)!, index.get(next)!));
        }
      }
      if (recursed) continue;

      work.pop();
      if (work.length > 0) {
        const parent = work[work.length - 1].node;
        low.set(parent, Math.min(low.get(parent)!, low.get(node)!));
      }

      if (low.get(node) === index.get(node)) {
        const component: string[] = [];
        let w: string;
        do {
          w = stack.pop()!;
          onStack.delete(w);
          component.push(w);
        } while (w !== node);
        result.push(component.sort());
      }
    }
  }

  return result;
}

/** True if `nodeIds` (restricted to `edges`) still contains a cycle. */
function hasCycle(nodeIds: string[], edges: EdgeRef[]): boolean {
  if (nodeIds.length === 0) return false;
  const graph = buildLocalGraph(nodeIds, edges);
  return tarjanSCC(graph).some(
    (c) => c.length > 1 || edges.some((e) => e.source === c[0] && e.target === c[0]),
  );
}

/**
 * DFS from a single deterministic start node, recording edges that point back at a node
 * still on the DFS stack. Because every node in an SCC's induced subgraph is mutually
 * reachable using only edges within that subgraph, one DFS from any member visits the
 * whole component — so this always finds a full, deterministic feedback-edge set.
 */
function findBackEdges(component: string[], internalEdges: EdgeRef[], startNode: string): string[] {
  const graph = buildLocalGraph(component, internalEdges);
  const visited = new Set<string>([startNode]);
  const onStack = new Set<string>([startNode]);
  const backEdges: string[] = [];
  const stack: { node: string; iter: number }[] = [{ node: startNode, iter: 0 }];

  while (stack.length > 0) {
    const frame = stack[stack.length - 1];
    const neighbours = graph.adj.get(frame.node) ?? [];
    if (frame.iter < neighbours.length) {
      const { to, edgeId } = neighbours[frame.iter];
      frame.iter++;
      if (onStack.has(to)) {
        backEdges.push(edgeId);
      } else if (!visited.has(to)) {
        visited.add(to);
        onStack.add(to);
        stack.push({ node: to, iter: 0 });
      }
    } else {
      onStack.delete(frame.node);
      stack.pop();
    }
  }

  return [...new Set(backEdges)].sort();
}

/** Every feedback loop on one flow's canvas. */
export function findLoops(doc: WorkflowDoc, flowId: string): Loop[] {
  const flowNodes = doc.nodes.filter((n) => n.flowId === flowId);
  const nodeTypeById = new Map(flowNodes.map((n) => [n.id, n.data.type]));
  const nodeSet = new Set(flowNodes.map((n) => n.id));
  const flowEdges: EdgeRef[] = doc.edges
    .filter((e) => e.flowId === flowId && nodeSet.has(e.source) && nodeSet.has(e.target))
    .map((e) => ({ id: e.id, source: e.source, target: e.target }));

  const graph = buildLocalGraph([...nodeSet], flowEdges);
  const components = tarjanSCC(graph).filter(
    (c) => c.length > 1 || flowEdges.some((e) => e.source === c[0] && e.target === c[0]),
  );

  const loops: Loop[] = components.map((nodeIds) => {
    const componentSet = new Set(nodeIds);
    const internalEdges = flowEdges.filter((e) => componentSet.has(e.source) && componentSet.has(e.target));
    const edgeIds = internalEdges.map((e) => e.id).sort();

    const guardedBy = nodeIds
      .filter((id) => nodeTypeById.get(id) === 'decision')
      .filter((id) => flowEdges.some((e) => e.source === id && !componentSet.has(e.target)))
      .sort();

    const remaining = nodeIds.filter((id) => !guardedBy.includes(id));
    const guarded = !hasCycle(remaining, internalEdges);

    // Entry points: SCC members reached from outside the SCC. If none exist (the loop is
    // its own disconnected island), fall back to the lowest (y, id) member, mirroring the
    // tie-break `getFlowExits` uses for End nodes.
    const entryNodes = nodeIds
      .filter((id) => flowEdges.some((e) => e.target === id && !componentSet.has(e.source)))
      .sort();
    const startNode =
      entryNodes[0] ??
      [...nodeIds].sort((a, b) => {
        const na = flowNodes.find((n) => n.id === a)!;
        const nb = flowNodes.find((n) => n.id === b)!;
        return na.position.y - nb.position.y || a.localeCompare(b);
      })[0];

    const backEdgeIds = findBackEdges(nodeIds, internalEdges, startNode);

    return {
      id: `loop:${flowId}:${nodeIds.join(',')}`,
      flowId,
      nodeIds,
      edgeIds,
      backEdgeIds,
      guardedBy,
      guarded,
    };
  });

  return loops.sort((a, b) => a.id.localeCompare(b.id));
}

/** Every feedback loop across every flow in the document. */
export function findAllLoops(doc: WorkflowDoc): Loop[] {
  return doc.flows
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id))
    .flatMap((flow) => findLoops(doc, flow.id));
}

/** The loop, if any, that a given edge closes. */
export function findLoopByBackEdge(loops: Loop[], edgeId: string): Loop | undefined {
  return loops.find((l) => l.backEdgeIds.includes(edgeId));
}
