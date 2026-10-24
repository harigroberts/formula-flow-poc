import type Anthropic from '@anthropic-ai/sdk';
import type { Response } from 'express';
import { client, INTEGRATION_FALLBACK, INTEGRATION_MODEL, INTEGRATION_THINKING, integrationEffort, logUsage } from './analyze';
import { CHAT_CACHE, analysisTurn, workflowTurn } from './chat';
import { canonical } from '../src/lib/canonical';
import {
  PROPOSE_TOOL,
  normalizeProposal,
  validateEndState,
  type OriginalGraph,
} from '../src/lib/endState';
import { SHARED_CONTEXT } from './prompts/shared';
import { PLAN_PROMPT } from './prompts/plan';
import { END_STATE_SCHEMA } from './schemas';
import type { ChatContext, ChatUsage, PlanBlock, PlanEvent, PlanTurn } from '../src/types';

/**
 * The Plan workspace thread: from the customer's decision to an implementation plan and the
 * end-state workflow it produces. Laid out like the chat (`server/chat.ts`), with a tool:
 *
 *   tools      propose_end_state
 *   system     SHARED_CONTEXT, PLAN_PROMPT ◆            ◆ = CHAT_CACHE (1h)
 *   user       the workflow snapshot (JSON) ◆           ← written by `primePlan`
 *   assistant  the three-level analysis (JSON) ◆        ← written on the first turn
 *   user / assistant / tool_result …                    ← append-only, replayed verbatim
 *   last message ◆                                      ← moving tail
 *
 * Tools render before the system, so the system's marker caches them too — and the tool list
 * is part of the prefix, which is why this thread can't share the chat's cache entry.
 *
 * The tool loop runs here, inside one request: when the model proposes an end state, it is
 * validated, the result goes back as a tool_result (an error to fix, or "shown"), and the model
 * finishes its turn. The client therefore only ever sends a history that ends on its own user
 * message — never an open tool call — and gets back finished turns to append.
 */

/** Same model as levels 2 & 3 and the chat: integrative reasoning over the whole analysis. */
const PLAN_MODEL = INTEGRATION_MODEL;
/**
 * The plan is the deliverable, so above the chat's `medium`. Constant for the whole thread —
 * changing it would invalidate the cached messages.
 */
const PLAN_EFFORT = 'high';
/** A failed validation goes back to the model this many times before giving up. */
const MAX_REPAIRS = 2;
/** Model calls per request: the reply, up to MAX_REPAIRS fixes, and the closing sentence. */
const MAX_CALLS = MAX_REPAIRS + 3;

const TOOL: Anthropic.Beta.BetaTool = {
  name: PROPOSE_TOOL,
  description:
    'Show the consultant the end-state workflow: the workflow as it will run once the plan has been delivered. ' +
    'Call it once per proposal, after writing the plan text, with the complete end state — every flow, node and edge, ' +
    'unchanged ones included. It renders as a diagram beside the original.',
  input_schema: END_STATE_SCHEMA as Anthropic.Beta.BetaTool.InputSchema,
  // Not `strict`: the schema has more optional fields than strict mode's 16-union limit allows
  // (see server/schemas.ts). The end state can also run to thousands of tokens, so it streams
  // rather than arriving in one burst. Either way the API doesn't validate the input —
  // `validateEndState` does, and a failure goes back to the model to fix.
  eager_input_streaming: true,
};

const SYSTEM: Anthropic.Beta.BetaTextBlockParam[] = [
  { type: 'text', text: SHARED_CONTEXT },
  { type: 'text', text: PLAN_PROMPT, cache_control: CHAT_CACHE },
];

const BASE = {
  model: PLAN_MODEL,
  ...INTEGRATION_THINKING,
  output_config: integrationEffort(PLAN_EFFORT),
  system: SYSTEM,
  tools: [TOOL],
  ...INTEGRATION_FALLBACK,
} satisfies Omit<Anthropic.Beta.Messages.MessageCreateParamsNonStreaming, 'max_tokens' | 'messages'>;

/**
 * A stored block back into the request. `canonical()` on the tool input keeps its bytes stable
 * however the client stored it (a jsonb round trip reorders keys).
 */
function toParam(block: PlanBlock): Anthropic.Beta.BetaContentBlockParam {
  switch (block.type) {
    case 'text':
      return { type: 'text', text: block.text };
    case 'tool_use':
      return { type: 'tool_use', id: block.id, name: block.name, input: canonical(block.input) };
    case 'tool_result':
      return {
        type: 'tool_result',
        tool_use_id: block.tool_use_id,
        content: block.content,
        ...(block.is_error && { is_error: true }),
      };
  }
}

function toMessage(turn: PlanTurn): Anthropic.Beta.BetaMessageParam {
  return { role: turn.role, content: turn.content.map(toParam) };
}

/** Moves the tail breakpoint onto the last block of the last message — the fourth of four. */
function withTail(messages: Anthropic.Beta.BetaMessageParam[]): Anthropic.Beta.BetaMessageParam[] {
  const last = messages[messages.length - 1];
  const content = last.content as Anthropic.Beta.BetaContentBlockParam[];
  const tail = { ...content[content.length - 1], cache_control: CHAT_CACHE } as Anthropic.Beta.BetaContentBlockParam;
  return [...messages.slice(0, -1), { ...last, content: [...content.slice(0, -1), tail] }];
}

/** What the client keeps of a reply: text and tool calls. Thinking is never stored. */
function keptBlocks(content: Anthropic.Beta.BetaContentBlock[]): PlanBlock[] {
  const out: PlanBlock[] = [];
  for (const b of content) {
    if (b.type === 'text' && b.text.trim()) out.push({ type: 'text', text: b.text });
    if (b.type === 'tool_use') {
      out.push({ type: 'tool_use', id: b.id, name: b.name, input: b.input as never });
    }
  }
  return out;
}

/** Writes the system, tool and workflow prefix before the user has typed anything. */
export async function primePlan(ctx: ChatContext): Promise<void> {
  const response = await client.beta.messages.create({
    ...BASE,
    max_tokens: 0,
    messages: [workflowTurn(ctx)],
  });
  logUsage('prime', response.usage, 'plan');
}

function send(res: Response, event: PlanEvent) {
  res.write(`${JSON.stringify(event)}\n`);
}

/**
 * Streams one reply as newline-delimited JSON (`PlanEvent`), running the tool loop described
 * above. Each model call's finished turns go out as a `turns` event as soon as they're known,
 * so a reply stopped partway still leaves a valid history behind.
 */
export async function streamPlan(ctx: ChatContext, history: PlanTurn[], res: Response) {
  res.status(200).set({
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-cache',
  });
  res.flushHeaders();

  const original = ctx.workflow as OriginalGraph;
  let messages = [workflowTurn(ctx), analysisTurn(ctx), ...history.map(toMessage)];
  const usage: ChatUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  let current: ReturnType<typeof client.beta.messages.stream> | null = null;
  let closed = false;

  // The Stop button closes the connection — stop generating (and billing) when it does.
  res.on('close', () => {
    if (res.writableEnded) return;
    closed = true;
    console.log('[plan] client disconnected — aborting');
    current?.abort();
  });

  let repairs = 0;
  try {
    for (let call = 0; call < MAX_CALLS && !closed; call++) {
      const stream = client.beta.messages.stream({
        ...BASE,
        max_tokens: 64000,
        messages: withTail(messages),
      });
      current = stream;

      let drafted = -1;
      stream.on('text', (text) => send(res, { type: 'text', text }));
      stream.on('streamEvent', (event) => {
        if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
          drafted = 0;
          send(res, { type: 'drafting', nodes: 0 });
        }
      });
      stream.on('inputJson', (_delta, snapshot) => {
        const count = (snapshot as { nodes?: unknown[] } | undefined)?.nodes?.length ?? 0;
        if (count !== drafted) {
          drafted = count;
          send(res, { type: 'drafting', nodes: count });
        }
      });

      const message = await stream.finalMessage();
      logUsage(call === 0 ? 'turn' : `turn+${call}`, message.usage, 'plan');
      usage.input += message.usage.input_tokens;
      usage.output += message.usage.output_tokens;
      usage.cacheRead += message.usage.cache_read_input_tokens ?? 0;
      usage.cacheWrite += message.usage.cache_creation_input_tokens ?? 0;

      if (message.stop_reason === 'refusal') {
        send(res, { type: 'error', error: 'The model declined to continue this plan.' });
        res.end();
        return;
      }

      let blocks = keptBlocks(message.content);
      const toolUses = blocks.filter((b) => b.type === 'tool_use');

      if (message.stop_reason !== 'tool_use' || toolUses.length === 0) {
        // A reply cut off mid-proposal leaves a half-written tool call — drop it.
        if (message.stop_reason === 'max_tokens') {
          blocks = [
            ...blocks.filter((b) => b.type === 'text'),
            { type: 'text', text: '[Reply cut off — it reached the length limit.]' },
          ];
        }
        if (blocks.length === 0) blocks = [{ type: 'text', text: '[No reply.]' }];
        send(res, { type: 'turns', turns: [{ role: 'assistant', content: blocks }] });
        send(res, { type: 'done', stopReason: message.stop_reason, usage });
        res.end();
        return;
      }

      const results: PlanBlock[] = toolUses.map((tu) => {
        if (tu.name !== PROPOSE_TOOL) {
          return { type: 'tool_result', tool_use_id: tu.id, content: `Unknown tool "${tu.name}".`, is_error: true };
        }
        const errors = validateEndState(normalizeProposal(tu.input), original);
        if (errors.length === 0) {
          return {
            type: 'tool_result',
            tool_use_id: tu.id,
            content: 'Shown to the consultant as the end-state diagram. Close with a sentence or two — do not repeat the plan.',
          };
        }
        send(res, { type: 'repairing', errors });
        return {
          type: 'tool_result',
          tool_use_id: tu.id,
          content:
            `The end state is invalid and was not shown:\n${errors.map((e) => `- ${e}`).join('\n')}\n` +
            'Fix every error and call propose_end_state again with the complete, corrected end state.',
          is_error: true,
        };
      });
      const failed = results.some((r) => r.type === 'tool_result' && r.is_error);
      if (failed) repairs++;

      // Out of attempts: keep the reply's text, drop the call that couldn't be shown, so the
      // history still ends on a finished assistant turn.
      if (repairs > MAX_REPAIRS || call === MAX_CALLS - 1) {
        const text = blocks.filter((b) => b.type === 'text');
        send(res, {
          type: 'turns',
          turns: [
            {
              role: 'assistant',
              content: [
                ...text,
                { type: 'text', text: '[The end-state diagram could not be produced — ask me to try again.]' },
              ],
            },
          ],
        });
        send(res, {
          type: 'error',
          error: failed
            ? 'The proposed end state kept failing validation, so it wasn’t shown.'
            : 'The plan took too many steps to finish.',
        });
        res.end();
        return;
      }

      const resultTurn: PlanTurn = { role: 'user', content: results };
      send(res, { type: 'turns', turns: [{ role: 'assistant', content: blocks }, resultTurn] });

      // The tool loop is still open, so this turn goes back exactly as it came — thinking
      // blocks included. Once the loop closes, the stored (thinking-free) form replaces it.
      messages = [
        ...messages,
        { role: 'assistant', content: message.content as Anthropic.Beta.BetaContentBlockParam[] },
        toMessage(resultTurn),
      ];
    }
  } catch (err) {
    if (closed) return;
    console.error('[plan]', err);
    send(res, { type: 'error', error: err instanceof Error ? err.message : 'Plan failed' });
  }
  res.end();
}
