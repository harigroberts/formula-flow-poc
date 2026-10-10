import { useCallback, useEffect, useRef } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesInitialized,
  useReactFlow,
  type NodeMouseHandler,
} from '@xyflow/react';
import { useWorkflowStore } from '@/store/workflowStore';
import { ObstaclesContext } from './edges/obstacles';
import {
  DEFAULT_EDGE_OPTIONS,
  FIT_VIEW_OPTIONS,
  MINIMAP_PROPS,
  edgeTypes,
  nodeTypes,
} from './canvas/canvasConfig';
import { useDecoratedEdges, useObstacleMap } from './canvas/useCanvasGeometry';
import type { WFNodeData, FlowRefData } from '@/types';
import styles from './Canvas.module.css';

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
  // Loop back edges render as `loopback`, the rest as `smart`; obstacles feed edge routing.
  // Both are render-time only and shared with the read-only WorkflowViewer.
  const edges = useDecoratedEdges(doc, currentFlowId, nodes, currentEdges());
  const obstacles = useObstacleMap(nodes);

  // Fit the viewport once per canvas: on first paint and whenever we drill into or back out of
  // a flow. The `fitView` prop alone runs before the nodes have been measured, which leaves the
  // viewport at its default zoom of 1 — on a wide flow that reads as "far too zoomed in".
  // `useNodesInitialized` waits until every node has real dimensions to size the fit against.
  const nodesInitialized = useNodesInitialized();
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
          <Background color="var(--line-strong)" gap={20} size={1.25} />
          <Controls />
          <MiniMap {...MINIMAP_PROPS} />
        </ReactFlow>
      </ObstaclesContext.Provider>
    </div>
  );
}
