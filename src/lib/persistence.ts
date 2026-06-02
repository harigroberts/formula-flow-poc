import yaml from 'js-yaml';
import type { WorkflowDoc } from '@/types';

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
  return doc;
}
