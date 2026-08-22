import yaml from 'js-yaml';
import type { WorkflowDoc, FrequencyCategory, Persona, TaskData, FlowRefData } from '@/types';
import { getFlowExits } from './exits';

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * Bring any loaded doc up to the current shape:
 * - guarantees `frequencies` / `personas` arrays exist
 * - migrates legacy free-text `frequency` / `ownerRole` task fields into the
 *   doc-level registries, find-or-creating a category/persona and wiring up the id
 * - binds edges leaving a `flow` node to a named sub-flow exit (`sourceHandle` = the child
 *   flow's `end` node id, `data.exit` = its name), and clears handles that no longer resolve
 * Idempotent — safe to run on already-normalised docs.
 */
export function normalizeDoc(doc: WorkflowDoc): WorkflowDoc {
  const frequencies: FrequencyCategory[] = [...(doc.frequencies ?? [])];
  const personas: Persona[] = [...(doc.personas ?? [])];

  const findOrCreateFrequency = (label: string): string => {
    const existing = frequencies.find((f) => f.label === label);
    if (existing) return existing.id;
    const created: FrequencyCategory = { id: `freq-${uid()}`, label, occurrencesPerMonth: 0 };
    frequencies.push(created);
    return created.id;
  };

  const findOrCreatePersona = (role: string): string => {
    const existing = personas.find((p) => p.role === role);
    if (existing) return existing.id;
    const created: Persona = { id: `persona-${uid()}`, role, workerCount: 1, avgWeeklyHours: 40 };
    personas.push(created);
    return created.id;
  };

  const nodes = doc.nodes.map((node) => {
    if (node.data.type !== 'task') return node;
    const data = node.data as TaskData & { frequency?: string; ownerRole?: string };
    let next = data;
    if (!next.frequencyId && next.frequency) {
      next = { ...next, frequencyId: findOrCreateFrequency(next.frequency) };
    }
    if (!next.personaId && next.ownerRole) {
      next = { ...next, personaId: findOrCreatePersona(next.ownerRole) };
    }
    if (next === data) return node;
    // Drop the legacy string fields now that they've been migrated.
    delete next.frequency;
    delete next.ownerRole;
    return { ...node, data: next };
  });

  // Sub-flow exits: legacy docs have `sourceHandle: null` on every edge leaving a flow node.
  // React Flow falls back to the first source handle in that case, so they still render — this
  // just makes the binding explicit in the stored doc, and repairs handles that no longer exist
  // (old rows pushed in by Supabase realtime).
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const exitCache = new Map<string, ReturnType<typeof getFlowExits>>();
  const docForExits = { ...doc, nodes } as WorkflowDoc;
  const exitsFor = (childFlowId: string) => {
    let cached = exitCache.get(childFlowId);
    if (!cached) {
      cached = getFlowExits(docForExits, childFlowId);
      exitCache.set(childFlowId, cached);
    }
    return cached;
  };

  const edges = (doc.edges ?? []).map((edge) => {
    const source = nodeById.get(edge.source);
    if (source?.data.type !== 'flow') {
      // Only decision branches legitimately carry a non-node handle id.
      if (edge.sourceHandle && edge.sourceHandle !== 'yes' && edge.sourceHandle !== 'no' && !nodeById.has(edge.sourceHandle)) {
        return { ...edge, sourceHandle: undefined };
      }
      return edge;
    }
    const exits = exitsFor((source.data as FlowRefData).childFlowId);
    const bound = edge.sourceHandle ? exits.find((x) => x.id === edge.sourceHandle) : undefined;
    if (bound) {
      return edge.data?.exit === bound.label ? edge : { ...edge, data: { ...edge.data, exit: bound.label } };
    }
    // Either unbound (legacy) or pointing at an end node that has since been deleted.
    const fallback = exits[0];
    if (!fallback) return edge.sourceHandle ? { ...edge, sourceHandle: undefined } : edge;
    return { ...edge, sourceHandle: fallback.id, data: { ...edge.data, exit: fallback.label } };
  });

  return { ...doc, frequencies, personas, nodes, edges };
}

function downloadBlob(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function exportJson(doc: WorkflowDoc) {
  downloadBlob(JSON.stringify(doc, null, 2), 'workflow.json', 'application/json');
}

export function exportYaml(doc: WorkflowDoc) {
  downloadBlob(yaml.dump(doc), 'workflow.yaml', 'text/yaml');
}

export async function importFile(file: File): Promise<WorkflowDoc> {
  const text = await file.text();
  const ext = file.name.split('.').pop()?.toLowerCase();
  let parsed: unknown;
  if (ext === 'yaml' || ext === 'yml') {
    parsed = yaml.load(text);
  } else {
    parsed = JSON.parse(text);
  }
  // minimal validation
  const doc = parsed as WorkflowDoc;
  if (!doc.version || !doc.rootFlowId || !Array.isArray(doc.flows)) {
    throw new Error('Invalid workflow file format');
  }
  return normalizeDoc(doc);
}
