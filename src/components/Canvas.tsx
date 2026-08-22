import { useCallback, useEffect, useRef } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesInitialized,
  useReactFlow,
  type NodeTypes,
  type NodeMouseHandler,
} from '@xyflow/react';
import { useWorkflowStore } from '@/store/workflowStore';
import TaskNode from './nodes/TaskNode';
import FlowNode from './nodes/FlowNode';
import DecisionNode from './nodes/DecisionNode';
import StartNode from './nodes/StartNode';
import EndNode from './nodes/EndNode';
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

export default function Canvas() {
  const {
    currentFlowId,
    currentNodes,
    currentEdges,
    onNodesChange,
    onEdgesChange,
    onConnect,
    enterFlow,
    setSelectedNode,
    addTask,
    addFlow,
    addDecision,
    addStart,
    addEnd,
  } = useWorkflowStore();

  const nodes = currentNodes();
  const edges = currentEdges();

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
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeDoubleClick={onNodeDoubleClick}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        onDragOver={onDragOver}
        onDrop={onDrop}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={FIT_VIEW_OPTIONS}
        minZoom={0.2}
        deleteKeyCode="Delete"
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
    </div>
  );
}
