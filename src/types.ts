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
  departmentId?: string;
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
  /**
   * The mirror of `exit` for an edge *entering* a `flow` node: the name of the child flow's
   * `start` node it enters at. The durable link is the edge's `targetHandle` (= that start
   * node's id); this is the label, kept in sync when the start node is renamed.
   */
  entry?: string;
  /**
   * For an edge that closes a feedback loop (detected via `findLoops` in `lib/cycles.ts`,
   * never stored as a flag): the share of runs (0-100) that take it. A task inside the loop
   * therefore runs more than once per workflow run — see the impact-maths note in
   * `server/prompts/shared.ts`.
   */
  retryRatePct?: number;
}

export type WFNodeData = TaskData | FlowRefData | DecisionData | TerminalData;
export type WFNode = Node<WFNodeData>;
export type WFEdge = Edge<WFEdgeData>;

export interface Flow {
  id: string;
  name: string;
  description: string;
  departmentId?: string;
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

/**
 * A department that owns flows and sub-flows. Referenced by id from `Flow.departmentId`
 * and `FlowRefData.departmentId` rather than free text, so it can be renamed in one place.
 */
export interface Department {
  id: string;
  name: string;
}

export interface WorkflowDoc {
  version: 1;
  rootFlowId: string;
  flows: Flow[];
  frequencies: FrequencyCategory[];
  personas: Persona[];
  departments: Department[];
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

/**
 * How deep to run the analysis. Each level takes the level(s) below it as input,
 * so `strategic` implies all three passes have run.
 */
export type AnalysisDepth = 'tasks' | 'subflows' | 'strategic';

/**
 * Level 2 — one sub-flow reviewed as an integrated whole, given its own task-level
 * findings. `improvesOnTaskLevel: false` is a first-class result: it says the
 * task-by-task plan is already the right answer for this sub-flow.
 */
export interface SubFlowAnalysis {
  flowId: string;
  flowName: string;
  /** false ⇒ no integrated approach beats doing the tasks one at a time. */
  improvesOnTaskLevel: boolean;
  /** Always present. When improvesOnTaskLevel is false this is the explicit "no gain" statement. */
  verdict: string;
  /** Only when improvesOnTaskLevel — the integrated redesign. */
  recommendation?: string;
  claudeProduct?: string;
  /** Ids of the task nodes whose individual findings this integrated approach replaces. */
  supersedesNodeIds?: string[];
  /** Minutes/month for the integrated approach as a whole. */
  estMonthlyTimeSaved?: number;
  /** Minutes/month gained *beyond* what the task-level findings already claim. */
  incrementalMonthlyTimeSaved?: number;
  rationale: string;
  confidence: 'high' | 'medium' | 'low';
  risks?: string[];
}

/** One whole-workflow move produced by the strategic pass. */
export interface StrategicInitiative {
  title: string;
  recommendation: string;
  claudeProduct: string;
  /** Flow ids this initiative reaches across. */
  spansFlowIds: string[];
  supersedes?: { nodeIds?: string[]; flowIds?: string[] };
  estMonthlyTimeSaved?: number;
  /** Minutes/month gained beyond the task and sub-flow levels. */
  incrementalMonthlyTimeSaved?: number;
  /** Where this sits in a roadmap (e.g. "Phase 1 — prerequisite for the others"). */
  sequencing?: string;
  rationale: string;
  confidence: 'high' | 'medium' | 'low';
}

/**
 * Level 3 — the entire workflow reviewed as one system, given the task findings and
 * every sub-flow analysis. `improvesOnLowerLevels: false` is a first-class result.
 */
export interface StrategicAnalysis {
  /** false ⇒ the task and sub-flow levels have already captured everything. */
  improvesOnLowerLevels: boolean;
  /** Always present, including the explicit "no gain" statement. */
  verdict: string;
  summary: string;
  initiatives: StrategicInitiative[];
  /** Minutes/month gained over the lower levels only — never a re-count of them. */
  totalIncrementalMonthlyTimeSaved?: number;
}

/** The full three-level result, filled in progressively as each pass completes. */
export interface MultiLevelAnalysis {
  depth: AnalysisDepth;
  tasks: AnalysisResult | null;
  subFlows: SubFlowAnalysis[];
  strategic: StrategicAnalysis | null;
  /**
   * Which results the server served from `analysis_cache` rather than by calling the model.
   * Keys are `'tasks'`, `'strategic'`, or a sub-flow's `flowId`.
   */
  cached: Record<string, boolean>;
}

/* ------------------------------------------------------------------ chat */

/** One turn of the chat about the analysis. Text only — thinking blocks are never sent back. */
export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * What the chat thread is built on: the graph as it was analysed and the three levels of
 * output. Frozen per analysis run — the server turns it into the cached prefix of every
 * chat request, so it must not change between turns.
 */
export interface ChatContext {
  workflow: unknown;
  analysis: Omit<MultiLevelAnalysis, 'cached'>;
}

export interface ChatUsage {
  input: number;
  output: number;
  /** Prompt tokens served from Anthropic's prompt cache on this turn. */
  cacheRead: number;
  /** Prompt tokens written to the prompt cache on this turn. */
  cacheWrite: number;
}

/** A turn as the UI holds it — and as `chat_conversations.messages` stores it. */
export interface ChatMessage extends ChatTurn {
  /** Set on an assistant reply once it has finished streaming. */
  usage?: ChatUsage;
  /** The reply was stopped or failed partway; the text so far is kept. */
  interrupted?: boolean;
}

/** One row of the conversation list — just enough to render the sidebar. */
export interface ConversationSummary {
  id: string;
  title: string;
  /** Fingerprint of the analysed workflow the conversation was about — see `workflowHash()`. */
  workflowHash: string;
  updatedAt: string;
}

/** Streamed by `POST /api/chat`, one JSON object per line. */
export type ChatEvent =
  | { type: 'text'; text: string }
  | { type: 'done'; stopReason: string | null; usage: ChatUsage }
  | { type: 'error'; error: string };
