import type {
  EndStateChange,
  EndStateNode,
  EndStateProposal,
  FlowRefData,
  FrequencyCategory,
  Flow,
  Persona,
  WFEdge,
  WFNode,
  WFNodeData,
  WorkflowDoc,
} from '../types';
import { layoutEndState } from './endStateLayout';

/**
 * The end-state workflow the Plan workspace proposes: validated on the server (where a failure
 * goes back to the model as a tool error to fix), turned into a renderable `WorkflowDoc` in the
 * browser. Pure and relative-imported so `server/plan.ts` can use it, like `canonical.ts`.
 */

/** What validation needs from the original — `graphPayload()` and `WorkflowDoc` both fit. */
export interface OriginalGraph {
  flows: Flow[];
  nodes: { id: string; flowId: string; data: WFNodeData }[];
  personas: Persona[];
  frequencies: FrequencyCategory[];
}

/** The flow no flow node points into. `graphPayload()` doesn't carry `rootFlowId`. */
export function rootFlowIdOf(graph: OriginalGraph): string | undefined {
  const children = new Set(
    graph.nodes
      .filter((n) => n.data.type === 'flow')
      .map((n) => (n.data as FlowRefData).childFlowId),
  );
  return (
    graph.flows.find((f) => !children.has(f.id))?.id ??
    graph.flows.find((f) => f.parentFlowId === null)?.id
  );
}

function stripNulls<T>(value: T): T {
  if (Array.isArray(value)) return value.map(stripNulls) as unknown as T;
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) if (v !== null) out[k] = stripNulls(v);
    return out as T;
  }
  return value;
}

/**
 * The model normally omits optional fields, but may write an explicit null for one; drop those
 * to get the `field?: T` shape. The thread history keeps the raw input — this is only applied
 * where the proposal is read.
 */
export function normalizeProposal(raw: unknown): EndStateProposal {
  return stripNulls(raw) as EndStateProposal;
}

const MAX_ERRORS = 25;

/**
 * Everything that would make the end state unrenderable or misleading. Errors are written for
 * the model — they go back to it verbatim as a tool error to fix.
 */
export function validateEndState(p: EndStateProposal, original: OriginalGraph): string[] {
  if (
    !p ||
    !Array.isArray(p.flows) ||
    !Array.isArray(p.nodes) ||
    !Array.isArray(p.edges) ||
    !Array.isArray(p.removedNodeIds)
  ) {
    return ['The end state needs `flows`, `nodes`, `edges` and `removedNodeIds` arrays.'];
  }

  const errors: string[] = [];
  const err = (msg: string) => errors.length < MAX_ERRORS && errors.push(msg);

  const origNodes = new Map(original.nodes.map((n) => [n.id, n]));
  const personaIds = new Set(original.personas.map((p) => p.id));
  const frequencyIds = new Set(original.frequencies.map((f) => f.id));
  const rootId = rootFlowIdOf(original);

  // Flows
  const flows = new Map<string, (typeof p.flows)[number]>();
  for (const f of p.flows) {
    if (flows.has(f.id)) err(`Flow id "${f.id}" is used more than once.`);
    flows.set(f.id, f);
  }
  if (rootId && !flows.has(rootId)) err(`The root flow "${rootId}" must stay in \`flows\`.`);
  for (const f of p.flows) {
    if (f.id === rootId) {
      if (f.parentFlowId) err(`The root flow "${f.id}" must have parentFlowId null.`);
    } else if (!f.parentFlowId || !flows.has(f.parentFlowId)) {
      err(`Flow "${f.id}" has parentFlowId "${f.parentFlowId}", which is not a flow in the end state.`);
    }
  }

  // Nodes
  const nodes = new Map<string, EndStateNode>();
  for (const n of p.nodes) {
    if (nodes.has(n.id)) err(`Node id "${n.id}" is used more than once.`);
    nodes.set(n.id, n);
  }
  const typeOf = (n: EndStateNode) => origNodes.get(n.id)?.data.type ?? n.type;
  const childOf = (n: EndStateNode) =>
    n.childFlowId ?? (origNodes.get(n.id)?.data as FlowRefData | undefined)?.childFlowId;
  const pointedAt = new Map<string, string>();

  for (const n of p.nodes) {
    const orig = origNodes.get(n.id);
    if (!flows.has(n.flowId)) err(`Node "${n.id}" is on flow "${n.flowId}", which is not in \`flows\`.`);
    if (n.change === 'new') {
      if (orig) err(`Node "${n.id}" is marked new but that id is an original node — mark it modified or unchanged, or give it a new id.`);
      if (!n.name) err(`New node "${n.id}" needs a name.`);
    } else {
      if (!orig) {
        err(`Node "${n.id}" is marked ${n.change} but there is no original node with that id — mark it new.`);
        continue;
      }
      if (n.type !== orig.data.type) err(`Node "${n.id}" was a ${orig.data.type} and can't change type — add a new node instead.`);
      if (n.change === 'unchanged' && n.flowId !== orig.flowId) err(`Node "${n.id}" moved to flow "${n.flowId}" — mark it modified.`);
    }
    if (typeOf(n) === 'flow') {
      const child = childOf(n);
      if (!child || !flows.has(child)) err(`Flow node "${n.id}" must point (childFlowId) at a flow in \`flows\`.`);
      else if (pointedAt.has(child)) err(`Flows can only be referenced once: "${child}" is the child of both "${pointedAt.get(child)}" and "${n.id}".`);
      else {
        pointedAt.set(child, n.id);
        const childFlow = flows.get(child)!;
        if (childFlow.parentFlowId !== n.flowId) err(`Flow "${child}" has parentFlowId "${childFlow.parentFlowId}" but its flow node "${n.id}" is on "${n.flowId}".`);
      }
    }
    for (const r of n.replacesNodeIds ?? []) {
      if (!origNodes.has(r)) err(`Node "${n.id}" replaces "${r}", which is not an original node.`);
    }
    if (n.personaId && !personaIds.has(n.personaId)) err(`Node "${n.id}" has personaId "${n.personaId}", which is not in the personas registry.`);
    if (n.frequencyId && !frequencyIds.has(n.frequencyId)) err(`Node "${n.id}" has frequencyId "${n.frequencyId}", which is not in the frequencies registry.`);
  }
  for (const f of p.flows) {
    if (f.id !== rootId && !pointedAt.has(f.id)) err(`Flow "${f.id}" has no flow node pointing at it.`);
  }

  // Every original node is kept, removed, or went with a dropped flow.
  const removed = new Set(p.removedNodeIds);
  for (const id of removed) {
    if (!origNodes.has(id)) err(`removedNodeIds lists "${id}", which is not an original node.`);
    if (nodes.has(id)) err(`"${id}" is both in nodes and in removedNodeIds.`);
  }
  for (const o of original.nodes) {
    if (!nodes.has(o.id) && !removed.has(o.id) && flows.has(o.flowId)) {
      err(`Original node "${o.id}" (${o.data.name}) is missing — keep it, or list it in removedNodeIds.`);
    }
  }

  // Edges
  const exitsOf = (flowId: string) =>
    p.nodes.filter((n) => n.flowId === flowId && n.type === 'end').map((n) => n.id);
  const entriesOf = (flowId: string) =>
    p.nodes.filter((n) => n.flowId === flowId && n.type === 'start').map((n) => n.id);
  const edgeIds = new Set<string>();
  for (const e of p.edges) {
    if (edgeIds.has(e.id)) err(`Edge id "${e.id}" is used more than once.`);
    edgeIds.add(e.id);
    const s = nodes.get(e.source);
    const t = nodes.get(e.target);
    if (!s || !t) {
      err(`Edge "${e.id}" connects "${e.source}" → "${e.target}", but ${!s ? `"${e.source}"` : `"${e.target}"`} is not a node in the end state.`);
      continue;
    }
    if (s.flowId !== e.flowId || t.flowId !== e.flowId) {
      err(`Edge "${e.id}" is on flow "${e.flowId}" but connects nodes on "${s.flowId}" and "${t.flowId}" — edges never cross canvases.`);
    }
    const sType = typeOf(s);
    if (sType === 'decision') {
      if (e.sourceHandle !== 'yes' && e.sourceHandle !== 'no') err(`Edge "${e.id}" leaves decision "${s.id}" and needs sourceHandle "yes" or "no".`);
    } else if (sType === 'flow') {
      const exits = exitsOf(childOf(s) ?? '');
      if (e.sourceHandle ? !exits.includes(e.sourceHandle) : exits.length > 1) {
        err(`Edge "${e.id}" leaves flow node "${s.id}": sourceHandle must be one of its child flow's end node ids (${exits.join(', ') || 'none'}).`);
      }
    } else if (e.sourceHandle) {
      err(`Edge "${e.id}": sourceHandle only applies to edges leaving decision or flow nodes.`);
    }
    if (typeOf(t) === 'flow') {
      const entries = entriesOf(childOf(t) ?? '');
      if (e.targetHandle ? !entries.includes(e.targetHandle) : entries.length > 1) {
        err(`Edge "${e.id}" enters flow node "${t.id}": targetHandle must be one of its child flow's start node ids (${entries.join(', ') || 'none'}).`);
      }
    } else if (e.targetHandle) {
      err(`Edge "${e.id}": targetHandle only applies to edges entering flow nodes.`);
    }
  }

  return errors;
}

/* ------------------------------------------------------------------ rendering */

/**
 * Stamped onto a node's `data` at render time by `WorkflowViewer` — like the loop decoration
 * on edges, it never reaches a stored document.
 */
export interface NodeDiff {
  kind: 'new' | 'modified' | 'removed' | 'replaced';
  /** The Claude product now doing (part of) the work. */
  product?: string;
}

/** What the details card shows for a node in the end state. */
export interface EndStateDetail {
  change: EndStateChange;
  claudeProduct?: string;
  how?: string;
  implements: string[];
  replaces: string[];
}

export interface EndState {
  proposal: EndStateProposal;
  doc: WorkflowDoc;
  /** Node id → diff badge, for the end-state view. */
  endDiff: Map<string, NodeDiff>;
  /** Original node id → diff badge, for the original in the Compare view. */
  sourceDiff: Map<string, NodeDiff>;
  details: Map<string, EndStateDetail>;
}

function dataFor(n: EndStateNode, orig: WFNodeData | undefined): WFNodeData {
  if (n.change === 'unchanged' && orig) return orig;
  const base = orig ? { ...orig } : null;
  const set = <T extends Record<string, unknown>>(d: T, patch: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(patch)) if (v !== undefined) (d as Record<string, unknown>)[k] = v;
    return d;
  };
  switch (n.type) {
    case 'task':
      return set(base ?? { type: 'task', name: '', description: '' }, {
        name: n.name,
        description: n.description,
        personaId: n.personaId,
        frequencyId: n.frequencyId,
        humanMinutesPerRun: n.humanMinutesPerRun,
        isManual: n.isManual,
        tools: n.tools,
      }) as WFNodeData;
    case 'flow':
      return set(base ?? { type: 'flow', name: '', childFlowId: '' }, {
        name: n.name,
        description: n.description,
        childFlowId: n.childFlowId,
      }) as WFNodeData;
    case 'decision':
      return set(base ?? { type: 'decision', name: '' }, {
        name: n.name,
        description: n.description,
      }) as WFNodeData;
    default:
      return set(base ?? { type: n.type, name: '' }, {
        name: n.name,
        description: n.description,
      }) as WFNodeData;
  }
}

/**
 * The proposal as a `WorkflowDoc` the read-only viewer can render, laid out from `source`'s
 * positions (see `layoutEndState`), plus the diff maps for both sides of the Compare view.
 * `source` is the full analysed doc — `graphPayload()` has no positions.
 */
export function toEndStateDoc(raw: EndStateProposal, source: WorkflowDoc): EndState {
  const proposal = normalizeProposal(raw);
  const origNodes = new Map(source.nodes.map((n) => [n.id, n]));
  const origFlows = new Map(source.flows.map((f) => [f.id, f]));
  const nameOf = (id: string) => origNodes.get(id)?.data.name ?? id;

  const flows: Flow[] = proposal.flows.map((f) => ({
    ...origFlows.get(f.id),
    id: f.id,
    name: f.name,
    description: f.description ?? origFlows.get(f.id)?.description ?? '',
    parentFlowId: f.parentFlowId,
  }));

  const positions = layoutEndState(
    proposal.nodes,
    proposal.edges,
    new Map(source.nodes.map((n) => [n.id, { flowId: n.flowId, position: n.position }])),
  );

  const nodes = proposal.nodes.map(
    (n) =>
      ({
        id: n.id,
        type: n.type,
        flowId: n.flowId,
        position: positions.get(n.id) ?? { x: 0, y: 0 },
        data: dataFor(n, origNodes.get(n.id)?.data),
      }) as WFNode & { flowId: string },
  );

  const edges = proposal.edges.map(
    (e) =>
      ({
        id: e.id,
        flowId: e.flowId,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle ?? null,
        targetHandle: e.targetHandle ?? null,
        label: e.label ?? (e.branch ? (e.branch === 'yes' ? 'Yes' : 'No') : undefined),
        data: {
          ...(e.branch && { branch: e.branch }),
          ...(e.exit && { exit: e.exit }),
          ...(e.entry && { entry: e.entry }),
          ...(e.retryRatePct !== undefined && { retryRatePct: e.retryRatePct }),
        },
      }) as WFEdge & { flowId: string },
  );

  const endDiff = new Map<string, NodeDiff>();
  const sourceDiff = new Map<string, NodeDiff>();
  const details = new Map<string, EndStateDetail>();

  for (const n of proposal.nodes) {
    const product = n.automation?.claudeProduct;
    if (n.change !== 'unchanged' || product) {
      endDiff.set(n.id, { kind: n.change === 'unchanged' ? 'modified' : n.change, product });
    }
    if (n.change === 'modified') sourceDiff.set(n.id, { kind: 'modified', product });
    for (const r of n.replacesNodeIds ?? []) {
      if (r !== n.id) sourceDiff.set(r, { kind: 'replaced' });
    }
    details.set(n.id, {
      change: n.change,
      claudeProduct: product,
      how: n.automation?.how,
      implements: n.automation?.implements ?? [],
      replaces: (n.replacesNodeIds ?? []).map(nameOf),
    });
  }
  const kept = new Set(proposal.nodes.map((n) => n.id));
  for (const o of source.nodes) {
    if (!kept.has(o.id) && !sourceDiff.has(o.id)) sourceDiff.set(o.id, { kind: 'removed' });
  }

  // A sub-flow card whose contents changed reads as changed too, on both sides — otherwise the
  // root canvas of a plan that only rewires a sub-flow looks untouched.
  const changedFlows = new Set<string>();
  const mark = (flowId: string | null | undefined, parentOf: (id: string) => string | null | undefined) => {
    for (let f = flowId; f && !changedFlows.has(f); f = parentOf(f)) changedFlows.add(f);
  };
  const endParent = (id: string) => flows.find((f) => f.id === id)?.parentFlowId;
  const sourceParent = (id: string) => source.flows.find((f) => f.id === id)?.parentFlowId;
  for (const n of nodes) if (endDiff.has(n.id)) mark(n.flowId, endParent);
  for (const o of source.nodes) if (sourceDiff.has(o.id)) mark(o.flowId, sourceParent);
  const flagCards = (list: { id: string; data: WFNodeData }[], diff: Map<string, NodeDiff>) => {
    for (const n of list) {
      if (n.data.type === 'flow' && !diff.has(n.id) && changedFlows.has((n.data as FlowRefData).childFlowId)) {
        diff.set(n.id, { kind: 'modified' });
      }
    }
  };
  flagCards(nodes, endDiff);
  flagCards(source.nodes, sourceDiff);

  return {
    proposal,
    doc: {
      ...source,
      flows,
      nodes,
      edges,
    },
    endDiff,
    sourceDiff,
    details,
  };
}

/** The plan thread's one tool — named here so the server and the browser agree on it. */
export const PROPOSE_TOOL = 'propose_end_state';
