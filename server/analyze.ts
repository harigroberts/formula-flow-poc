import Anthropic from '@anthropic-ai/sdk';
import { SYSTEM_PROMPT } from './prompt';
import type { AnalysisResult } from '../src/types';

const client = new Anthropic();

export async function analyzeWorkflow(payload: unknown): Promise<AnalysisResult> {
  const workflowJson = JSON.stringify(payload, null, 2);

  const response = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 3072,
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
    // If the model returned markdown-fenced JSON, strip the fences
    const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) {
      parsed = JSON.parse(match[1]) as AnalysisResult;
    } else {
      throw new Error(`Model returned non-JSON response: ${text.slice(0, 200)}`);
    }
  }

  if (!Array.isArray(parsed.findings) || typeof parsed.summary !== 'string') {
    throw new Error('Unexpected response shape from model');
  }

  return parsed;
}
