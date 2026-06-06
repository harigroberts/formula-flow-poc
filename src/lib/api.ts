import type { AnalysisResult, FlowRefData, WorkflowDoc } from '@/types';

function collectFlowIds(doc: WorkflowDoc, startFlowId: string): string[] {
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

export async function analyzeFlow(doc: WorkflowDoc, flowId: string): Promise<AnalysisResult> {
  const flowIds = collectFlowIds(doc, flowId);
  const flows = doc.flows.filter(f => flowIds.includes(f.id));
  const nodes = doc.nodes.filter(n => flowIds.includes(n.flowId));
  const edges = doc.edges.filter(e => flowIds.includes(e.flowId));

  const payload = { flows, nodes, edges, frequencies: doc.frequencies, personas: doc.personas };

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
