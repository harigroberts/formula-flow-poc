import { getFlowExits } from '@/lib/exits';
import type {
  AnalysisFinding,
  AnalysisResult,
  Flow,
  FlowRefData,
  StrategicAnalysis,
  SubFlowAnalysis,
  WFEdge,
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
 *
 * This is also load-bearing for the server-side cache: React Flow writes `selected` onto a
 * node or edge when you click it, so without slimming, merely selecting something on the
 * canvas would change the payload and miss the cache.
 */
function slimNode(node: WFNode & { flowId: string }) {
  return { id: node.id, type: node.type, flowId: node.flowId, data: node.data };
}

function slimEdge(edge: WFEdge & { flowId: string }) {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle,
    targetHandle: edge.targetHandle,
    label: edge.label,
    data: edge.data,
    flowId: edge.flowId,
  };
}

export interface Cacheable<T> {
  result: T;
  /** True when the server served this from `analysis_cache` rather than calling the model. */
  cached: boolean;
}

async function post<T>(path: string, payload: unknown, fresh: boolean): Promise<Cacheable<T>> {
  const res = await fetch(fresh ? `${path}?fresh=1` : path, {
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

  return {
    result: (await res.json()) as T,
    cached: res.headers.get('X-Analysis-Cache') === 'hit',
  };
}

/** Level 1 — per-node findings across the whole document. */
export async function analyzeTasks(
  doc: WorkflowDoc,
  fresh = false,
): Promise<Cacheable<AnalysisResult>> {
  const flowIds = collectFlowIds(doc, doc.rootFlowId);

  return post<AnalysisResult>(
    '/api/analyze',
    {
      flows: doc.flows.filter((f) => flowIds.includes(f.id)),
      nodes: doc.nodes.filter((n) => flowIds.includes(n.flowId)).map(slimNode),
      edges: doc.edges.filter((e) => flowIds.includes(e.flowId)).map(slimEdge),
      frequencies: doc.frequencies,
      personas: doc.personas,
      departments: doc.departments,
    },
    fresh,
  );
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
  fresh = false,
): Promise<Cacheable<SubFlowAnalysis>> {
  const nodes = doc.nodes.filter((n) => n.flowId === flow.id);
  const nodeIds = new Set(nodes.map((n) => n.id));

  return post<SubFlowAnalysis>(
    '/api/analyze/subflow',
    {
      flow,
      nodes: nodes.map(slimNode),
      edges: doc.edges.filter((e) => e.flowId === flow.id).map(slimEdge),
      parentContext: {
        parentFlowName: doc.flows.find((f) => f.id === flow.parentFlowId)?.name ?? null,
        // getFlowExits sorts by canvas y with an id tie-break, so this matches the order the
        // user sees on the parent's flow card. Filtering `nodes` directly would instead give
        // arbitrary store order, which is both wrong and unstable for the cache key.
        exits: getFlowExits(doc, flow.id).map((e) => e.label),
      },
      // Sent to the model, but excluded from the cache key server-side — see EXCLUDE_FROM_KEY.
      taskFindings: taskFindings.filter((f) => nodeIds.has(f.nodeId)),
      childAnalyses,
      frequencies: doc.frequencies,
      personas: doc.personas,
      departments: doc.departments,
    },
    fresh,
  );
}

/** Level 3 — the entire workflow reviewed as one system. */
export async function analyzeStrategic(
  doc: WorkflowDoc,
  taskResult: AnalysisResult | null,
  subFlowAnalyses: SubFlowAnalysis[],
  fresh = false,
): Promise<Cacheable<StrategicAnalysis>> {
  const flowIds = collectFlowIds(doc, doc.rootFlowId);

  return post<StrategicAnalysis>(
    '/api/analyze/strategic',
    {
      flows: doc.flows.filter((f) => flowIds.includes(f.id)),
      nodes: doc.nodes.filter((n) => flowIds.includes(n.flowId)).map(slimNode),
      edges: doc.edges.filter((e) => flowIds.includes(e.flowId)).map(slimEdge),
      // Sent to the model, but excluded from the cache key server-side — see EXCLUDE_FROM_KEY.
      taskFindings: taskResult?.findings ?? [],
      subFlowAnalyses,
      frequencies: doc.frequencies,
      personas: doc.personas,
      departments: doc.departments,
    },
    fresh,
  );
}
