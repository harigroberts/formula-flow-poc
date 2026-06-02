import { useCallback } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type NodeTypes,
  type OnNodeDoubleClick,
} from '@xyflow/react';
import { useWorkflowStore } from '@/store/workflowStore';
import TaskNode from './nodes/TaskNode';
import FlowNode from './nodes/FlowNode';
import type { WFNodeData, FlowRefData } from '@/types';
import styles from './Canvas.module.css';

const nodeTypes: NodeTypes = {
  task: TaskNode,
  flow: FlowNode,
};

export default function Canvas() {
  const {
    currentNodes,
    currentEdges,
    onNodesChange,
    onEdgesChange,
    onConnect,
    enterFlow,
    setSelectedNode,
    addTask,
    addFlow,
  } = useWorkflowStore();

  const nodes = currentNodes();
  const edges = currentEdges();

  const onNodeDoubleClick: OnNodeDoubleClick = useCallback(
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
    },
    [addTask, addFlow],
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
        fitViewOptions={{ padding: 0.2 }}
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
