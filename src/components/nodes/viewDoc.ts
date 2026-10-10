import { createContext, useContext } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useWorkflowStore } from '@/store/workflowStore';
import type { WorkflowDoc } from '@/types';

/**
 * The doc a node card reads the rest of the workflow from — a persona's role, a sub-flow's
 * exits. Unset on the editable canvas, where that's the live store; set by `WorkflowViewer`,
 * which draws a doc that isn't in the store at all (a plan's end state, or the snapshot an
 * analysis ran on).
 */
export const ViewDocContext = createContext<WorkflowDoc | null>(null);

/** True inside a read-only `WorkflowViewer`. */
export const useInViewer = () => useContext(ViewDocContext) !== null;

/**
 * Select from the viewer's doc when inside one, else from the live store. The store side goes
 * through `useShallow`, so a selector returning a flat array keeps its snapshot stable; inside a
 * viewer it returns a constant, so the store never wakes a node it isn't drawing.
 */
export function useDocSelector<T>(selector: (doc: WorkflowDoc) => T): T {
  const viewDoc = useContext(ViewDocContext);
  const fromStore = useWorkflowStore(useShallow((s) => (viewDoc ? null : selector(s.doc))));
  return viewDoc ? selector(viewDoc) : (fromStore as T);
}
