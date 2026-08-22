import { analyzeTasks, analyzeSubFlow, analyzeStrategic } from '@/lib/api';
import type {
  AnalysisDepth,
  Flow,
  MultiLevelAnalysis,
  SubFlowAnalysis,
  WorkflowDoc,
} from '@/types';

export type AnalysisStage = 'idle' | 'tasks' | 'subflows' | 'strategic' | 'done';

interface Progress {
  stage: AnalysisStage;
  analysis: MultiLevelAnalysis;
}

/**
 * Sub-flows grouped by their distance from the root, deepest tier first. Running in
 * that order means a nested parent sub-flow already has its children's analyses to
 * hand when its own turn comes.
 */
function subFlowTiers(doc: WorkflowDoc): Flow[][] {
  const depthOf = (flow: Flow): number => {
    let depth = 0;
    let current: Flow | undefined = flow;
    const seen = new Set<string>();
    while (current?.parentFlowId && !seen.has(current.id)) {
      seen.add(current.id);
      current = doc.flows.find((f) => f.id === current!.parentFlowId);
      depth += 1;
    }
    return depth;
  };

  // A sub-flow needs at least two task/decision nodes for "integrated" to mean anything.
  const analysable = doc.flows.filter((f) => {
    if (f.parentFlowId === null) return false;
    const substantive = doc.nodes.filter(
      (n) => n.flowId === f.id && (n.data.type === 'task' || n.data.type === 'decision'),
    );
    return substantive.length >= 2;
  });

  const byDepth = new Map<number, Flow[]>();
  for (const flow of analysable) {
    const d = depthOf(flow);
    byDepth.set(d, [...(byDepth.get(d) ?? []), flow]);
  }

  return [...byDepth.entries()].sort((a, b) => b[0] - a[0]).map(([, flows]) => flows);
}

/**
 * Runs the analysis levels in sequence, feeding each level's output into the next and
 * calling `onProgress` after every stage so the UI can fill in level by level.
 * Stops at whichever `depth` the user asked for.
 */
export async function runAnalysis(
  doc: WorkflowDoc,
  depth: AnalysisDepth,
  onProgress: (p: Progress) => void,
  opts: { fresh?: boolean } = {},
): Promise<MultiLevelAnalysis> {
  const fresh = opts.fresh ?? false;
  const analysis: MultiLevelAnalysis = {
    depth,
    tasks: null,
    subFlows: [],
    strategic: null,
    cached: {},
  };

  // A fresh snapshot each time — `subFlows` and `cached` are mutated as the run proceeds.
  const snapshot = (): MultiLevelAnalysis => ({
    ...analysis,
    subFlows: [...analysis.subFlows],
    cached: { ...analysis.cached },
  });

  // Level 1 — per-node findings across the whole document.
  onProgress({ stage: 'tasks', analysis: snapshot() });
  const tasks = await analyzeTasks(doc, fresh);
  analysis.tasks = tasks.result;
  analysis.cached.tasks = tasks.cached;

  if (depth === 'tasks') {
    onProgress({ stage: 'done', analysis: snapshot() });
    return analysis;
  }

  // Level 2 — each sub-flow as an integrated whole, deepest tier first.
  onProgress({ stage: 'subflows', analysis: snapshot() });
  const findings = analysis.tasks.findings;

  for (const tier of subFlowTiers(doc)) {
    const results = await Promise.all(
      tier.map((flow) => {
        // Analyses of sub-flows nested inside this one, completed in an earlier tier.
        const childAnalyses = analysis.subFlows.filter((a) =>
          doc.flows.some((f) => f.id === a.flowId && f.parentFlowId === flow.id),
        );
        return analyzeSubFlow(doc, flow, findings, childAnalyses, fresh);
      }),
    );
    for (const r of results) analysis.cached[r.result.flowId] = r.cached;
    analysis.subFlows = [...analysis.subFlows, ...results.map((r) => r.result)];
    onProgress({ stage: 'subflows', analysis: snapshot() });
  }

  if (depth === 'subflows') {
    onProgress({ stage: 'done', analysis: snapshot() });
    return analysis;
  }

  // Level 3 — the entire workflow as one system.
  onProgress({ stage: 'strategic', analysis: snapshot() });
  const strategic = await analyzeStrategic(doc, analysis.tasks, analysis.subFlows, fresh);
  analysis.strategic = strategic.result;
  analysis.cached.strategic = strategic.cached;

  onProgress({ stage: 'done', analysis: snapshot() });
  return analysis;
}

/** Order the sub-flow results the way the flows appear in the document. */
export function orderSubFlows(doc: WorkflowDoc, subFlows: SubFlowAnalysis[]): SubFlowAnalysis[] {
  const order = new Map(doc.flows.map((f, i) => [f.id, i]));
  return [...subFlows].sort(
    (a, b) => (order.get(a.flowId) ?? 0) - (order.get(b.flowId) ?? 0),
  );
}
