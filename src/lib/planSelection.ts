import { canonical } from '@/lib/canonical';
import type { ChatContext, SelectionState, WorkflowDoc } from '@/types';

/**
 * The recommendations tree in the Plan workspace: every result of the three analysis levels as
 * a leaf the user can tick ("build this") and annotate. Built from the frozen analysis a plan
 * session is about, never the live canvas.
 *
 * Leaf ids are what the model sees and quotes back in `automation.implements`:
 * `task:<nodeId>` (`#2`, `#3`… for a node's further findings), `subflow:<flowId>`, and
 * `strategic:<index>` into `strategic.initiatives`.
 */

export type LeafLevel = 'task' | 'subflow' | 'strategic';

export interface SelectionLeaf {
  kind: 'leaf';
  id: string;
  level: LeafLevel;
  label: string;
  detail: string;
  product?: string;
  confidence?: 'high' | 'medium' | 'low';
  /** Minutes/month — incremental for levels 2 and 3, so the figures don't double count. */
  monthlySaved?: number;
  /** A "no gain" verdict: shown for context, not selectable. */
  disabled?: boolean;
  /** Leaves whose recommendation takes over this one, when the user ticks them too. */
  supersededBy: string[];
}

export interface SelectionGroup {
  kind: 'group';
  id: string;
  label: string;
  children: SelectionItem[];
  /** Shown when the level has nothing to select, and why. */
  note?: string;
}

export type SelectionItem = SelectionGroup | SelectionLeaf;

type Analysis = ChatContext['analysis'];

const LEVEL: Record<Analysis['depth'], number> = { tasks: 1, subflows: 2, strategic: 3 };
const NOT_RUN = 'Not part of this analysis run.';

export function buildSelectionTree(doc: WorkflowDoc, analysis: Analysis): SelectionGroup[] {
  const depth = LEVEL[analysis.depth];
  const subFlows = analysis.subFlows;
  const strategic = analysis.strategic;
  const initiatives = strategic?.improvesOnLowerLevels ? strategic.initiatives : [];

  const initiativesOver = (pick: (s: NonNullable<(typeof initiatives)[number]['supersedes']>) => string[] | undefined, id: string) =>
    initiatives.flatMap((init, i) => (init.supersedes && pick(init.supersedes)?.includes(id) ? [`strategic:${i}`] : []));

  // Level 1 — grouped by the flow the node sits on, in document order.
  const findings = analysis.tasks?.findings ?? [];
  const seen = new Map<string, number>();
  const byFlow = new Map<string, SelectionLeaf[]>();
  for (const f of findings) {
    const n = (seen.get(f.nodeId) ?? 0) + 1;
    seen.set(f.nodeId, n);
    const flowId = doc.nodes.find((node) => node.id === f.nodeId)?.flowId ?? '';
    const leaf: SelectionLeaf = {
      kind: 'leaf',
      id: n === 1 ? `task:${f.nodeId}` : `task:${f.nodeId}#${n}`,
      level: 'task',
      label: f.nodeName,
      detail: f.recommendation,
      product: f.claudeProduct,
      confidence: f.confidence,
      // Level 1 is prompt-instructed JSON, so a missing figure can arrive as an explicit null.
      monthlySaved: f.estMonthlyTimeSaved ?? undefined,
      supersededBy: [
        ...subFlows
          .filter((s) => s.improvesOnTaskLevel && s.supersedesNodeIds?.includes(f.nodeId))
          .map((s) => `subflow:${s.flowId}`),
        ...initiativesOver((s) => s.nodeIds, f.nodeId),
      ],
    };
    byFlow.set(flowId, [...(byFlow.get(flowId) ?? []), leaf]);
  }
  const flowGroups: SelectionGroup[] = [...byFlow.entries()]
    .sort(([a], [b]) => doc.flows.findIndex((f) => f.id === a) - doc.flows.findIndex((f) => f.id === b))
    .map(([flowId, leaves]) => ({
      kind: 'group',
      id: `tasks:${flowId}`,
      label: doc.flows.find((f) => f.id === flowId)?.name ?? 'Other',
      children: leaves,
    }));
  const tasks: SelectionGroup = {
    kind: 'group',
    id: 'tasks',
    label: 'Tasks',
    // One flow needs no extra level of nesting.
    children: flowGroups.length === 1 ? flowGroups[0].children : flowGroups,
    note: findings.length === 0 ? 'No task-level findings.' : undefined,
  };

  // Level 2
  const subflows: SelectionGroup = {
    kind: 'group',
    id: 'subflows',
    label: 'Sub-flows',
    children:
      depth < 2
        ? []
        : subFlows.map((s) => ({
            kind: 'leaf',
            id: `subflow:${s.flowId}`,
            level: 'subflow',
            label: s.flowName,
            detail: s.improvesOnTaskLevel ? (s.recommendation ?? s.verdict) : s.verdict,
            product: s.claudeProduct,
            confidence: s.confidence,
            monthlySaved: s.incrementalMonthlyTimeSaved ?? s.estMonthlyTimeSaved ?? undefined,
            disabled: !s.improvesOnTaskLevel,
            supersededBy: initiativesOver((sup) => sup.flowIds, s.flowId),
          })),
    note:
      depth < 2 ? NOT_RUN : subFlows.length === 0 ? 'No sub-flows large enough to review.' : undefined,
  };

  // Level 3
  const strategy: SelectionGroup = {
    kind: 'group',
    id: 'strategic',
    label: 'Strategy',
    children: initiatives.map((init, i) => ({
      kind: 'leaf',
      id: `strategic:${i}`,
      level: 'strategic',
      label: `${i + 1}. ${init.title}`,
      detail: init.recommendation,
      product: init.claudeProduct,
      confidence: init.confidence,
      monthlySaved: init.incrementalMonthlyTimeSaved ?? init.estMonthlyTimeSaved ?? undefined,
      supersededBy: [],
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

  return [tasks, subflows, strategy];
}

/** Every leaf under an item, selectable or not. */
export function allLeaves(item: SelectionItem | SelectionItem[]): SelectionLeaf[] {
  if (Array.isArray(item)) return item.flatMap(allLeaves);
  return item.kind === 'leaf' ? [item] : item.children.flatMap(allLeaves);
}

/** The leaves a group checkbox toggles. */
export const selectableLeaves = (item: SelectionItem) => allLeaves(item).filter((l) => !l.disabled);

export function checkState(item: SelectionItem, state: SelectionState): 'all' | 'some' | 'none' {
  const leaves = selectableLeaves(item);
  const on = leaves.filter((l) => state[l.id]?.checked).length;
  return on === 0 ? 'none' : on === leaves.length ? 'all' : 'some';
}

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

/** The selection as the model reads it: only leaves that are ticked or carry notes. */
export function selectionPayload(tree: SelectionGroup[], state: SelectionState): SelectionPayload {
  const payload: SelectionPayload = { tasks: [], subFlows: [], strategic: [] };
  const key = { task: 'tasks', subflow: 'subFlows', strategic: 'strategic' } as const;
  for (const leaf of allLeaves(tree)) {
    const s = state[leaf.id];
    const notes = s?.notes.trim();
    if (leaf.disabled || !s || (!s.checked && !notes)) continue;
    payload[key[leaf.level]].push({
      leaf: leaf.id,
      name: leaf.label,
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
