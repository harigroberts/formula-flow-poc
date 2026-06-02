import type { AnalysisResult, WorkflowDoc } from '@/types';

export async function analyzeFlow(doc: WorkflowDoc, flowId: string): Promise<AnalysisResult> {
  const flow = doc.flows.find(f => f.id === flowId);
  const nodes = doc.nodes.filter(n => n.flowId === flowId);
  const edges = doc.edges.filter(e => e.flowId === flowId);

  const payload = { flow, nodes, edges };

  const res = await fetch('/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Analysis failed: ${text}`);
  }

  return res.json() as Promise<AnalysisResult>;
}
