import type { TerminalData, WorkflowDoc } from '@/types';

/**
 * One named way into a sub-flow. `id` is the child flow's `start` node id — it doubles as the
 * target handle id on the parent's `flow` node, so it survives renames, export/import and sync.
 * The exact mirror of `FlowExit` in `lib/exits.ts`.
 */
export interface FlowEntry {
  id: string;
  label: string;
}

/**
 * Derive a sub-flow's entries from the `start` nodes on its canvas. Entries are never stored on
 * `FlowRefData` — this is the single source of truth, so adding, renaming or deleting a Start
 * node inside the child flow immediately changes the parent's entry points.
 *
 * Ordered top-to-bottom by canvas position so the parent's rows mirror the child's layout; the
 * id tie-break keeps the order stable when two Start nodes sit at the same height. That
 * stability is load-bearing for the analysis cache key, not just for the UI — see
 * `parentContext.entries` in `lib/api.ts`.
 */
export function getFlowEntries(doc: WorkflowDoc, childFlowId: string): FlowEntry[] {
  return doc.nodes
    .filter((n) => n.flowId === childFlowId && n.data.type === 'start')
    .sort((a, b) => a.position.y - b.position.y || a.id.localeCompare(b.id))
    .map((n) => ({ id: n.id, label: (n.data as TerminalData).name || 'Start' }));
}
