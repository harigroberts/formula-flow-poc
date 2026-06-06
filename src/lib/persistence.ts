import yaml from 'js-yaml';
import type { WorkflowDoc, FrequencyCategory, Persona, TaskData } from '@/types';

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * Bring any loaded doc up to the current shape:
 * - guarantees `frequencies` / `personas` arrays exist
 * - migrates legacy free-text `frequency` / `ownerRole` task fields into the
 *   doc-level registries, find-or-creating a category/persona and wiring up the id
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

  return { ...doc, frequencies, personas, nodes };
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
