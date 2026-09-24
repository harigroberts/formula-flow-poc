import { supabase } from '@/lib/supabase';
import { canonical } from '@/lib/canonical';
import type { ChatContext, ChatMessage, ConversationSummary } from '@/types';

/**
 * Saved chat conversations, one project per sync ID (`chat_conversations.workflow_id` →
 * `workflows.id`). Written straight from the browser, like the `workflows` sync — the server
 * stays a stateless chat proxy.
 */

/**
 * Fingerprint of the workflow a chat is about: sha256 of the same canonical JSON the server
 * puts in the chat's cached workflow turn. Canvas geometry is already slimmed out of
 * `graphPayload()`, so moving a node leaves it unchanged; editing any node, edge or registry
 * value changes it. Equal hashes mean byte-identical workflow turns, so every matching
 * conversation shares that part of the prompt cache.
 */
export async function workflowHash(workflow: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(canonical(workflow)));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

interface SummaryRow {
  id: string;
  title: string;
  workflow_hash: string;
  updated_at: string;
}

const toSummary = (row: SummaryRow): ConversationSummary => ({
  id: row.id,
  title: row.title,
  workflowHash: row.workflow_hash,
  updatedAt: row.updated_at,
});

/** Newest first. Only the light columns — context and messages load when one is opened. */
export async function listConversations(projectId: string): Promise<ConversationSummary[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('chat_conversations')
    .select('id, title, workflow_hash, updated_at')
    .eq('workflow_id', projectId)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data as SummaryRow[]).map(toSummary);
}

export async function loadConversation(
  id: string,
): Promise<{ context: ChatContext; messages: ChatMessage[] }> {
  if (!supabase) throw new Error('Supabase is not configured');
  const { data, error } = await supabase
    .from('chat_conversations')
    .select('context, messages')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data as { context: ChatContext; messages: ChatMessage[] };
}

/** Inserts the row on a conversation's first saved turn, carrying the context it's built on. */
export async function createConversation(row: {
  id: string;
  projectId: string;
  workflowHash: string;
  title: string;
  context: ChatContext;
  messages: ChatMessage[];
}): Promise<ConversationSummary> {
  if (!supabase) throw new Error('Supabase is not configured');
  const { data, error } = await supabase
    .from('chat_conversations')
    .insert({
      id: row.id,
      workflow_id: row.projectId,
      workflow_hash: row.workflowHash,
      title: row.title,
      context: row.context,
      messages: row.messages,
    })
    .select('id, title, workflow_hash, updated_at')
    .single();
  if (error) throw error;
  return toSummary(data as SummaryRow);
}

/**
 * Every later turn rewrites only `messages` — the context never changes after the insert.
 * `updated_at` is bumped by the `trg_chat_conversations_updated_at` trigger.
 */
export async function saveMessages(
  id: string,
  messages: ChatMessage[],
): Promise<ConversationSummary> {
  if (!supabase) throw new Error('Supabase is not configured');
  const { data, error } = await supabase
    .from('chat_conversations')
    .update({ messages })
    .eq('id', id)
    .select('id, title, workflow_hash, updated_at')
    .single();
  if (error) throw error;
  return toSummary(data as SummaryRow);
}
