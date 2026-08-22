import type {
  AnalysisFinding,
  AnalysisResult,
  Flow,
  FlowRefData,
  StrategicAnalysis,
  SubFlowAnalysis,
  TerminalData,
  WFNode,
  WorkflowDoc,
} from '@/types';

export function collectFlowIds(doc: WorkflowDoc, startFlowId: string): string[] {
  const visited = new Set<string>();
  const queue = [startFlowId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    for (const node of doc.nodes) {
      if (node.flowId === id && node.type === 'flow') {
        const childId = (node.data as FlowRefData).childFlowId;
        if (childId) queue.push(childId);
      }
    }
  }
  return [...visited];
}

/**
 * Drop React Flow's runtime fields (canvas geometry, selection state) before sending.
 * They carry no analytical signal and the payload is now echoed through three passes.
 */
function slimNode(node: WFNode & { flowId: string }) {
  return { id: node.id, type: node.type, flowId: node.flowId, data: node.data };
}

async function post<T>(path: string, payload: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    // The server replies { error: string }; surface that rather than the raw JSON.
    let message = text;
    try {
      message = (JSON.parse(text) as { error?: string }).error ?? text;
    } catch {
      /* not JSON — use the raw body */
    }
    throw new Error(message);
  }

  return res.json() as Promise<T>;
}

/** Level 1 — per-node findings across the whole document. */
export async function analyzeTasks(doc: WorkflowDoc): Promise<AnalysisResult> {
  const flowIds = collectFlowIds(doc, doc.rootFlowId);

  return post<AnalysisResult>('/api/analyze', {
    flows: doc.flows.filter((f) => flowIds.includes(f.id)),
    nodes: doc.nodes.filter((n) => flowIds.includes(n.flowId)).map(slimNode),
    edges: doc.edges.filter((e) => flowIds.includes(e.flowId)),
    frequencies: doc.frequencies,
    personas: doc.personas,
    departments: doc.departments,
  });
}

/**
 * Level 2 — one sub-flow reviewed as an integrated whole, given its own level-1
 * findings and the analyses of any sub-flows nested inside it.
 */
export async function analyzeSubFlow(
  doc: WorkflowDoc,
  flow: Flow,
  taskFindings: AnalysisFinding[],
  childAnalyses: SubFlowAnalysis[],
): Promise<SubFlowAnalysis> {
  const nodes = doc.nodes.filter((n) => n.flowId === flow.id);
  const nodeIds = new Set(nodes.map((n) => n.id));

  return post<SubFlowAnalysis>('/api/analyze/subflow', {
    flow,
    nodes: nodes.map(slimNode),
    edges: doc.edges.filter((e) => e.flowId === flow.id),
    parentContext: {
      parentFlowName: doc.flows.find((f) => f.id === flow.parentFlowId)?.name ?? null,
      exits: nodes
        .filter((n) => n.data.type === 'end')
        .map((n) => (n.data as TerminalData).name),
    },
    taskFindings: taskFindings.filter((f) => nodeIds.has(f.nodeId)),
    childAnalyses,
    frequencies: doc.frequencies,
    personas: doc.personas,
    departments: doc.departments,
  });
}

/** Level 3 — the entire workflow reviewed as one system. */
export async function analyzeStrategic(
  doc: WorkflowDoc,
  taskResult: AnalysisResult | null,
  subFlowAnalyses: SubFlowAnalysis[],
): Promise<StrategicAnalysis> {
  const flowIds = collectFlowIds(doc, doc.rootFlowId);

  return post<StrategicAnalysis>('/api/analyze/strategic', {
    flows: doc.flows.filter((f) => flowIds.includes(f.id)),
    nodes: doc.nodes.filter((n) => flowIds.includes(n.flowId)).map(slimNode),
    edges: doc.edges.filter((e) => flowIds.includes(e.flowId)),
    taskFindings: taskResult?.findings ?? [],
    subFlowAnalyses,
    frequencies: doc.frequencies,
    personas: doc.personas,
    departments: doc.departments,
  });
}
