import { MarkerType, type EdgeTypes, type MiniMapProps, type NodeTypes } from '@xyflow/react';
import TaskNode from '../nodes/TaskNode';
import FlowNode from '../nodes/FlowNode';
import DecisionNode from '../nodes/DecisionNode';
import StartNode from '../nodes/StartNode';
import EndNode from '../nodes/EndNode';
import LoopEdge from '../edges/LoopEdge';
import SmartEdge from '../edges/SmartEdge';

/**
 * Shared by the editable `Canvas` and the read-only `WorkflowViewer`, so a workflow looks the
 * same wherever it's drawn. Module-level on purpose: React Flow wants stable type maps.
 */

// maxZoom 1 keeps a sparse canvas at natural size instead of blowing the cards up to 2x,
// which is React Flow's default fit ceiling.
export const FIT_VIEW_OPTIONS = { padding: 0.2, maxZoom: 1 };

export const nodeTypes: NodeTypes = {
  task: TaskNode,
  flow: FlowNode,
  decision: DecisionNode,
  start: StartNode,
  end: EndNode,
};

export const edgeTypes: EdgeTypes = {
  loopback: LoopEdge,
  smart: SmartEdge,
};

// Literal hex rather than var(--edge): React Flow renders markers into a <defs>
// block that isn't reliably inside the themed subtree, so a CSS custom property may not
// resolve there. Keep in step with --edge (styles/tangerine/colors_and_type.css).
export const DEFAULT_EDGE_OPTIONS = {
  markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: '#8A6C54' },
};

export const MINIMAP_PROPS: MiniMapProps = {
  nodeStrokeColor: (n) => (n.type === 'flow' ? 'var(--color-teal)' : 'var(--edge)'),
  nodeColor: (n) =>
    n.type === 'flow'
      ? 'color-mix(in srgb, var(--color-teal) 20%, var(--color-paper))'
      : 'var(--color-paper)',
  maskColor: 'color-mix(in srgb, var(--canvas) 85%, transparent)',
};
