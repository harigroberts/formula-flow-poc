import type { WorkflowDoc, WFNode, WFEdge, Flow, FlowRefData, TerminalData } from '@/types';
import { findLoops } from './cycles';
import { getFlowExits } from './exits';

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

export type GroupCheck = { ok: true } | { ok: false; reason: string };

type DocNode = WFNode & { flowId: string };
type DocEdge = WFEdge & { flowId: string };

/**
 * Nodes in `nodeIds` that either receive an edge from outside the selection, or receive no
 * incoming edge at all (a root of the induced subgraph). A group needs exactly one of these —
 * it's where the child flow's `start` node connects to, and where the parent's incoming
 * boundary edges get redirected onto the new flow node.
 */
export function findEntryCandidates(doc: WorkflowDoc, flowId: string, nodeIds: string[]): string[] {
  const selectedSet = new Set(nodeIds);
  const flowEdges = doc.edges.filter((e) => e.flowId === flowId);
  return nodeIds.filter((id) => {
    const incoming = flowEdges.filter((e) => e.target === id);
    if (incoming.length === 0) return true;
    return incoming.some((e) => !selectedSet.has(e.source));
  });
}

/**
 * The subset of `nodeIds` that can actually be moved into a new child flow — `start`/`end`
 * terminals are always excluded. A `start` node has no incoming edges, so pulling the current
 * flow's *only* one into a nested child would leave the flow with no entry point; an `end`
 * node can be exposed as one of this flow's own named exits via an ancestor's `sourceHandle`
 * (see `getFlowExits`), and moving it would silently orphan that reference since nothing
 * outside the current flow gets rewritten by a group/ungroup.
 *
 * Terminals are still perfectly fine to have *clicked* alongside the rest of a selection —
 * they're simply inert for grouping purposes, and the ordinary boundary-edge rewiring below
 * produces identical wiring whether or not they were part of the click (a selected `end` node
 * that an outgoing edge points at is just treated like any other unselected external target).
 */
export function groupableNodeIds(doc: WorkflowDoc, nodeIds: string[]): string[] {
  return nodeIds.filter((id) => {
    const node = doc.nodes.find((n) => n.id === id);
    return !!node && node.data.type !== 'start' && node.data.type !== 'end';
  });
}

export function canGroupNodes(doc: WorkflowDoc, flowId: string, nodeIds: string[]): GroupCheck {
  const rawIds = [...new Set(nodeIds)];
  const rawNodes = rawIds.map((id) => doc.nodes.find((n) => n.id === id));
  if (rawNodes.some((n) => !n)) return { ok: false, reason: 'One or more selected nodes no longer exist.' };
  const rawSelectedNodes = rawNodes as DocNode[];

  if (rawSelectedNodes.some((n) => n.flowId !== flowId)) {
    return { ok: false, reason: 'Selected nodes must all be on the current canvas.' };
  }

  const ids = groupableNodeIds(doc, rawIds);
  if (ids.length < 2) return { ok: false, reason: 'Select at least two non-terminal nodes to group.' };

  const selectedSet = new Set(ids);
  for (const loop of findLoops(doc, flowId)) {
    const inCount = loop.nodeIds.filter((id) => selectedSet.has(id)).length;
    if (inCount > 0 && inCount < loop.nodeIds.length) {
      return { ok: false, reason: 'Selection splits a feedback loop — include the whole loop or none of it.' };
    }
  }

  const entry = findEntryCandidates(doc, flowId, ids);
  if (entry.length === 0) {
    return { ok: false, reason: 'Selection has no way in — nothing outside it points at any selected node.' };
  }
  if (entry.length > 1) {
    return { ok: false, reason: 'Selection has more than one entry point.' };
  }

  return { ok: true };
}

export interface GroupResult {
  doc: WorkflowDoc;
  newFlowNodeId: string;
  newChildFlowId: string;
}

/**
 * Precondition: `canGroupNodes(doc, flowId, nodeIds).ok` — callers must validate first.
 * `nodeIds` may include `start`/`end` terminals (from the raw on-canvas selection); only the
 * `groupableNodeIds` subset is actually moved — see that function for why.
 */
export function buildGroupedFlow(
  doc: WorkflowDoc,
  flowId: string,
  nodeIds: string[],
  position: { x: number; y: number },
): GroupResult {
  const ids = groupableNodeIds(doc, [...new Set(nodeIds)]);
  const selectedSet = new Set(ids);
  const selectedNodes = doc.nodes.filter((n) => selectedSet.has(n.id));

  const newChildFlowId = `flow-${uid()}`;
  const newFlowNodeId = `fnode-${uid()}`;
  const startNodeId = `start-${uid()}`;

  const childFlow: Flow = { id: newChildFlowId, name: 'New Flow', description: '', parentFlowId: flowId };
  const newFlowNode: DocNode = {
    id: newFlowNodeId,
    type: 'flow',
    position,
    flowId,
    selected: false,
    data: { type: 'flow', name: 'New Flow', childFlowId: newChildFlowId, description: '' } as FlowRefData,
  };

  const [entryNodeId] = findEntryCandidates(doc, flowId, ids);

  const ys = selectedNodes.map((n) => n.position.y);
  const xs = selectedNodes.map((n) => n.position.x);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const startNode: DocNode = {
    id: startNodeId,
    type: 'start',
    flowId: newChildFlowId,
    selected: false,
    position: { x: minX - 260, y: (minY + maxY) / 2 },
    data: { type: 'start', name: 'Start', description: '' } as TerminalData,
  };
  const startEdge: DocEdge = { id: `e-${uid()}`, source: startNodeId, target: entryNodeId, flowId: newChildFlowId };

  const flowEdges = doc.edges.filter((e) => e.flowId === flowId);
  const internalEdges = flowEdges.filter((e) => selectedSet.has(e.source) && selectedSet.has(e.target));
  const incomingBoundary = flowEdges.filter((e) => !selectedSet.has(e.source) && selectedSet.has(e.target));
  const outgoingBoundary = [...flowEdges.filter((e) => selectedSet.has(e.source) && !selectedSet.has(e.target))].sort(
    (a, b) => a.id.localeCompare(b.id),
  );

  const newEndNodes: DocNode[] = [];
  const newInternalEdges: DocEdge[] = [];
  const rewrittenOriginals = new Map<string, DocEdge>();

  outgoingBoundary.forEach((e, i) => {
    const endNodeId = `end-${uid()}`;
    const targetNode = doc.nodes.find((n) => n.id === e.target);
    const edgeLabel = typeof e.label === 'string' ? e.label : undefined;
    const name = e.data?.exit || edgeLabel || targetNode?.data.name || `Exit ${i + 1}`;

    newEndNodes.push({
      id: endNodeId,
      type: 'end',
      flowId: newChildFlowId,
      selected: false,
      position: { x: maxX + 260, y: minY + i * 140 },
      data: { type: 'end', name, description: '' } as TerminalData,
    });

    newInternalEdges.push({
      id: `e-${uid()}`,
      source: e.source,
      sourceHandle: e.sourceHandle,
      target: endNodeId,
      flowId: newChildFlowId,
      label: e.label,
      data: { branch: e.data?.branch },
    });

    rewrittenOriginals.set(e.id, {
      ...e,
      source: newFlowNodeId,
      sourceHandle: endNodeId,
      label: undefined,
      data: { ...e.data, exit: name, branch: undefined },
    });
  });

  const internalIds = new Set(internalEdges.map((e) => e.id));
  const incomingIds = new Set(incomingBoundary.map((e) => e.id));

  const nodes = doc.nodes.map((n) => (selectedSet.has(n.id) ? { ...n, flowId: newChildFlowId, selected: false } : n));
  nodes.push(newFlowNode, startNode, ...newEndNodes);

  const edges = doc.edges.map((e) => {
    if (internalIds.has(e.id)) return { ...e, flowId: newChildFlowId };
    if (incomingIds.has(e.id)) return { ...e, target: newFlowNodeId, targetHandle: undefined };
    const rewritten = rewrittenOriginals.get(e.id);
    return rewritten ?? e;
  });
  edges.push(startEdge, ...newInternalEdges);

  // Any selected node that is itself a `flow` node has its own child flow's parentFlowId
  // still pointing at the outer flow — repoint it to the new child, or goToFlow()'s
  // breadcrumb walk silently produces a stale chain.
  const movedChildFlowIds = new Set(
    selectedNodes.filter((n) => n.data.type === 'flow').map((n) => (n.data as FlowRefData).childFlowId),
  );
  const flows = [
    ...doc.flows.map((f) => (movedChildFlowIds.has(f.id) ? { ...f, parentFlowId: newChildFlowId } : f)),
    childFlow,
  ];

  return { doc: { ...doc, flows, nodes, edges }, newFlowNodeId, newChildFlowId };
}

export function canUngroupFlow(doc: WorkflowDoc, flowNodeId: string): GroupCheck {
  const node = doc.nodes.find((n) => n.id === flowNodeId);
  if (!node || node.data.type !== 'flow') return { ok: false, reason: 'Select a single sub-flow node to ungroup.' };

  const childFlowId = (node.data as FlowRefData).childFlowId;
  const startNodes = doc.nodes.filter((n) => n.flowId === childFlowId && n.data.type === 'start');
  const startEdges = doc.edges.filter((e) => e.flowId === childFlowId && startNodes.some((s) => s.id === e.source));
  const distinctTargets = new Set(startEdges.map((e) => e.target));

  if (distinctTargets.size > 1) {
    return { ok: false, reason: "This sub-flow has more than one entry path and can't be automatically ungrouped." };
  }

  const hasIncomingParentEdges = doc.edges.some((e) => e.target === flowNodeId);
  if (distinctTargets.size === 0 && hasIncomingParentEdges) {
    return { ok: false, reason: 'This sub-flow has no entry node to reconnect its incoming connections to.' };
  }

  return { ok: true };
}

/** Precondition: `canUngroupFlow(doc, flowNodeId).ok` — callers must validate first. */
export function buildUngroupedFlow(doc: WorkflowDoc, flowNodeId: string): WorkflowDoc {
  const flowNode = doc.nodes.find((n) => n.id === flowNodeId) as DocNode;
  const childFlowId = (flowNode.data as FlowRefData).childFlowId;
  const parentFlowId = flowNode.flowId;

  const startNodes = doc.nodes.filter((n) => n.flowId === childFlowId && n.data.type === 'start');
  const startEdges = doc.edges.filter((e) => e.flowId === childFlowId && startNodes.some((s) => s.id === e.source));
  const entryNodeId = startEdges[0]?.target;

  const exits = getFlowExits(doc, childFlowId);
  const newDirectEdges: DocEdge[] = [];
  const consumedEdgeIds = new Set<string>();

  for (const exit of exits) {
    const incomingToEnd = doc.edges.filter((e) => e.flowId === childFlowId && e.target === exit.id);
    const parentEdgesFromExit = doc.edges.filter((e) => e.source === flowNodeId && e.sourceHandle === exit.id);
    incomingToEnd.forEach((e) => consumedEdgeIds.add(e.id));
    parentEdgesFromExit.forEach((e) => consumedEdgeIds.add(e.id));

    for (const internalEdge of incomingToEnd) {
      for (const parentEdge of parentEdgesFromExit) {
        newDirectEdges.push({
          id: `e-${uid()}`,
          source: internalEdge.source,
          sourceHandle: internalEdge.sourceHandle,
          target: parentEdge.target,
          targetHandle: parentEdge.targetHandle,
          flowId: parentFlowId,
          label: internalEdge.label,
          data: { branch: internalEdge.data?.branch },
        });
      }
    }
  }

  const endNodeIds = new Set(exits.map((e) => e.id));
  const startNodeIds = new Set(startNodes.map((n) => n.id));
  startEdges.forEach((e) => consumedEdgeIds.add(e.id));

  const remaining = doc.nodes.filter(
    (n) => n.flowId === childFlowId && !startNodeIds.has(n.id) && !endNodeIds.has(n.id),
  ) as DocNode[];

  let positioned = remaining;
  if (remaining.length > 0) {
    const xs = remaining.map((n) => n.position.x);
    const ys = remaining.map((n) => n.position.y);
    const centerX = (Math.min(...xs) + Math.max(...xs)) / 2;
    const centerY = (Math.min(...ys) + Math.max(...ys)) / 2;
    const deltaX = flowNode.position.x - centerX;
    const deltaY = flowNode.position.y - centerY;
    positioned = remaining.map((n) => ({
      ...n,
      flowId: parentFlowId,
      selected: false,
      position: { x: n.position.x + deltaX, y: n.position.y + deltaY },
    }));
  }

  // Any moved node that is itself a `flow` node has its own child flow's parentFlowId still
  // pointing at the dissolved child — repoint it to the grandparent flow.
  const movedChildFlowIds = new Set(
    positioned.filter((n) => n.data.type === 'flow').map((n) => (n.data as FlowRefData).childFlowId),
  );
  const flows = doc.flows
    .filter((f) => f.id !== childFlowId)
    .map((f) => (movedChildFlowIds.has(f.id) ? { ...f, parentFlowId } : f));

  const nodes = doc.nodes
    .filter((n) => n.id !== flowNodeId && n.flowId !== childFlowId)
    .concat(positioned);

  // Every remaining outgoing edge from the flow node is one of the `parentEdgesFromExit`
  // edges already gathered above, so it's already in `consumedEdgeIds`; nothing else can
  // source from it. Edges that used to target the flow node are retargeted onto the
  // resolved entry node instead — `canUngroupFlow` guarantees `entryNodeId` is defined
  // whenever such an edge exists.
  const internalRemainingIds = new Set(remaining.map((n) => n.id));
  const edges = doc.edges
    .filter((e) => !consumedEdgeIds.has(e.id))
    .map((e) => {
      if (e.flowId === childFlowId && internalRemainingIds.has(e.source) && internalRemainingIds.has(e.target)) {
        return { ...e, flowId: parentFlowId };
      }
      if (e.target === flowNodeId && entryNodeId) {
        return { ...e, target: entryNodeId, targetHandle: undefined };
      }
      return e;
    })
    .concat(newDirectEdges);

  return { ...doc, flows, nodes, edges };
}
