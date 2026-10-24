import type { WorkflowDoc } from '@/types';
import config from '../../workflows.config.json';
import { customerOnboarding } from './customerOnboarding';
import { dalcourMaclarenLandProperty } from './dalcourMaclarenLandProperty';

/**
 * A workflow the app can open with. `id` is the name `workflows.config.json` (and the
 * `?workflow=` URL parameter) use to pick it; add a new one by appending to `workflowPresets`.
 */
export interface WorkflowPreset {
  id: string;
  label: string;
  doc: WorkflowDoc;
}

export const workflowPresets: WorkflowPreset[] = [
  { id: 'customer-onboarding', label: 'Customer Onboarding (ACME Ltd)', doc: customerOnboarding },
  { id: 'dalcour-maclaren-land-property', label: 'Land & Property (Dalcour Maclaren)', doc: dalcourMaclarenLandProperty },
];

/**
 * The preset the app opens with: `?workflow=<id>` if given, else `defaultWorkflow` from
 * `workflows.config.json`. An unknown id warns and falls back to the first preset rather than
 * opening an empty canvas.
 */
export function defaultWorkflow(): WorkflowPreset {
  const fromUrl = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('workflow');
  const requested = fromUrl ?? config.defaultWorkflow;
  const preset = workflowPresets.find(p => p.id === requested);
  if (preset) return preset;
  console.warn(
    `Unknown workflow "${requested}" (known: ${workflowPresets.map(p => p.id).join(', ')}); opening "${workflowPresets[0].id}".`
  );
  return workflowPresets[0];
}
