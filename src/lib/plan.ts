import { errorMessage, readNdjson } from '@/lib/api';
import type { ChatContext, ChatUsage, PlanEvent, PlanTurn } from '@/types';

/**
 * The Plan workspace's two routes. The context is the same frozen `ChatContext` the chat uses
 * (`buildChatContext()`) — the analysed workflow and its three levels — and is re-sent
 * unchanged every turn, because the server makes it the cached prefix of the thread.
 */

/** Writes the system, tool and workflow prefix to the prompt cache before the first send. */
export async function primePlan(context: ChatContext): Promise<void> {
  const res = await fetch('/api/plan/prime', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ context }),
  });
  if (!res.ok) throw new Error(await errorMessage(res));
}

export interface PlanStreamHandlers {
  onText: (delta: string) => void;
  /** The model is writing the end state; `nodes` is a rough count so far. */
  onDrafting: (nodes: number) => void;
  onRepairing: (errors: string[]) => void;
  /** Finished turns, to append to the history verbatim. */
  onTurns: (turns: PlanTurn[]) => void;
}

/**
 * Streams one reply. Resolves with the reply's usage (summed over the server's tool loop) once
 * it's complete; an in-band error or aborting `signal` rejects, after any `onTurns` that had
 * already arrived.
 */
export async function streamPlan(
  context: ChatContext,
  messages: PlanTurn[],
  handlers: PlanStreamHandlers,
  signal: AbortSignal,
): Promise<ChatUsage> {
  const res = await fetch('/api/plan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ context, messages }),
    signal,
  });

  return readNdjson<PlanEvent, ChatUsage>(res, (event) => {
    switch (event.type) {
      case 'text':
        handlers.onText(event.text);
        return undefined;
      case 'drafting':
        handlers.onDrafting(event.nodes);
        return undefined;
      case 'repairing':
        handlers.onRepairing(event.errors);
        return undefined;
      case 'turns':
        handlers.onTurns(event.turns);
        return undefined;
      case 'error':
        throw new Error(event.error);
      case 'done':
        return event.usage;
    }
  });
}
