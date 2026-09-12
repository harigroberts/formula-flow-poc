import { create } from 'zustand';
import { applyNodeChanges, applyEdgeChanges, addEdge } from '@xyflow/react';
import type { NodeChange, EdgeChange, Connection } from '@xyflow/react';
import type { WFNode, WFEdge, WFEdgeData, Flow, WorkflowDoc, WFNodeData, TaskData, FlowRefData, DecisionData, TerminalData, FrequencyCategory, Persona, Department } from '@/types';
import { seedDoc } from '@/lib/seed';
import { normalizeDoc } from '@/lib/persistence';
import { canGroupNodes, buildGroupedFlow, canUngroupFlow, buildUngroupedFlow, groupableNodeIds } from '@/lib/grouping';
import { collectFlowIds } from '@/lib/api';

interface BreadcrumbEntry {
  flowId: string;
  name: string;
}

interface WorkflowState {
  doc: WorkflowDoc;
  currentFlowId: string;
  breadcrumbs: BreadcrumbEntry[];
  selectedNodeId: string | null;
  selectedEdgeId: string | null;

  // react-flow handlers
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;

  // selectors
  currentNodes: () => (WFNode & { flowId: string })[];
  currentEdges: () => (WFEdge & { flowId: string })[];
  currentFlow: () => Flow | undefined;
  selectedNode: () => (WFNode & { flowId: string }) | undefined;
  selectedEdge: () => (WFEdge & { flowId: string }) | undefined;
  frequencies: () => FrequencyCategory[];
  personas: () => Persona[];
  departments: () => Department[];

  // navigation
  enterFlow: (childFlowId: string) => void;
  goToBreadcrumb: (flowId: string) => void;
  goToFlow: (flowId: string) => void;

  // CRUD
  addTask: (position: { x: number; y: number }) => void;
  addFlow: (position: { x: number; y: number }) => void;
  addDecision: (position: { x: number; y: number }) => void;
  addStart: (position: { x: number; y: number }) => void;
  addEnd: (position: { x: number; y: number }) => void;
  groupNodesIntoFlow: (nodeIds: string[]) => void;
  updateNodeData: (nodeId: string, data: Partial<WFNodeData>) => void;
  deleteNode: (nodeId: string) => void;
  ungroupFlow: (flowNodeId: string) => void;
  setSelectedNode: (nodeId: string | null) => void;
  updateEdgeData: (edgeId: string, data: Partial<WFEdgeData>) => void;
  deleteEdge: (edgeId: string) => void;
  setSelectedEdge: (edgeId: string | null) => void;

  // org-wide assumptions
  addFrequency: () => string;
  updateFrequency: (id: string, patch: Partial<FrequencyCategory>) => void;
  deleteFrequency: (id: string) => void;
  addPersona: () => string;
  updatePersona: (id: string, patch: Partial<Persona>) => void;
  deletePersona: (id: string) => void;
  addDepartment: () => string;
  updateDepartment: (id: string, patch: Partial<Department>) => void;
  deleteDepartment: (id: string) => void;

  // flow management
  clearCurrentFlow: () => void;
  updateCurrentFlow: (patch: Partial<Flow>) => void;

  // import/export
  loadDoc: (doc: WorkflowDoc) => void;
  getDoc: () => WorkflowDoc;
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * The flows that die with a set of removed nodes: for every removed `flow` node, its child flow
 * and every sub-flow nested inside that, to any depth. Removing only the immediate child (what
 * `deleteNode` used to do) orphans a nested sub-flow's whole subtree in the doc, which nesting
 * makes easy to hit. `collectFlowIds` already does this BFS for the analysis payload, so the
 * descendant walk is reused rather than rewritten here.
 *
 * Takes the doc as it was *before* the deletion — it has to be able to look the removed flow
 * nodes up to find their `childFlowId`.
 */
function doomedFlowIds(doc: WorkflowDoc, removedNodeIds: string[]): Set<string> {
  const removed = new Set(removedNodeIds);
  const doomed = new Set<string>();
  for (const node of doc.nodes) {
    if (!removed.has(node.id) || node.data.type !== 'flow') continue;
    for (const id of collectFlowIds(doc, (node.data as FlowRefData).childFlowId)) doomed.add(id);
  }
  return doomed;
}

/**
 * Drop the removed nodes, everything on a doomed canvas, and every edge left pointing at either.
 * That last part covers the edges another canvas owns: a parent's edge binds to a sub-flow exit
 * by `sourceHandle` (an `end` node id) and to an entry by `targetHandle` (a `start` node id), so
 * nothing on the canvas being edited would otherwise catch them. 'yes'/'no' are the only handle
 * ids that aren't node ids.
 */
function pruneDoc(doc: WorkflowDoc, removedNodeIds: string[], doomed: Set<string>): WorkflowDoc {
  const removed = new Set(removedNodeIds);
  const nodes = doc.nodes.filter(n => !removed.has(n.id) && !doomed.has(n.flowId));
  const alive = new Set(nodes.map(n => n.id));
  const edges = doc.edges.filter(e =>
    alive.has(e.source) &&
    alive.has(e.target) &&
    !doomed.has(e.flowId) &&
    (!e.sourceHandle || e.sourceHandle === 'yes' || e.sourceHandle === 'no' || alive.has(e.sourceHandle)) &&
    (!e.targetHandle || alive.has(e.targetHandle))
  );
  return { ...doc, flows: doc.flows.filter(f => !doomed.has(f.id)), nodes, edges };
}

function removeNodes(doc: WorkflowDoc, nodeIds: string[]): WorkflowDoc {
  return pruneDoc(doc, nodeIds, doomedFlowIds(doc, nodeIds));
}

export const useWorkflowStore = create<WorkflowState>((set, get) => ({
  doc: seedDoc,
  currentFlowId: seedDoc.rootFlowId,
  breadcrumbs: [{ flowId: seedDoc.rootFlowId, name: seedDoc.flows.find(f => f.id === seedDoc.rootFlowId)?.name ?? 'Root' }],
  selectedNodeId: null,
  selectedEdgeId: null,

  onNodesChange: (changes) => {
    set((state) => {
      const currentNodes = state.doc.nodes.filter(n => n.flowId === state.currentFlowId);
      const otherNodes = state.doc.nodes.filter(n => n.flowId !== state.currentFlowId);
      const updated = applyNodeChanges(changes, currentNodes) as (WFNode & { flowId: string })[];
      const nextDoc = { ...state.doc, nodes: [...otherNodes, ...updated] };
      // Keyboard deletion (deleteKeyCode="Delete") comes through here, not deleteNode, so this
      // is the only place to clean up after it: dropping a parent flow node's edge when the
      // exit or entry it binds to is removed, and taking a deleted sub-flow's whole subtree with
      // it. `removeNodes` is given the pre-deletion doc so it can still see what it's removing.
      const removed = changes.filter(c => c.type === 'remove').map(c => c.id);
      if (removed.length === 0) return { doc: nextDoc };
      // `doomedFlowIds` reads the pre-change doc so it can still see the flow nodes being
      // removed; the prune itself runs over the post-change doc so position/selection changes
      // applied in the same batch aren't thrown away.
      return { doc: pruneDoc(nextDoc, removed, doomedFlowIds(state.doc, removed)) };
    });
  },

  onEdgesChange: (changes) => {
    set((state) => {
      const currentEdges = state.doc.edges.filter(e => e.flowId === state.currentFlowId);
      const otherEdges = state.doc.edges.filter(e => e.flowId !== state.currentFlowId);
      const updated = applyEdgeChanges(changes, currentEdges) as (WFEdge & { flowId: string })[];
      return { doc: { ...state.doc, edges: [...otherEdges, ...updated] } };
    });
  },

  onConnect: (connection) => {
    set((state) => {
      const currentEdges = state.doc.edges.filter(e => e.flowId === state.currentFlowId);
      const otherEdges = state.doc.edges.filter(e => e.flowId !== state.currentFlowId);
      const merged = addEdge(connection, currentEdges) as (WFEdge & { flowId: string })[];
      merged.forEach(e => {
        if (!e.flowId) e.flowId = state.currentFlowId;
        // Annotate decision branch edges with label + data.branch for LLM legibility
        if ((e.sourceHandle === 'yes' || e.sourceHandle === 'no') && !e.label) {
          const branch = e.sourceHandle as 'yes' | 'no';
          e.label = branch === 'yes' ? 'Yes' : 'No';
          e.data = { ...e.data, branch };
        } else if (e.sourceHandle) {
          // Sub-flow exit: the handle id is an `end` node inside the child flow. Mirror its name
          // onto data.exit for the same reason — no edge label, the flow card already shows it.
          const source = state.doc.nodes.find(n => n.id === e.source);
          const exitNode = state.doc.nodes.find(n => n.id === e.sourceHandle);
          if (source?.data.type === 'flow' && exitNode?.data.type === 'end') {
            e.data = { ...e.data, exit: (exitNode.data as TerminalData).name };
          }
        }
        // Sub-flow entry: the mirror of the above on the target side — the handle id is a
        // `start` node inside the child flow, and data.entry carries its name.
        if (e.targetHandle) {
          const target = state.doc.nodes.find(n => n.id === e.target);
          const entryNode = state.doc.nodes.find(n => n.id === e.targetHandle);
          if (target?.data.type === 'flow' && entryNode?.data.type === 'start') {
            e.data = { ...e.data, entry: (entryNode.data as TerminalData).name };
          }
        }
      });
      return { doc: { ...state.doc, edges: [...otherEdges, ...merged] } };
    });
  },

  currentNodes: () => get().doc.nodes.filter(n => n.flowId === get().currentFlowId),
  currentEdges: () => get().doc.edges.filter(e => e.flowId === get().currentFlowId),
  currentFlow: () => get().doc.flows.find(f => f.id === get().currentFlowId),
  selectedNode: () => {
    const { selectedNodeId, doc } = get();
    if (!selectedNodeId) return undefined;
    return doc.nodes.find(n => n.id === selectedNodeId);
  },
  selectedEdge: () => {
    const { selectedEdgeId, doc } = get();
    if (!selectedEdgeId) return undefined;
    return doc.edges.find(e => e.id === selectedEdgeId);
  },
  frequencies: () => get().doc.frequencies,
  personas: () => get().doc.personas,
  departments: () => get().doc.departments,

  enterFlow: (childFlowId) => {
    const { doc, breadcrumbs } = get();
    const flow = doc.flows.find(f => f.id === childFlowId);
    if (!flow) return;
    set({
      currentFlowId: childFlowId,
      breadcrumbs: [...breadcrumbs, { flowId: childFlowId, name: flow.name }],
      selectedNodeId: null,
      selectedEdgeId: null,
    });
  },

  goToBreadcrumb: (flowId) => {
    set((state) => {
      const idx = state.breadcrumbs.findIndex(b => b.flowId === flowId);
      if (idx < 0) return {};
      return {
        currentFlowId: flowId,
        breadcrumbs: state.breadcrumbs.slice(0, idx + 1),
        selectedNodeId: null,
        selectedEdgeId: null,
      };
    });
  },

  // Jumps to any flow — including one not on the current breadcrumb path, e.g. a sub-flow
  // reached from the toolbar's loop-issue chip. Walks `parentFlowId` up to the root and
  // rebuilds the breadcrumb trail from scratch; the `seen` guard mirrors `depthOf` in
  // analysisRunner.ts, defensive against a malformed parentFlowId cycle.
  goToFlow: (flowId) => {
    const { doc } = get();
    const chain: BreadcrumbEntry[] = [];
    const seen = new Set<string>();
    let current = doc.flows.find(f => f.id === flowId);
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      chain.unshift({ flowId: current.id, name: current.name });
      current = current.parentFlowId ? doc.flows.find(f => f.id === current!.parentFlowId) : undefined;
    }
    if (chain.length === 0) return;
    set({
      currentFlowId: flowId,
      breadcrumbs: chain,
      selectedNodeId: null,
      selectedEdgeId: null,
    });
  },

  addTask: (position) => {
    const { currentFlowId, doc } = get();
    const newNode: WFNode & { flowId: string } = {
      id: `task-${uid()}`,
      type: 'task',
      position,
      flowId: currentFlowId,
      data: {
        type: 'task',
        name: 'New Task',
        description: '',
        isManual: true,
      } as TaskData,
    };
    set({ doc: { ...doc, nodes: [...doc.nodes, newNode] }, selectedNodeId: newNode.id });
  },

  addFlow: (position) => {
    const { currentFlowId, doc } = get();
    const childFlowId = `flow-${uid()}`;
    const childFlow: Flow = { id: childFlowId, name: 'New Flow', description: '', parentFlowId: currentFlowId };
    const newNode: WFNode & { flowId: string } = {
      id: `fnode-${uid()}`,
      type: 'flow',
      position,
      flowId: currentFlowId,
      data: {
        type: 'flow',
        name: 'New Flow',
        childFlowId,
        description: '',
      } as FlowRefData,
    };
    set({
      doc: {
        ...doc,
        flows: [...doc.flows, childFlow],
        nodes: [...doc.nodes, newNode],
      },
      selectedNodeId: newNode.id,
    });
  },

  addDecision: (position) => {
    const { currentFlowId, doc } = get();
    const newNode: WFNode & { flowId: string } = {
      id: `decision-${uid()}`,
      type: 'decision',
      position,
      flowId: currentFlowId,
      data: {
        type: 'decision',
        name: 'Decision?',
        description: '',
      } as DecisionData,
    };
    set({ doc: { ...doc, nodes: [...doc.nodes, newNode] }, selectedNodeId: newNode.id });
  },

  addStart: (position) => {
    const { currentFlowId, doc } = get();
    const newNode: WFNode & { flowId: string } = {
      id: `start-${uid()}`,
      type: 'start',
      position,
      flowId: currentFlowId,
      data: {
        type: 'start',
        name: 'Start',
        description: '',
      } as TerminalData,
    };
    set({ doc: { ...doc, nodes: [...doc.nodes, newNode] }, selectedNodeId: newNode.id });
  },

  addEnd: (position) => {
    const { currentFlowId, doc } = get();
    const newNode: WFNode & { flowId: string } = {
      id: `end-${uid()}`,
      type: 'end',
      position,
      flowId: currentFlowId,
      data: {
        type: 'end',
        name: 'End',
        description: '',
      } as TerminalData,
    };
    set({ doc: { ...doc, nodes: [...doc.nodes, newNode] }, selectedNodeId: newNode.id });
  },

  groupNodesIntoFlow: (nodeIds) => {
    const { currentFlowId, doc } = get();
    if (!canGroupNodes(doc, currentFlowId, nodeIds).ok) return;
    const groupable = groupableNodeIds(doc, nodeIds);
    const selected = doc.nodes.filter(n => groupable.includes(n.id));
    const xs = selected.map(n => n.position.x);
    const ys = selected.map(n => n.position.y);
    const position = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
    const { doc: nextDoc, newFlowNodeId } = buildGroupedFlow(doc, currentFlowId, nodeIds, position);
    set({ doc: nextDoc, selectedNodeId: newFlowNodeId, selectedEdgeId: null });
  },

  updateNodeData: (nodeId, data) => {
    set((state) => {
      const nodes = state.doc.nodes.map(n => {
        if (n.id !== nodeId) return n;
        return { ...n, data: { ...n.data, ...data } as WFNodeData };
      });
      const updated = nodes.find(n => n.id === nodeId);
      let flows = state.doc.flows;
      let edges = state.doc.edges;
      if (updated && updated.data.type === 'flow') {
        const ref = updated.data as FlowRefData;
        flows = state.doc.flows.map(f =>
          f.id === ref.childFlowId
            ? { ...f, name: ref.name, description: ref.description ?? f.description, departmentId: ref.departmentId ?? f.departmentId }
            : f
        );
      }
      // Renaming an `end` node renames the exit it represents on the parent's flow node — and a
      // `start` node the entry. The card label re-derives itself, but the edge's stored
      // data.exit / data.entry needs refreshing.
      if (updated && updated.data.type === 'end') {
        const label = (updated.data as TerminalData).name;
        edges = state.doc.edges.map(e =>
          e.sourceHandle === nodeId ? { ...e, data: { ...e.data, exit: label } } : e
        );
      }
      if (updated && updated.data.type === 'start') {
        const label = (updated.data as TerminalData).name;
        edges = state.doc.edges.map(e =>
          e.targetHandle === nodeId ? { ...e, data: { ...e.data, entry: label } } : e
        );
      }
      return { doc: { ...state.doc, nodes, flows, edges } };
    });
  },

  deleteNode: (nodeId) => {
    set((state) => ({ doc: removeNodes(state.doc, [nodeId]), selectedNodeId: null }));
  },

  ungroupFlow: (flowNodeId) => {
    const { doc } = get();
    if (!canUngroupFlow(doc, flowNodeId).ok) return;
    const nextDoc = buildUngroupedFlow(doc, flowNodeId);
    set({ doc: nextDoc, selectedNodeId: null, selectedEdgeId: null });
  },

  setSelectedNode: (nodeId) => set({ selectedNodeId: nodeId, selectedEdgeId: null }),

  updateEdgeData: (edgeId, data) => {
    set((state) => ({
      doc: {
        ...state.doc,
        edges: state.doc.edges.map(e =>
          e.id === edgeId ? { ...e, data: { ...e.data, ...data } as WFEdgeData } : e
        ),
      },
    }));
  },

  deleteEdge: (edgeId) => {
    set((state) => ({
      doc: { ...state.doc, edges: state.doc.edges.filter(e => e.id !== edgeId) },
      selectedEdgeId: null,
    }));
  },

  setSelectedEdge: (edgeId) => set({ selectedEdgeId: edgeId, selectedNodeId: null }),

  addFrequency: () => {
    const id = `freq-${uid()}`;
    set((state) => ({
      doc: {
        ...state.doc,
        frequencies: [...state.doc.frequencies, { id, label: 'New frequency', occurrencesPerMonth: 0 }],
      },
    }));
    return id;
  },

  updateFrequency: (id, patch) => {
    set((state) => ({
      doc: {
        ...state.doc,
        frequencies: state.doc.frequencies.map(f => (f.id === id ? { ...f, ...patch } : f)),
      },
    }));
  },

  deleteFrequency: (id) => {
    set((state) => ({
      doc: {
        ...state.doc,
        frequencies: state.doc.frequencies.filter(f => f.id !== id),
        // Unlink any tasks that referenced it.
        nodes: state.doc.nodes.map(n =>
          n.data.type === 'task' && (n.data as TaskData).frequencyId === id
            ? { ...n, data: { ...n.data, frequencyId: undefined } as TaskData }
            : n
        ),
      },
    }));
  },

  addPersona: () => {
    const id = `persona-${uid()}`;
    set((state) => ({
      doc: {
        ...state.doc,
        personas: [...state.doc.personas, { id, role: 'New role', workerCount: 1, avgWeeklyHours: 40 }],
      },
    }));
    return id;
  },

  updatePersona: (id, patch) => {
    set((state) => ({
      doc: {
        ...state.doc,
        personas: state.doc.personas.map(p => (p.id === id ? { ...p, ...patch } : p)),
      },
    }));
  },

  deletePersona: (id) => {
    set((state) => ({
      doc: {
        ...state.doc,
        personas: state.doc.personas.filter(p => p.id !== id),
        // Unlink any tasks that referenced it.
        nodes: state.doc.nodes.map(n =>
          n.data.type === 'task' && (n.data as TaskData).personaId === id
            ? { ...n, data: { ...n.data, personaId: undefined } as TaskData }
            : n
        ),
      },
    }));
  },

  addDepartment: () => {
    const id = `dept-${uid()}`;
    set((state) => ({
      doc: {
        ...state.doc,
        departments: [...state.doc.departments, { id, name: 'New department' }],
      },
    }));
    return id;
  },

  updateDepartment: (id, patch) => {
    set((state) => ({
      doc: {
        ...state.doc,
        departments: state.doc.departments.map(d => (d.id === id ? { ...d, ...patch } : d)),
      },
    }));
  },

  deleteDepartment: (id) => {
    set((state) => ({
      doc: {
        ...state.doc,
        departments: state.doc.departments.filter(d => d.id !== id),
        // Unlink any flows and flow-reference nodes that referenced it.
        flows: state.doc.flows.map(f =>
          f.departmentId === id ? { ...f, departmentId: undefined } : f
        ),
        nodes: state.doc.nodes.map(n =>
          n.data.type === 'flow' && (n.data as FlowRefData).departmentId === id
            ? { ...n, data: { ...n.data, departmentId: undefined } as FlowRefData }
            : n
        ),
      },
    }));
  },

  clearCurrentFlow: () => {
    set((state) => ({
      doc: {
        ...state.doc,
        nodes: state.doc.nodes.filter(n => n.flowId !== state.currentFlowId),
        edges: state.doc.edges.filter(e => e.flowId !== state.currentFlowId),
        flows: state.doc.flows.map(f =>
          f.id === state.currentFlowId
            ? { ...f, name: '', description: '', departmentId: undefined, companyName: undefined }
            : f
        ),
      },
      selectedNodeId: null,
    }));
  },

  updateCurrentFlow: (patch) => {
    set((state) => ({
      doc: {
        ...state.doc,
        flows: state.doc.flows.map(f =>
          f.id === state.currentFlowId ? { ...f, ...patch } : f
        ),
      },
      // Keep breadcrumb label in sync when name changes.
      breadcrumbs: patch.name
        ? state.breadcrumbs.map(b =>
            b.flowId === state.currentFlowId ? { ...b, name: patch.name as string } : b
          )
        : state.breadcrumbs,
    }));
  },

  loadDoc: (doc) => {
    const normalized = normalizeDoc(doc);
    set({
      doc: normalized,
      currentFlowId: normalized.rootFlowId,
      breadcrumbs: [{ flowId: normalized.rootFlowId, name: normalized.flows.find(f => f.id === normalized.rootFlowId)?.name ?? 'Root' }],
      selectedNodeId: null,
    });
  },

  getDoc: () => get().doc,
}));
