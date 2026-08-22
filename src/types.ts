import type { Edge, Node } from '@xyflow/react';

export interface TaskData extends Record<string, unknown> {
  type: 'task';
  name: string;
  description: string;
  personaId?: string;
  humanMinutesPerRun?: number;
  frequencyId?: string;
  tools?: string[];
  inputs?: string[];
  outputs?: string[];
  dataSources?: string[];
  isManual?: boolean;
  painPoints?: string;
  dataDriven?: boolean;
  // Knowledge-access metadata (progressive disclosure in the Inspector).
  // Tier 1: how reachable is the information this task needs.
  inputAccessibility?: 'instant' | 'search' | 'ask' | 'rebuild';
  // Tier 2 (revealed by inputAccessibility):
  searchTime?: number;                                      // minutes to retrieve — when not "instant"
  inputSource?: string;                                     // where the input comes from — when "ask" / "rebuild"
  knowledgeCaptured?: boolean;                              // is the tacit knowledge documented — when "ask"
  expertiseLevel?: 'junior' | 'mid' | 'senior' | 'expert'; // expertise required — when "ask"
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
  informationCompleteness?: 'full' | 'partial' | 'gut_feel';
  decisionBasis?: 'rules' | 'experience' | 'intuition';
  reversibility?: 'reversible' | 'hard_to_reverse' | 'irreversible';
  costOfError?: 'low' | 'medium' | 'high';
  historicalDataExists?: boolean;
  outcomeMeasured?: boolean;
  outcomeDataSource?: string;
}

export interface TerminalData extends Record<string, unknown> {
  type: 'start' | 'end';
  name: string;
  description?: string;
}

export interface WFEdgeData extends Record<string, unknown> {
  branch?: 'yes' | 'no';
  /**
   * For an edge leaving a `flow` node: the name of the child flow's `end` node it exits from.
   * The durable link is the edge's `sourceHandle` (= that end node's id); this is the label,
   * kept in sync when the end node is renamed.
   */
  exit?: string;
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
