import type { Edge, Node } from '@xyflow/react';

export type TaskStatus = 'todo' | 'active' | 'done';

export interface TaskData extends Record<string, unknown> {
  type: 'task';
  name: string;
  description: string;
  personaId?: string;
  status: TaskStatus;
  humanMinutesPerRun?: number;
  frequencyId?: string;
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
  department?: string;
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
  department?: string;
  parentFlowId: string | null;
  companyName?: string;
}

/**
 * A named frequency bucket shared across the whole document. The label describes
 * the cadence (e.g. "per new customer") and `occurrencesPerMonth` is how many
 * times that bucket actually fires in a month across the whole org — used to turn
 * per-run time savings into per-month totals.
 */
export interface FrequencyCategory {
  id: string;
  label: string;
  occurrencesPerMonth: number;
}

/**
 * A role/persona that owns tasks. `workerCount` × `avgWeeklyHours` gives the total
 * available capacity for that persona, against which the time attributed via tasks
 * can be measured (utilisation %).
 */
export interface Persona {
  id: string;
  role: string;
  workerCount: number;
  avgWeeklyHours: number;
}

export interface WorkflowDoc {
  version: 1;
  rootFlowId: string;
  flows: Flow[];
  frequencies: FrequencyCategory[];
  personas: Persona[];
  nodes: (WFNode & { flowId: string })[];
  edges: (WFEdge & { flowId: string })[];
}

export interface AnalysisFinding {
  nodeId: string;
  nodeName: string;
  recommendation: string;
  claudeProduct: string;
  estTimeSavedPerRun?: number;
  /** estTimeSavedPerRun × the task frequency's occurrencesPerMonth, in minutes/month. */
  estMonthlyTimeSaved?: number;
  rationale: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface PersonaUtilisation {
  persona: string;
  attributedHoursPerMonth: number;
  savedHoursPerMonth?: number;
  capacityHoursPerMonth: number;
  utilisationPct: number;
}

export interface AnalysisResult {
  findings: AnalysisFinding[];
  summary: string;
  /** Sum of estMonthlyTimeSaved across all findings, in minutes/month. */
  totalMonthlyTimeSaved?: number;
  personaUtilisation?: PersonaUtilisation[];
}
