import { canonical } from '@/lib/canonical';
import type {
  AnalysisFinding,
  ChatContext,
  FlowRefData,
  SelectionState,
  WorkflowDoc,
} from '@/types';

/**
 * The recommendations tree in the Plan workspace, built from the frozen analysis a plan session
 * is about (never the live canvas):
 *
 * - **Strategy** — the level-3 initiatives, in a box of their own.
 * - **Workflow** — the workflow's own shape: each flow's task and decision findings (level 1)
 *   and its sub-flows (carrying their level-2 verdict), nested to any depth, in canvas order.
 *
 * Ticking a row ticks everything under it; a sub-flow counts as ticked only while everything
 * inside it is (`applyCheck`). Ids are what the model sees and quotes back in
 * `automation.implements`: `task:<nodeId>` (`#2`, `#3`… for a node's further findings),
 * `subflow:<flowId>`, and `strategic:<index>` into `strategic.initiatives`.
 */

export interface PlanTreeNode {
  id: string;
  kind: 'workflow' | 'subflow' | 'task' | 'decision' | 'strategy' | 'initiative';
  label: string;
  detail?: string;
  product?: string;
  confidence?: 'high' | 'medium' | 'low';
  /** Minutes/month — incremental for levels 2 and 3, so the figures don't double count. */
  monthlySaved?: number;
  /** A sub-flow whose level-2 verdict was "no gain over task-by-task". */
  noGain?: boolean;
  /** False only for the two group rows (the workflow and the Strategy box): no entry of their own. */
  selectable: boolean;
  /** Initiatives whose recommendation takes over this one. */
  coveredBy: string[];
  children: PlanTreeNode[];
  /** Shown when there's nothing to select, and why. */
  note?: string;
}

export interface PlanTree {
  strategy: PlanTreeNode;
  workflow: PlanTreeNode;
}

type Analysis = ChatContext['analysis'];

const LEVEL: Record<Analysis['depth'], number> = { tasks: 1, subflows: 2, strategic: 3 };
const NOT_RUN = 'Not part of this analysis run.';

export function buildPlanTree(doc: WorkflowDoc, analysis: Analysis): PlanTree {
  const depth = LEVEL[analysis.depth];
  const strategic = analysis.strategic;
  const initiatives = strategic?.improvesOnLowerLevels ? strategic.initiatives : [];
  const subFlows = new Map(analysis.subFlows.map((s) => [s.flowId, s]));

  const coveredBy = (pick: 'nodeIds' | 'flowIds', id: string) =>
    initiatives.flatMap((init, i) => (init.supersedes?.[pick]?.includes(id) ? [`strategic:${i}`] : []));

  const findings = new Map<string, AnalysisFinding[]>();
  for (const f of analysis.tasks?.findings ?? []) findings.set(f.nodeId, [...(findings.get(f.nodeId) ?? []), f]);
  const placed = new Set<string>();

  const findingRows = (nodeId: string, kind: 'task' | 'decision'): PlanTreeNode[] => {
    placed.add(nodeId);
    return (findings.get(nodeId) ?? []).map((f, i) => ({
      id: i === 0 ? `task:${nodeId}` : `task:${nodeId}#${i + 1}`,
      kind,
      label: f.nodeName,
      detail: f.recommendation,
      product: f.claudeProduct,
      confidence: f.confidence,
      // Level 1 is prompt-instructed JSON, so a missing figure can arrive as an explicit null.
      monthlySaved: f.estMonthlyTimeSaved ?? undefined,
      selectable: true,
      coveredBy: coveredBy('nodeIds', nodeId),
      children: [],
    }));
  };

  /** A flow's rows in canvas order — left to right, then top to bottom — as the diagram reads. */
  const rowsOf = (flowId: string, seen: Set<string>): PlanTreeNode[] => {
    if (seen.has(flowId)) return []; // a malformed parent cycle
    seen.add(flowId);
    const nodes = doc.nodes
      .filter((n) => n.flowId === flowId)
      .sort((a, b) => a.position.x - b.position.x || a.position.y - b.position.y);
    return nodes.flatMap((n): PlanTreeNode[] => {
      if (n.data.type === 'task' || n.data.type === 'decision') return findingRows(n.id, n.data.type);
      if (n.data.type !== 'flow') return [];
      const childFlowId = (n.data as FlowRefData).childFlowId;
      const children = [...findingRows(n.id, 'task'), ...rowsOf(childFlowId, seen)];
      const a = subFlows.get(childFlowId);
      // Nothing to tick inside and no verdict of its own: leave it out.
      if (children.length === 0 && !a) return [];
      return [
        {
          id: `subflow:${childFlowId}`,
          kind: 'subflow',
          label: n.data.name || doc.flows.find((f) => f.id === childFlowId)?.name || 'Sub-flow',
          detail: a ? (a.improvesOnTaskLevel ? (a.recommendation ?? a.verdict) : a.verdict) : undefined,
          product: a?.improvesOnTaskLevel ? a.claudeProduct : undefined,
          confidence: a?.improvesOnTaskLevel ? a.confidence : undefined,
          monthlySaved: a?.improvesOnTaskLevel
            ? (a.incrementalMonthlyTimeSaved ?? a.estMonthlyTimeSaved ?? undefined)
            : undefined,
          noGain: a ? !a.improvesOnTaskLevel : undefined,
          selectable: true,
          coveredBy: coveredBy('flowIds', childFlowId),
          children,
        },
      ];
    });
  };

  const rows = rowsOf(doc.rootFlowId, new Set());
  // Findings for nodes not on the canvas any more still deserve a row.
  const strays = [...findings.keys()].filter((id) => !placed.has(id)).flatMap((id) => findingRows(id, 'task'));

  const workflow: PlanTreeNode = {
    id: 'workflow',
    kind: 'workflow',
    label: doc.flows.find((f) => f.id === doc.rootFlowId)?.name ?? 'Workflow',
    selectable: false,
    coveredBy: [],
    children: [...rows, ...strays],
    note: rows.length + strays.length === 0 ? 'No task-level findings.' : undefined,
  };

  const strategy: PlanTreeNode = {
    id: 'strategy',
    kind: 'strategy',
    label: 'Strategy',
    selectable: false,
    coveredBy: [],
    children: initiatives.map((init, i) => ({
      id: `strategic:${i}`,
      kind: 'initiative',
      label: `${i + 1}. ${init.title}`,
      detail: init.recommendation,
      product: init.claudeProduct,
      confidence: init.confidence,
      monthlySaved: init.incrementalMonthlyTimeSaved ?? init.estMonthlyTimeSaved ?? undefined,
      selectable: true,
      coveredBy: [],
      children: [],
    })),
    note:
      depth < 3
        ? NOT_RUN
        : !strategic
          ? 'No strategic analysis available.'
          : !strategic.improvesOnLowerLevels
            ? `No gain over the lower levels — ${strategic.verdict}`
            : undefined,
  };

  return { strategy, workflow };
}

/* ------------------------------------------------------------ walking */

const roots = (tree: PlanTree) => [tree.strategy, tree.workflow];

/** A node's selectable descendants, depth-first. */
function descendants(node: PlanTreeNode): PlanTreeNode[] {
  return node.children.flatMap((c) => [...(c.selectable ? [c] : []), ...descendants(c)]);
}

/** Every selectable node in the tree, depth-first. */
export function allNodes(tree: PlanTree): PlanTreeNode[] {
  return roots(tree).flatMap(descendants);
}

/** How many selectable nodes sit under (and including) this one, and how many are ticked. */
export function tally(node: PlanTreeNode, state: SelectionState): { on: number; total: number } {
  const nodes = [...(node.selectable ? [node] : []), ...descendants(node)];
  return { on: nodes.filter((n) => state[n.id]?.checked).length, total: nodes.length };
}

export function checkState(node: PlanTreeNode, state: SelectionState): 'all' | 'some' | 'none' {
  const { on, total } = tally(node, state);
  return on === 0 ? 'none' : on === total ? 'all' : 'some';
}

/**
 * Ticks or clears a row and everything under it, then re-derives every sub-flow above it as
 * "ticked only while everything inside it is" — the usual tri-state tree. A sub-flow with
 * nothing selectable inside keeps its own state.
 */
export function applyCheck(
  tree: PlanTree,
  state: SelectionState,
  id: string,
  checked: boolean,
): SelectionState {
  const parent = new Map<string, PlanTreeNode>();
  const byId = new Map<string, PlanTreeNode>();
  const index = (node: PlanTreeNode) => {
    byId.set(node.id, node);
    for (const c of node.children) {
      parent.set(c.id, node);
      index(c);
    }
  };
  roots(tree).forEach(index);

  const target = byId.get(id);
  if (!target) return state;

  const next = { ...state };
  const set = (n: PlanTreeNode, on: boolean) => {
    if (n.selectable) next[n.id] = { notes: next[n.id]?.notes ?? '', checked: on };
  };
  set(target, checked);
  for (const d of descendants(target)) set(d, checked);

  for (let p = parent.get(id); p; p = parent.get(p.id)) {
    const inside = descendants(p);
    if (p.selectable && inside.length) set(p, inside.every((d) => next[d.id]?.checked));
  }
  return next;
}

/* ------------------------------------------------------------ payload */

interface PayloadItem {
  leaf: string;
  name: string;
  selected: boolean;
  notes?: string;
}

export interface SelectionPayload {
  tasks: PayloadItem[];
  subFlows: PayloadItem[];
  strategic: PayloadItem[];
}

const BUCKET = {
  task: 'tasks',
  decision: 'tasks',
  subflow: 'subFlows',
  initiative: 'strategic',
} as const;

/**
 * The selection as the model reads it: only rows that are ticked or carry notes. A sub-flow is
 * `selected` only when it's ticked in full; a partial one shows through its ticked tasks.
 */
export function selectionPayload(tree: PlanTree | null, state: SelectionState): SelectionPayload {
  const payload: SelectionPayload = { tasks: [], subFlows: [], strategic: [] };
  if (!tree) return payload;
  for (const node of allNodes(tree)) {
    const s = state[node.id];
    const notes = s?.notes.trim();
    if (!s || (!s.checked && !notes) || !(node.kind in BUCKET)) continue;
    payload[BUCKET[node.kind as keyof typeof BUCKET]].push({
      leaf: node.id,
      name: node.label,
      selected: s.checked,
      ...(notes && { notes }),
    });
  }
  return payload;
}

/** The prefix the prompt tells the model to look for. */
export const SELECTION_PREFIX = 'Selection from the recommendations tree';

/** The text block that opens a user turn whenever the selection has changed. */
export function selectionBlock(payload: SelectionPayload): string {
  return (
    `${SELECTION_PREFIX} (it replaces any earlier selection; anything not listed is out of scope):\n` +
    JSON.stringify(canonical(payload))
  );
}

export function selectionCounts(payload: SelectionPayload): { selected: number; notes: number } {
  const items = [...payload.tasks, ...payload.subFlows, ...payload.strategic];
  return {
    selected: items.filter((i) => i.selected).length,
    notes: items.filter((i) => i.notes).length,
  };
}
