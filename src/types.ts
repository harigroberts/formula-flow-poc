import type { Edge, Node } from '@xyflow/react';

export type TaskStatus = 'todo' | 'active' | 'done';

export interface TaskData extends Record<string, unknown> {
  type: 'task';
  name: string;
  description: string;
  ownerRole: string;
  status: TaskStatus;
  humanMinutesPerRun?: number;
  frequency?: string;
  tools?: string[];
  inputs?: string[];
  outputs?: string[];
  dataSources?: string[];
  isManual?: boolean;
  painPoints?: string;
  dataDriven?: boolean;
}

export interface FlowRefData extends Record<string, unknown> {
  type: 'flow';
  name: string;
  childFlowId: string;
  description?: string;
}

export interface DecisionData extends Record<string, unknown> {
  type: 'decision';
  name: string;
  description?: string;
}

export interface TerminalData extends Record<string, unknown> {
  type: 'start' | 'end';
  name: string;
  description?: string;
}

export interface WFEdgeData extends Record<string, unknown> {
  branch?: 'yes' | 'no';
}

export type WFNodeData = TaskData | FlowRefData | DecisionData | TerminalData;
export type WFNode = Node<WFNodeData>;
export type WFEdge = Edge<WFEdgeData>;

export interface Flow {
  id: string;
  name: string;
  description: string;
  parentFlowId: string | null;
}

export interface WorkflowDoc {
  version: 1;
  rootFlowId: string;
  flows: Flow[];
  nodes: (WFNode & { flowId: string })[];
  edges: (WFEdge & { flowId: string })[];
}

export interface AnalysisFinding {
  nodeId: string;
  nodeName: string;
  recommendation: string;
  claudeProduct: string;
  estTimeSavedPerRun?: number;
  rationale: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface AnalysisResult {
  findings: AnalysisFinding[];
  summary: string;
}
