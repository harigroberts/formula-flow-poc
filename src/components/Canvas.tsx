import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  MarkerType,
  useNodesInitialized,
  useReactFlow,
  type NodeTypes,
  type EdgeTypes,
  type NodeMouseHandler,
} from '@xyflow/react';
import { useWorkflowStore } from '@/store/workflowStore';
import TaskNode from './nodes/TaskNode';
import FlowNode from './nodes/FlowNode';
import DecisionNode from './nodes/DecisionNode';
import StartNode from './nodes/StartNode';
import EndNode from './nodes/EndNode';
import LoopEdge from './edges/LoopEdge';
import SmartEdge from './edges/SmartEdge';
import { ObstaclesContext } from './edges/obstacles';
import type { Rect } from '@/lib/edgeRouting';
import { findLoops, findLoopByBackEdge } from '@/lib/cycles';
import type { WFNodeData, FlowRefData } from '@/types';
import styles from './Canvas.module.css';

// maxZoom 1 keeps a sparse canvas at natural size instead of blowing the cards up to 2x,
// which is React Flow's default fit ceiling.
const FIT_VIEW_OPTIONS = { padding: 0.2, maxZoom: 1 };

const nodeTypes: NodeTypes = {
  task: TaskNode,
  flow: FlowNode,
  decision: DecisionNode,
  start: StartNode,
  end: EndNode,
};

const edgeTypes: EdgeTypes = {
  loopback: LoopEdge,
  smart: SmartEdge,
};

// Literal hex rather than var(--color-mid-gray): React Flow renders markers into a <defs>
// block that isn't reliably inside the themed subtree, so a CSS custom property may not
// resolve there. Matches --color-mid-gray → --fg-subtle (see theme.css).
const DEFAULT_EDGE_OPTIONS = {
  markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: '#9A7E66' },
};

export default function Canvas() {
  const {
    doc,
    currentFlowId,
    currentNodes,
    currentEdges,
    onNodesChange,
    onEdgesChange,
    onConnect,
    enterFlow,
    setSelectedNode,
    setSelectedEdge,
    addTask,
    addFlow,
    addDecision,
    addStart,
    addEnd,
  } = useWorkflowStore();

  const nodes = currentNodes();
  const edgesRaw = currentEdges();

  // Loop detection (Tarjan's SCC) only cares about node types and edge source/target, not
  // about `doc` reference identity — which changes on every store write, including ones
  // that touch a totally different flow (e.g. typing in the Inspector). Keying the memo on
  // this topology string instead of on `doc` keeps findLoops from re-running on every
  // keystroke; see the FlowNode `handleKey` precedent for the same technique.
  const topoKey =
    nodes.map((n) => `${n.id}:${n.type}`).join('|') +
    '#' +
    edgesRaw.map((e) => `${e.id}:${e.source}>${e.target}`).join('|');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const loops = useMemo(() => findLoops(doc, currentFlowId), [topoKey, currentFlowId]);

  const edges = edgesRaw.map((e) => {
    const loop = findLoopByBackEdge(loops, e.id);
    if (!loop) return { ...e, type: 'smart' };
    return { ...e, type: 'loopback', data: { ...e.data, loop: { guarded: loop.guarded } } };
  });

  // Obstacle rects for edge routing, keyed by node id so an edge can exclude its own
  // source/target. Derived from measured node size, which React Flow writes back onto
  // `doc.nodes` via onNodesChange('dimensions') — see the geometry-key precedent in the loop
  // memo above for why this is a string key rather than a `doc` dependency. Recomputed on every
  // position change, including mid-drag: `geometryKey` already changes on every drag frame (the
  // dragged node's position is part of it), so gating this on `dragging` bought no savings — it
  // only made the memo return `null` and drop every edge back to its plain, unrouted path for
  // the duration of the drag, which read as a jarring style change rather than a live update.
  const nodesInitialized = useNodesInitialized();
  const geometryKey = nodes
    .map((n) => `${n.id}:${Math.round(n.position.x)}:${Math.round(n.position.y)}:${n.measured?.width ?? 0}:${n.measured?.height ?? 0}`)
    .join('|');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const obstacles = useMemo<Map<string, Rect> | null>(() => {
    if (!nodesInitialized) return null;
    const map = new Map<string, Rect>();
    for (const n of nodes) {
      if (!n.measured?.width || !n.measured?.height) continue;
      map.set(n.id, { x: n.position.x, y: n.position.y, width: n.measured.width, height: n.measured.height });
    }
    return map;
  }, [geometryKey, nodesInitialized]);

  // Fit the viewport once per canvas: on first paint and whenever we drill into or back out of
  // a flow. The `fitView` prop alone runs before the nodes have been measured, which leaves the
  // viewport at its default zoom of 1 — on a wide flow that reads as "far too zoomed in".
  // `useNodesInitialized` (above) waits until every node has real dimensions to size the fit
  // against — reused here rather than declared twice.
  const { fitView } = useReactFlow();
  const fittedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!nodesInitialized || fittedFor.current === currentFlowId) return;
    const isFirstFit = fittedFor.current === null;
    fittedFor.current = currentFlowId;
    fitView({ ...FIT_VIEW_OPTIONS, duration: isFirstFit ? 0 : 200 });
  }, [nodesInitialized, currentFlowId, fitView]);

  const onNodeDoubleClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      const data = node.data as WFNodeData;
      if (data.type === 'flow') {
        enterFlow((data as FlowRefData).childFlowId);
      }
    },
    [enterFlow],
  );

  const onNodeClick = useCallback(
    (_event: React.MouseEvent, node: { id: string }) => {
      setSelectedNode(node.id);
    },
    [setSelectedNode],
  );

  const onPaneClick = useCallback(() => {
    setSelectedNode(null);
  }, [setSelectedNode]);

  const onEdgeClick = useCallback(
    (_event: React.MouseEvent, edge: { id: string }) => {
      setSelectedEdge(edge.id);
    },
    [setSelectedEdge],
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const type = event.dataTransfer.getData('application/flow-node-type');
      if (!type) return;

      const bounds = (event.target as HTMLElement).closest('.react-flow')?.getBoundingClientRect();
      if (!bounds) return;

      const position = {
        x: event.clientX - bounds.left - 90,
        y: event.clientY - bounds.top - 40,
      };

      if (type === 'task') addTask(position);
      if (type === 'flow') addFlow(position);
      if (type === 'decision') addDecision(position);
      if (type === 'start') addStart(position);
      if (type === 'end') addEnd(position);
    },
    [addTask, addFlow, addDecision, addStart, addEnd],
  );

  return (
    <div className={styles.canvas}>
      <ObstaclesContext.Provider value={obstacles}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeDoubleClick={onNodeDoubleClick}
          onNodeClick={onNodeClick}
          onEdgeClick={onEdgeClick}
          onPaneClick={onPaneClick}
          onDragOver={onDragOver}
          onDrop={onDrop}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          defaultEdgeOptions={DEFAULT_EDGE_OPTIONS}
          fitView
          fitViewOptions={FIT_VIEW_OPTIONS}
          minZoom={0.2}
          deleteKeyCode="Delete"
          // Default multiSelectionKeyCode is Meta (Mac) / Control (elsewhere) only — Shift is
          // already bound to selectionKeyCode for drag-box select, so accepting it here too
          // lets a Shift-click-per-node multi-select (the instinct most people reach for first)
          // work alongside Cmd/Ctrl-click, without changing what Shift-drag already does.
          multiSelectionKeyCode={['Meta', 'Control', 'Shift']}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="var(--color-light-gray)" gap={20} size={1} />
          <Controls />
          <MiniMap
            nodeStrokeColor={(n) => n.type === 'flow' ? 'var(--color-blue)' : 'var(--color-orange)'}
            nodeColor={(n) => n.type === 'flow' ? 'rgba(106,155,204,0.2)' : 'rgba(217,119,87,0.15)'}
            maskColor="rgba(250,249,245,0.85)"
          />
        </ReactFlow>
      </ObstaclesContext.Provider>
    </div>
  );
}
