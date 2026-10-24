import Anthropic from '@anthropic-ai/sdk';
import { SHARED_CONTEXT } from './prompts/shared';
import { TASK_PROMPT } from './prompts/task';
import { SUBFLOW_PROMPT } from './prompts/subflow';
import { STRATEGIC_PROMPT } from './prompts/strategic';
import { SUBFLOW_SCHEMA, STRATEGIC_SCHEMA } from './schemas';
import { sha256, type CacheLevel } from './cache';
import type { AnalysisResult, StrategicAnalysis, SubFlowAnalysis } from '../src/types';

export const client = new Anthropic();

/** Level 1 — high volume, node-by-node. Cheap and fast. */
const TASK_MODEL = 'claude-haiku-4-5';
/**
 * DEBUG: run levels 2 & 3, the chat and the plan on Haiku as well — cheap and fast while
 * debugging. Set to `false` to put them back on Opus 5.
 */
const DEBUG_ALL_HAIKU = true;
/** Levels 2 & 3 — integrative reasoning over a whole graph. Worth the stronger model. */
export const INTEGRATION_MODEL = DEBUG_ALL_HAIKU ? TASK_MODEL : 'claude-opus-5';
if (DEBUG_ALL_HAIKU) console.warn(`[models] DEBUG_ALL_HAIKU is on — analysis, chat and plan all run on ${TASK_MODEL}`);

/*
 * The Opus-only request params. Haiku 4.5 rejects adaptive thinking and `effort` with a 400, and
 * the server-side refusal fallback is for the Opus/Fable safety classifiers, so on Haiku all
 * three are left out (no thinking at all) and these spread to nothing.
 */
export const INTEGRATION_THINKING = DEBUG_ALL_HAIKU ? {} : { thinking: { type: 'adaptive' as const } };
export function integrationEffort(effort: 'medium' | 'high') {
  return DEBUG_ALL_HAIKU ? {} : { effort };
}
export const INTEGRATION_FALLBACK = DEBUG_ALL_HAIKU
  ? {}
  : { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const };

/**
 * Two cache breakpoints: the shared context is identical across every level, so the
 * two Opus passes (and the N sub-flow calls) share a cached prefix. The Haiku pass
 * caches separately — the cache is per-model.
 */
function systemBlocks(levelPrompt: string): Anthropic.TextBlockParam[] {
  return [
    { type: 'text', text: SHARED_CONTEXT, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: levelPrompt, cache_control: { type: 'ephemeral' } },
  ];
}

/** Structural, so both `Anthropic.Usage` and the beta namespace's `BetaUsage` fit. */
interface UsageLike {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

export function logUsage(label: string, usage: UsageLike, scope = 'analyze') {
  console.log(
    `[${scope}:${label}] in=${usage.input_tokens} out=${usage.output_tokens} ` +
      `cache_read=${usage.cache_read_input_tokens ?? 0} cache_write=${usage.cache_creation_input_tokens ?? 0}`,
  );
}

function textOf(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

/**
 * Strict JSON schemas require every property to be `required`, so optional fields are
 * declared nullable and come back as explicit nulls. Drop them to get the `field?: T`
 * shape the TypeScript types describe.
 */
function stripNulls<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(stripNulls) as unknown as T;
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (v !== null) out[k] = stripNulls(v);
    }
    return out as T;
  }
  return value;
}

/**
 * Parse the model's JSON reply. Structured outputs make this a plain parse, but the
 * fence-stripping fallback stays for the task pass (which is prompt-instructed only)
 * and as a safety net.
 */
function parseJson<T>(text: string, validate: (v: unknown) => boolean): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Strip markdown fences if present (closed or truncated)
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonCandidate = fenceMatch
      ? fenceMatch[1]
      : text.match(/```(?:json)?\s*([\s\S]+)/)?.[1] ?? text;
    try {
      parsed = JSON.parse(jsonCandidate);
    } catch {
      throw new Error(`Model returned non-JSON response: ${text.slice(0, 200)}`);
    }
  }

  if (!validate(parsed)) {
    throw new Error('Unexpected response shape from model');
  }
  return parsed as T;
}

/**
 * Levels 2 & 3 share this call shape: Opus with adaptive thinking, a JSON schema to
 * constrain the output, and streaming (thinking tokens count toward `max_tokens`, so a
 * non-streamed request this large risks an HTTP timeout).
 */
async function callIntegrationModel(
  label: string,
  levelPrompt: string,
  schema: Record<string, unknown>,
  payload: unknown,
  userPrefix: string,
): Promise<string> {
  const stream = client.messages.stream({
    model: INTEGRATION_MODEL,
    max_tokens: 32000,
    ...INTEGRATION_THINKING,
    output_config: {
      ...integrationEffort('high'),
      format: { type: 'json_schema', schema },
    },
    system: systemBlocks(levelPrompt),
    messages: [
      {
        role: 'user',
        content: `${userPrefix}\n\n${JSON.stringify(payload)}`,
      },
    ],
  });

  const response = await stream.finalMessage();
  logUsage(label, response.usage);

  if (response.stop_reason === 'max_tokens') {
    throw new Error(`${label} analysis was truncated — the response exceeded max_tokens.`);
  }
  if (response.stop_reason === 'refusal') {
    throw new Error(`${label} analysis was declined by the model.`);
  }

  return textOf(response.content);
}

/**
 * Level 1 — per-node findings across the whole document. One finding per task/decision, so
 * the reply grows with the workflow: a 40-node doc runs past 8K tokens. Streamed for the same
 * reason as levels 2 & 3 — a non-streamed request this large risks an HTTP timeout.
 */
export async function analyzeTasks(payload: unknown): Promise<AnalysisResult> {
  const stream = client.messages.stream({
    model: TASK_MODEL,
    max_tokens: 32000,
    system: systemBlocks(TASK_PROMPT),
    messages: [
      {
        role: 'user',
        content: `Analyse the following workflow and return JSON findings:\n\n${JSON.stringify(payload, null, 2)}`,
      },
    ],
  });

  const response = await stream.finalMessage();
  logUsage('tasks', response.usage);

  if (response.stop_reason === 'max_tokens') {
    throw new Error('tasks analysis was truncated — the response exceeded max_tokens.');
  }
  if (response.stop_reason === 'refusal') {
    throw new Error('tasks analysis was declined by the model.');
  }

  return parseJson<AnalysisResult>(
    textOf(response.content),
    (v): boolean => {
      const r = v as AnalysisResult;
      return Array.isArray(r?.findings) && typeof r?.summary === 'string';
    },
  );
}

/** Level 2 — one sub-flow reviewed as an integrated whole. */
export async function analyzeSubFlow(payload: unknown): Promise<SubFlowAnalysis> {
  const text = await callIntegrationModel(
    'subflow',
    SUBFLOW_PROMPT,
    SUBFLOW_SCHEMA,
    payload,
    'Analyse the following sub-flow as an integrated whole and return JSON:',
  );

  return stripNulls(
    parseJson<SubFlowAnalysis>(text, (v): boolean => {
      const r = v as SubFlowAnalysis;
      return typeof r?.improvesOnTaskLevel === 'boolean' && typeof r?.verdict === 'string';
    }),
  );
}

/** Level 3 — the entire workflow reviewed as one system. */
export async function analyzeStrategic(payload: unknown): Promise<StrategicAnalysis> {
  const text = await callIntegrationModel(
    'strategic',
    STRATEGIC_PROMPT,
    STRATEGIC_SCHEMA,
    payload,
    'Analyse the following workflow at the strategic level and return JSON:',
  );

  return stripNulls(
    parseJson<StrategicAnalysis>(text, (v): boolean => {
      const r = v as StrategicAnalysis;
      return (
        typeof r?.improvesOnLowerLevels === 'boolean' &&
        typeof r?.verdict === 'string' &&
        Array.isArray(r?.initiatives)
      );
    }),
  );
}

/**
 * Everything the cache needs to know about a level, so `index.ts` doesn't have to re-derive
 * which model and prompt each route uses. `promptHash` covers the shared context, the level
 * prompt and the output schema, so editing any of them invalidates that level's cache entries.
 */
export const LEVELS: Record<
  CacheLevel,
  { model: string; promptHash: string; run: (payload: unknown) => Promise<unknown> }
> = {
  tasks: {
    model: TASK_MODEL,
    promptHash: sha256(`${SHARED_CONTEXT}\0${TASK_PROMPT}`),
    run: analyzeTasks,
  },
  subflow: {
    model: INTEGRATION_MODEL,
    promptHash: sha256(`${SHARED_CONTEXT}\0${SUBFLOW_PROMPT}\0${JSON.stringify(SUBFLOW_SCHEMA)}`),
    run: analyzeSubFlow,
  },
  strategic: {
    model: INTEGRATION_MODEL,
    promptHash: sha256(
      `${SHARED_CONTEXT}\0${STRATEGIC_PROMPT}\0${JSON.stringify(STRATEGIC_SCHEMA)}`,
    ),
    run: analyzeStrategic,
  },
};
