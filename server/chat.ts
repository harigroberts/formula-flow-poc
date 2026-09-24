import type Anthropic from '@anthropic-ai/sdk';
import type { Response } from 'express';
import { client, INTEGRATION_MODEL, logUsage } from './analyze';
import { canonical } from '../src/lib/canonical';
import { SHARED_CONTEXT } from './prompts/shared';
import { CHAT_PROMPT } from './prompts/chat';
import type { ChatContext, ChatEvent, ChatTurn } from '../src/types';

/**
 * Chat about the three-level analysis, as one prompt-cached thread:
 *
 *   system     SHARED_CONTEXT, CHAT_PROMPT ◆
 *   user       the workflow snapshot (JSON) ◆       ← written by `primeChat`, before any chat input
 *   assistant  the three-level analysis (JSON) ◆    ← written on the first chat turn
 *   user / assistant …                              ← the conversation, text only, append-only
 *   user       the latest message ◆                 ← moving tail
 *
 * That's the full four-breakpoint budget, which is why the system gets one marker rather than
 * the two `systemBlocks()` uses. The analysis turn can't be cached by the prime call: Opus 5
 * rejects a request that ends on an assistant turn, so it only joins the cached prefix once a
 * user message follows it.
 *
 * Every read depends on the prefix being byte-identical across calls, so everything that
 * renders into it is pinned here, shared by both calls, and never varied per request.
 */

/** Same model as levels 2 & 3 — this is integrative reasoning over the whole analysis. */
const CHAT_MODEL = INTEGRATION_MODEL;
/**
 * Below the analysis passes' `high`: the heavy reasoning has already been done and is sitting
 * in the context, and chat latency is user-visible. Changing it invalidates the cached thread.
 */
const CHAT_EFFORT = 'medium';
/** A person reads the analysis and then replies — the gap between turns often exceeds 5 minutes. */
const CHAT_CACHE: Anthropic.Beta.BetaCacheControlEphemeral = { type: 'ephemeral', ttl: '1h' };

const SYSTEM: Anthropic.Beta.BetaTextBlockParam[] = [
  { type: 'text', text: SHARED_CONTEXT },
  { type: 'text', text: CHAT_PROMPT, cache_control: CHAT_CACHE },
];

const BASE = {
  model: CHAT_MODEL,
  thinking: { type: 'adaptive' },
  output_config: { effort: CHAT_EFFORT },
  system: SYSTEM,
  // On a safety-classifier decline, the API re-runs the turn on a fallback model inside the
  // same call. That turn misses the cache (it's per-model), which is fine for a rare event.
  betas: ['server-side-fallback-2026-07-01'],
  fallbacks: 'default',
} satisfies Omit<Anthropic.Beta.Messages.MessageCreateParamsNonStreaming, 'max_tokens' | 'messages'>;

/**
 * The two context turns. `canonical()` sorts keys so the bytes don't depend on how the
 * client happened to build the object.
 */
function workflowTurn(ctx: ChatContext): Anthropic.Beta.BetaMessageParam {
  return {
    role: 'user',
    content: [
      {
        type: 'text',
        text: `Here is the workflow you analysed:\n\n${JSON.stringify(canonical(ctx.workflow))}`,
        cache_control: CHAT_CACHE,
      },
    ],
  };
}

function analysisTurn(ctx: ChatContext): Anthropic.Beta.BetaMessageParam {
  return {
    role: 'assistant',
    content: [
      {
        type: 'text',
        text: `Here is my analysis at all three levels:\n\n${JSON.stringify(canonical(ctx.analysis))}`,
        cache_control: CHAT_CACHE,
      },
    ],
  };
}

function historyTurns(history: ChatTurn[]): Anthropic.Beta.BetaMessageParam[] {
  return history.map((turn, i) =>
    i === history.length - 1
      ? {
          role: turn.role,
          content: [{ type: 'text', text: turn.content, cache_control: CHAT_CACHE }],
        }
      : { role: turn.role, content: turn.content },
  );
}

/**
 * Writes the system + workflow prefix before the user has typed anything. `max_tokens: 0`
 * runs prefill only — no output, no output tokens billed — and can't be streamed.
 */
export async function primeChat(ctx: ChatContext): Promise<void> {
  const response = await client.beta.messages.create({
    ...BASE,
    max_tokens: 0,
    messages: [workflowTurn(ctx)],
  });
  logUsage('prime', response.usage, 'chat');
}

function send(res: Response, event: ChatEvent) {
  res.write(`${JSON.stringify(event)}\n`);
}

/**
 * Streams one assistant reply as newline-delimited JSON (`ChatEvent`). Headers go out before
 * the model is called, so any error after that point travels in-band as an `error` event.
 */
export async function streamChat(ctx: ChatContext, history: ChatTurn[], res: Response) {
  res.status(200).set({
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-cache',
  });
  res.flushHeaders();

  const stream = client.beta.messages.stream({
    ...BASE,
    max_tokens: 16000,
    messages: [workflowTurn(ctx), analysisTurn(ctx), ...historyTurns(history)],
  });

  // The Stop button closes the connection — stop generating (and billing) when it does.
  res.on('close', () => {
    if (!res.writableEnded) {
      console.log('[chat] client disconnected — aborting');
      stream.abort();
    }
  });

  stream.on('text', (text) => send(res, { type: 'text', text }));

  try {
    const message = await stream.finalMessage();
    logUsage('turn', message.usage, 'chat');

    if (message.stop_reason === 'refusal') {
      send(res, { type: 'error', error: 'The model declined to answer that message.' });
    } else {
      if (message.stop_reason === 'max_tokens') {
        send(res, { type: 'text', text: '\n\n[Reply cut off — it reached the length limit.]' });
      }
      send(res, {
        type: 'done',
        stopReason: message.stop_reason,
        usage: {
          input: message.usage.input_tokens,
          output: message.usage.output_tokens,
          cacheRead: message.usage.cache_read_input_tokens ?? 0,
          cacheWrite: message.usage.cache_creation_input_tokens ?? 0,
        },
      });
    }
  } catch (err) {
    if (stream.aborted) return;
    console.error('[chat]', err);
    send(res, { type: 'error', error: err instanceof Error ? err.message : 'Chat failed' });
  }
  res.end();
}
