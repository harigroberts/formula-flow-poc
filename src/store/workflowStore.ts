import { create } from 'zustand';
import { applyNodeChanges, applyEdgeChanges, addEdge } from '@xyflow/react';
import type { NodeChange, EdgeChange, Connection } from '@xyflow/react';
import type { WFNode, WFEdge, Flow, WorkflowDoc, WFNodeData, TaskData, FlowRefData } from '@/types';
import { seedDoc } from '@/lib/seed';

interface BreadcrumbEntry {
  flowId: string;
  name: string;
}

interface WorkflowState {
  doc: WorkflowDoc;
  currentFlowId: string;
  breadcrumbs: BreadcrumbEntry[];
  selectedNodeId: string | null;

  // react-flow handlers
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;

  // selectors
  currentNodes: () => (WFNode & { flowId: string })[];
  currentEdges: () => (WFEdge & { flowId: string })[];
  currentFlow: () => Flow | undefined;
  selectedNode: () => (WFNode & { flowId: string }) | undefined;

  // navigation
  enterFlow: (childFlowId: string) => void;
  goToBreadcrumb: (flowId: string) => void;

  // CRUD
  addTask: (position: { x: number; y: number }) => void;
  addFlow: (position: { x: number; y: number }) => void;
  updateNodeData: (nodeId: string, data: Partial<WFNodeData>) => void;
  deleteNode: (nodeId: string) => void;
  setSelectedNode: (nodeId: string | null) => void;

  // import/export
  loadDoc: (doc: WorkflowDoc) => void;
  getDoc: () => WorkflowDoc;
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

export const useWorkflowStore = create<WorkflowState>((set, get) => ({
  doc: seedDoc,
  currentFlowId: seedDoc.rootFlowId,
  breadcrumbs: [{ flowId: seedDoc.rootFlowId, name: seedDoc.flows.find(f => f.id === seedDoc.rootFlowId)?.name ?? 'Root' }],
  selectedNodeId: null,

  onNodesChange: (changes) => {
    set((state) => {
      const currentNodes = state.doc.nodes.filter(n => n.flowId === state.currentFlowId);
      const otherNodes = state.doc.nodes.filter(n => n.flowId !== state.currentFlowId);
      const updated = applyNodeChanges(changes, currentNodes) as (WFNode & { flowId: string })[];
      return { doc: { ...state.doc, nodes: [...otherNodes, ...updated] } };
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
      merged.forEach(e => { if (!e.flowId) e.flowId = state.currentFlowId; });
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

  enterFlow: (childFlowId) => {
    const { doc, breadcrumbs } = get();
    const flow = doc.flows.find(f => f.id === childFlowId);
    if (!flow) return;
    set({
      currentFlowId: childFlowId,
      breadcrumbs: [...breadcrumbs, { flowId: childFlowId, name: flow.name }],
      selectedNodeId: null,
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
      };
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
        ownerRole: '',
        status: 'todo',
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

  updateNodeData: (nodeId, data) => {
    set((state) => {
      const nodes = state.doc.nodes.map(n => {
        if (n.id !== nodeId) return n;
        return { ...n, data: { ...n.data, ...data } as WFNodeData };
      });
      const updated = nodes.find(n => n.id === nodeId);
      let flows = state.doc.flows;
      if (updated && updated.data.type === 'flow') {
        const ref = updated.data as FlowRefData;
        flows = state.doc.flows.map(f =>
          f.id === ref.childFlowId
            ? { ...f, name: ref.name, description: ref.description ?? f.description }
            : f
        );
      }
      return { doc: { ...state.doc, nodes, flows } };
    });
  },

  deleteNode: (nodeId) => {
    set((state) => {
      const node = state.doc.nodes.find(n => n.id === nodeId);
      let flows = state.doc.flows;
      // If deleting a flow node, also remove the child flow and all its descendant nodes/edges
      if (node?.data.type === 'flow') {
        const childFlowId = (node.data as FlowRefData).childFlowId;
        flows = state.doc.flows.filter(f => f.id !== childFlowId);
        const nodes = state.doc.nodes.filter(n => n.id !== nodeId && n.flowId !== childFlowId);
        const edges = state.doc.edges.filter(e => e.id !== nodeId && e.flowId !== childFlowId);
        return { doc: { ...state.doc, flows, nodes, edges }, selectedNodeId: null };
      }
      const nodes = state.doc.nodes.filter(n => n.id !== nodeId);
      const edges = state.doc.edges.filter(e => e.source !== nodeId && e.target !== nodeId);
      return { doc: { ...state.doc, nodes, edges }, selectedNodeId: null };
    });
  },

  setSelectedNode: (nodeId) => set({ selectedNodeId: nodeId }),

  loadDoc: (doc) => {
    set({
      doc,
      currentFlowId: doc.rootFlowId,
      breadcrumbs: [{ flowId: doc.rootFlowId, name: doc.flows.find(f => f.id === doc.rootFlowId)?.name ?? 'Root' }],
      selectedNodeId: null,
    });
  },

  getDoc: () => get().doc,
}));
