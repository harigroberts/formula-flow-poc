import type { AnalysisResult, WorkflowDoc } from '@/types';

export async function analyzeFlow(doc: WorkflowDoc, flowId: string): Promise<AnalysisResult> {
  const flow = doc.flows.find(f => f.id === flowId);
  const nodes = doc.nodes.filter(n => n.flowId === flowId);
  const edges = doc.edges.filter(e => e.flowId === flowId);

  // Send the org-wide registries so Claude can join tasks → frequency counts /
  // persona capacity and roll savings up into monthly totals + utilisation.
  const payload = { flow, nodes, edges, frequencies: doc.frequencies, personas: doc.personas };

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
