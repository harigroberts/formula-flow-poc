import { errorMessage, graphPayload } from '@/lib/api';
import { orderSubFlows } from '@/lib/analysisRunner';
import type {
  ChatContext,
  ChatEvent,
  ChatTurn,
  ChatUsage,
  MultiLevelAnalysis,
  WorkflowDoc,
} from '@/types';

/**
 * The frozen context a chat thread is built on. `doc` must be the snapshot the analysis ran
 * against, not the live canvas — the server makes this the cached prefix of every chat turn,
 * so it has to stay put while the user keeps editing. `cached` is dropped: it's UI metadata
 * about where the results came from, not part of the analysis.
 */
export function buildChatContext(doc: WorkflowDoc, analysis: MultiLevelAnalysis): ChatContext {
  return {
    workflow: graphPayload(doc),
    analysis: {
      depth: analysis.depth,
      tasks: analysis.tasks,
      subFlows: orderSubFlows(doc, analysis.subFlows),
      strategic: analysis.strategic,
    },
  };
}

/** Writes the workflow prefix to the prompt cache before the user's first message. */
export async function primeChat(context: ChatContext): Promise<void> {
  const res = await fetch('/api/chat/prime', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ context }),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
}

/**
 * Streams one assistant reply. `onText` gets each delta as it arrives; the promise resolves
 * with the turn's usage once the reply is complete. Aborting `signal` rejects with an
 * `AbortError`.
 */
export async function streamChat(
  context: ChatContext,
  messages: ChatTurn[],
  onText: (delta: string) => void,
  signal: AbortSignal,
): Promise<ChatUsage> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ context, messages }),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(await errorMessage(res));

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  // One JSON event per line; a network chunk can end mid-line, so keep the remainder.
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let newline: number;
    while ((newline = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;

      const event = JSON.parse(line) as ChatEvent;
      if (event.type === 'text') onText(event.text);
      else if (event.type === 'error') throw new Error(event.error);
      else return event.usage;
    }
  }

  throw new Error('The reply ended unexpectedly.');
}
