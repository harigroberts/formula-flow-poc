import { supabase } from '@/lib/supabase';
import type {
  ChatContext,
  PlanExchange,
  PlanSessionSummary,
  SelectionState,
  WorkflowDoc,
} from '@/types';

/**
 * Saved Plan workspace sessions, one project per sync ID (`plan_sessions.workflow_id` →
 * `workflows.id`). Written straight from the browser, like `conversations.ts`; the fingerprint
 * that decides "same workflow" is the same `workflowHash()`.
 */

interface SummaryRow {
  id: string;
  title: string;
  plan_title: string | null;
  workflow_hash: string;
  updated_at: string;
}

const SUMMARY = 'id, title, plan_title, workflow_hash, updated_at';

const toSummary = (row: SummaryRow): PlanSessionSummary => ({
  id: row.id,
  title: row.title,
  planTitle: row.plan_title,
  workflowHash: row.workflow_hash,
  updatedAt: row.updated_at,
});

export interface StoredPlanSession {
  context: ChatContext;
  /** The full analysed doc — `context.workflow` has no positions, and both views need them. */
  sourceDoc: WorkflowDoc;
  selection: SelectionState;
  exchanges: PlanExchange[];
}

/** Newest first. Only the light columns — the rest loads when one is opened. */
export async function listPlanSessions(projectId: string): Promise<PlanSessionSummary[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('plan_sessions')
    .select(SUMMARY)
    .eq('workflow_id', projectId)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data as SummaryRow[]).map(toSummary);
}

export async function loadPlanSession(id: string): Promise<StoredPlanSession> {
  if (!supabase) throw new Error('Supabase is not configured');
  const { data, error } = await supabase
    .from('plan_sessions')
    .select('context, source_doc, selection, exchanges')
    .eq('id', id)
    .single();
  if (error) throw error;
  const row = data as {
    context: ChatContext;
    source_doc: WorkflowDoc;
    selection: SelectionState;
    exchanges: PlanExchange[];
  };
  return {
    context: row.context,
    sourceDoc: row.source_doc,
    selection: row.selection ?? {},
    exchanges: row.exchanges ?? [],
  };
}

/** Inserts the row on a session's first saved reply, carrying everything it's built on. */
export async function createPlanSession(
  row: StoredPlanSession & {
    id: string;
    projectId: string;
    workflowHash: string;
    title: string;
    planTitle: string | null;
  },
): Promise<PlanSessionSummary> {
  if (!supabase) throw new Error('Supabase is not configured');
  const { data, error } = await supabase
    .from('plan_sessions')
    .insert({
      id: row.id,
      workflow_id: row.projectId,
      workflow_hash: row.workflowHash,
      title: row.title,
      plan_title: row.planTitle,
      context: row.context,
      source_doc: row.sourceDoc,
      selection: row.selection,
      exchanges: row.exchanges,
    })
    .select(SUMMARY)
    .single();
  if (error) throw error;
  return toSummary(data as SummaryRow);
}

/**
 * Later saves rewrite only what changes: the exchanges after a reply, the selection as the
 * user ticks and annotates. `updated_at` is bumped by the table's trigger.
 */
export async function savePlanSession(
  id: string,
  patch: { exchanges?: PlanExchange[]; selection?: SelectionState; planTitle?: string | null },
): Promise<PlanSessionSummary> {
  if (!supabase) throw new Error('Supabase is not configured');
  const { data, error } = await supabase
    .from('plan_sessions')
    .update({
      ...(patch.exchanges && { exchanges: patch.exchanges }),
      ...(patch.selection && { selection: patch.selection }),
      ...(patch.planTitle !== undefined && { plan_title: patch.planTitle }),
    })
    .eq('id', id)
    .select(SUMMARY)
    .single();
  if (error) throw error;
  return toSummary(data as SummaryRow);
}
