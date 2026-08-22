import Anthropic from '@anthropic-ai/sdk';
import { SYSTEM_PROMPT } from './prompt';
import type { AnalysisResult } from '../src/types';

const client = new Anthropic();

export async function analyzeWorkflow(payload: unknown): Promise<AnalysisResult> {
  const workflowJson = JSON.stringify(payload, null, 2);

  const response = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 8096,
    system: [
      {
        type: 'text',
        text: SYSTEM_PROMPT,
        // Cache the static system prompt — avoids re-tokenising on repeated calls
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [
      {
        role: 'user',
        content: `Analyse the following workflow and return JSON findings:\n\n${workflowJson}`,
      },
    ],
  });

  const text = response.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as Anthropic.TextBlock).text)
    .join('');

  let parsed: AnalysisResult;
  try {
    parsed = JSON.parse(text) as AnalysisResult;
  } catch {
    // Strip markdown fences if present (closed or truncated)
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonCandidate = fenceMatch
      ? fenceMatch[1]
      : text.match(/```(?:json)?\s*([\s\S]+)/)?.[1] ?? text;
    try {
      parsed = JSON.parse(jsonCandidate) as AnalysisResult;
    } catch {
      throw new Error(`Model returned non-JSON response: ${text.slice(0, 200)}`);
    }
  }

  if (!Array.isArray(parsed.findings) || typeof parsed.summary !== 'string') {
    throw new Error('Unexpected response shape from model');
  }

  return parsed;
}
