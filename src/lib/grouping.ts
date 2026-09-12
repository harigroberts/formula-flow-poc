import type { WorkflowDoc, WFNode, WFEdge, Flow, FlowRefData, TerminalData } from '@/types';
import { findLoops } from './cycles';
import { getFlowEntries } from './entries';
import { getFlowExits } from './exits';

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

export type GroupCheck = { ok: true } | { ok: false; reason: string };

type DocNode = WFNode & { flowId: string };
type DocEdge = WFEdge & { flowId: string };

/**
 * Nodes in `nodeIds` that either receive an edge from outside the selection, or receive no
 * incoming edge at all (a root of the induced subgraph). Each one becomes a way into the new
 * child flow: it gets a `start` node connected to it, and the parent's incoming boundary edges
 * are redirected onto the matching entry handle of the new flow node.
 *
 * A group needs at least one. Several are fine — see `buildGroupedFlow` for how they collapse to
 * a single entry when every incoming edge comes from the same place.
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

  const childFlow: Flow = { id: newChildFlowId, name: 'New Flow', description: '', parentFlowId: flowId };
  const newFlowNode: DocNode = {
    id: newFlowNodeId,
    type: 'flow',
    position,
    flowId,
    selected: false,
    data: { type: 'flow', name: 'New Flow', childFlowId: newChildFlowId, description: '' } as FlowRefData,
  };

  const ys = selectedNodes.map((n) => n.position.y);
  const xs = selectedNodes.map((n) => n.position.x);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const byId = (a: DocEdge, b: DocEdge) => a.id.localeCompare(b.id);
  const flowEdges = doc.edges.filter((e) => e.flowId === flowId);
  const internalEdges = flowEdges.filter((e) => selectedSet.has(e.source) && selectedSet.has(e.target));
  const incomingBoundary = [
    ...flowEdges.filter((e) => !selectedSet.has(e.source) && selectedSet.has(e.target)),
  ].sort(byId);
  const outgoingBoundary = [...flowEdges.filter((e) => selectedSet.has(e.source) && !selectedSet.has(e.target))].sort(
    byId,
  );

  // ── Entries ────────────────────────────────────────────────────────────────────────────────
  // Each way into the selection gets a `start` node, and each `start` node is one named entry on
  // the new flow card (the mirror of `end` nodes becoming named exits — see `getFlowEntries`).
  // A way in is a (node, handle) pair, not just a node: an entry candidate that is itself a
  // sub-flow can be entered at two of *its* entries, and those stay distinct.
  //
  // The exception is when everything outside the selection points in from the *same* place —
  // same source node and same handle. Then the fan-out is the group's own internal business, so
  // it needs one way in, not several: a single `start` fans out to every slot inside, and the
  // duplicate parent edges collapse into one. Same origin means identical label/branch/exit, so
  // collapsing them loses nothing; keeping the lowest id keeps it deterministic.
  const entryNodeIds = findEntryCandidates(doc, flowId, ids);
  const origins = new Set(incomingBoundary.map((e) => `${e.source}|${e.sourceHandle ?? ''}`));
  const singleEntry = origins.size <= 1;

  type EntrySlot = { target: string; targetHandle?: string; edges: DocEdge[] };
  const slots: EntrySlot[] = [];
  for (const target of entryNodeIds) {
    const incoming = incomingBoundary.filter((e) => e.target === target);
    if (incoming.length === 0) {
      // A root of the selection nothing points at — still needs a way in.
      slots.push({ target, edges: [] });
      continue;
    }
    const byHandle = new Map<string, DocEdge[]>();
    for (const e of incoming) {
      const key = e.targetHandle ?? '';
      const bucket = byHandle.get(key);
      if (bucket) bucket.push(e);
      else byHandle.set(key, [e]);
    }
    for (const [handle, edges] of byHandle) slots.push({ target, targetHandle: handle || undefined, edges });
  }

  const newStartNodes: DocNode[] = [];
  const newStartEdges: DocEdge[] = [];
  const startForEdge = new Map<string, string>();
  const droppedEdgeIds = new Set<string>();

  const makeStart = (name: string, y: number): string => {
    const startNodeId = `start-${uid()}`;
    newStartNodes.push({
      id: startNodeId,
      type: 'start',
      flowId: newChildFlowId,
      selected: false,
      position: { x: minX - 260, y },
      data: { type: 'start', name, description: '' } as TerminalData,
    });
    return startNodeId;
  };

  // The start edge inherits the target binding of the parent edge it replaces, so a slot on a
  // nested sub-flow still enters at the right one of *its* entries.
  const linkStart = (startNodeId: string, slot: EntrySlot) => {
    newStartEdges.push({
      id: `e-${uid()}`,
      source: startNodeId,
      target: slot.target,
      targetHandle: slot.targetHandle,
      flowId: newChildFlowId,
      data: { entry: slot.edges[0]?.data?.entry },
    });
    slot.edges.forEach((e) => startForEdge.set(e.id, startNodeId));
  };

  if (singleEntry) {
    const startNodeId = makeStart('Start', (minY + maxY) / 2);
    slots.forEach((slot) => linkStart(startNodeId, slot));
    incomingBoundary.slice(1).forEach((e) => droppedEdgeIds.add(e.id));
  } else {
    slots.forEach((slot, i) => {
      // Named after how it's reached, mirroring the exit naming below. The label belongs to the
      // *parent's* decision here, so unlike an exit the parent edge keeps its own label too.
      const firstIn = slot.edges[0];
      const sourceNode = firstIn ? doc.nodes.find((n) => n.id === firstIn.source) : undefined;
      const edgeLabel = typeof firstIn?.label === 'string' ? firstIn.label : undefined;
      const name = edgeLabel || sourceNode?.data.name || `Entry ${i + 1}`;
      linkStart(makeStart(name, minY + i * 140), slot);
    });
  }

  const startNameById = new Map(newStartNodes.map((n) => [n.id, (n.data as TerminalData).name]));

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
      // `exit` rides along with `sourceHandle`: when the grouped node is itself a sub-flow, this
      // edge still leaves a flow node and still names which of *its* exits it leaves from.
      // `entry` is deliberately not carried — the target is an `end` node now.
      data: { branch: e.data?.branch, exit: e.data?.exit },
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
  nodes.push(newFlowNode, ...newStartNodes, ...newEndNodes);

  const edges = doc.edges.flatMap((e) => {
    if (droppedEdgeIds.has(e.id)) return [];
    if (internalIds.has(e.id)) return [{ ...e, flowId: newChildFlowId }];
    if (incomingIds.has(e.id)) {
      const startId = startForEdge.get(e.id);
      return [
        {
          ...e,
          target: newFlowNodeId,
          targetHandle: startId,
          data: { ...e.data, entry: startId ? startNameById.get(startId) : undefined },
        },
      ];
    }
    const rewritten = rewrittenOriginals.get(e.id);
    return [rewritten ?? e];
  });
  edges.push(...newStartEdges, ...newInternalEdges);

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
  const entries = getFlowEntries(doc, childFlowId);

  const hasIncomingParentEdges = doc.edges.some((e) => e.target === flowNodeId);
  if (entries.length === 0 && hasIncomingParentEdges) {
    return { ok: false, reason: 'This sub-flow has no entry node to reconnect its incoming connections to.' };
  }

  return { ok: true };
}

/** Precondition: `canUngroupFlow(doc, flowNodeId).ok` — callers must validate first. */
export function buildUngroupedFlow(doc: WorkflowDoc, flowNodeId: string): WorkflowDoc {
  const flowNode = doc.nodes.find((n) => n.id === flowNodeId) as DocNode;
  const childFlowId = (flowNode.data as FlowRefData).childFlowId;
  const parentFlowId = flowNode.flowId;

  const entries = getFlowEntries(doc, childFlowId);
  const exits = getFlowExits(doc, childFlowId);
  const newDirectEdges: DocEdge[] = [];
  const consumedEdgeIds = new Set<string>();

  // Entries, then exits: each side reconnects what the flow node stood between. The two are
  // exact mirrors — for an entry the source metadata comes from the parent edge and the target
  // metadata from the edge leaving the `start` node inside; for an exit it's the other way
  // round. `exit`/`entry` are carried through on both, because either end may itself be a
  // nested `flow` node whose named exit or entry has to survive the dissolve.
  const entryIds = new Set(entries.map((en) => en.id));
  const parentIncoming = doc.edges.filter((e) => e.target === flowNodeId);

  entries.forEach((entry, i) => {
    const internalFromStart = doc.edges.filter((e) => e.flowId === childFlowId && e.source === entry.id);
    // An edge with no resolvable `targetHandle` predates named entries or was hand-edited; bind
    // it to the first entry, the same fallback `normalizeDoc` uses on the exit side.
    const parentEdgesToEntry = parentIncoming.filter(
      (e) => e.targetHandle === entry.id || (i === 0 && (!e.targetHandle || !entryIds.has(e.targetHandle))),
    );
    internalFromStart.forEach((e) => consumedEdgeIds.add(e.id));
    parentEdgesToEntry.forEach((e) => consumedEdgeIds.add(e.id));

    for (const parentEdge of parentEdgesToEntry) {
      for (const internalEdge of internalFromStart) {
        newDirectEdges.push({
          id: `e-${uid()}`,
          source: parentEdge.source,
          sourceHandle: parentEdge.sourceHandle,
          target: internalEdge.target,
          targetHandle: internalEdge.targetHandle,
          flowId: parentFlowId,
          label: parentEdge.label,
          data: {
            branch: parentEdge.data?.branch,
            exit: parentEdge.data?.exit,
            entry: internalEdge.data?.entry,
          },
        });
      }
    }
  });

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
          data: {
            branch: internalEdge.data?.branch,
            exit: internalEdge.data?.exit,
            entry: parentEdge.data?.entry,
          },
        });
      }
    }
  }

  const endNodeIds = new Set(exits.map((e) => e.id));

  const remaining = doc.nodes.filter(
    (n) => n.flowId === childFlowId && !entryIds.has(n.id) && !endNodeIds.has(n.id),
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

  // The two loops above consumed every edge that touched the flow node or one of the child's
  // terminals, replacing them with direct connections. What's left on the dissolved canvas is
  // either an ordinary internal edge — which moves up to the parent — or one still pointing at a
  // node that has just gone away, which is dropped rather than left dangling.
  const internalRemainingIds = new Set(remaining.map((n) => n.id));
  const edges = doc.edges
    .filter((e) => !consumedEdgeIds.has(e.id))
    .filter((e) => {
      if (e.source === flowNodeId || e.target === flowNodeId) return false;
      if (e.flowId !== childFlowId) return true;
      return internalRemainingIds.has(e.source) && internalRemainingIds.has(e.target);
    })
    .map((e) => (e.flowId === childFlowId ? { ...e, flowId: parentFlowId } : e))
    .concat(newDirectEdges);

  return { ...doc, flows, nodes, edges };
}
