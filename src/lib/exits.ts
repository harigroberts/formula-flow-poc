import type { TerminalData, WorkflowDoc } from '@/types';

/**
 * One named way out of a sub-flow. `id` is the child flow's `end` node id — it doubles as the
 * handle id on the parent's `flow` node, so it survives renames, export/import and sync.
 */
export interface FlowExit {
  id: string;
  label: string;
}

/**
 * Derive a sub-flow's exits from the `end` nodes on its canvas. Exits are never stored on
 * `FlowRefData` — this is the single source of truth, so adding, renaming or deleting an End
 * node inside the child flow immediately changes the parent's exit points.
 *
 * Ordered top-to-bottom by canvas position so the parent's rows mirror the child's layout;
 * the id tie-break keeps the order stable when two End nodes sit at the same height.
 */
export function getFlowExits(doc: WorkflowDoc, childFlowId: string): FlowExit[] {
  return doc.nodes
    .filter((n) => n.flowId === childFlowId && n.data.type === 'end')
    .sort((a, b) => a.position.y - b.position.y || a.id.localeCompare(b.id))
    .map((n) => ({ id: n.id, label: (n.data as TerminalData).name || 'End' }));
}
