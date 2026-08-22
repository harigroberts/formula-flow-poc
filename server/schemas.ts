/**
 * JSON schemas for the level-2 and level-3 structured outputs.
 *
 * Strict schema validation requires every property to be listed in `required` and
 * `additionalProperties: false`, so genuinely optional fields are typed as nullable
 * and the nulls are stripped after parsing (see `stripNulls` in `analyze.ts`) to get
 * back to the `field?: T` shape the TypeScript types describe.
 */

const CONFIDENCE = { type: 'string', enum: ['high', 'medium', 'low'] } as const;

const nullable = (type: string) => ({ type: [type, 'null'] });
const nullableArray = (itemType: string) => ({
  type: ['array', 'null'],
  items: { type: itemType },
});

export const SUBFLOW_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: [
    'flowId',
    'flowName',
    'improvesOnTaskLevel',
    'verdict',
    'recommendation',
    'claudeProduct',
    'supersedesNodeIds',
    'estMonthlyTimeSaved',
    'incrementalMonthlyTimeSaved',
    'rationale',
    'confidence',
    'risks',
  ],
  properties: {
    flowId: { type: 'string' },
    flowName: { type: 'string' },
    improvesOnTaskLevel: {
      type: 'boolean',
      description: 'false when the task-by-task plan is already the right answer for this sub-flow',
    },
    verdict: {
      type: 'string',
      description:
        'Always present. When improvesOnTaskLevel is false, the explicit no-gain statement with its specific reason.',
    },
    recommendation: nullable('string'),
    claudeProduct: nullable('string'),
    supersedesNodeIds: nullableArray('string'),
    estMonthlyTimeSaved: nullable('integer'),
    incrementalMonthlyTimeSaved: {
      type: ['integer', 'null'],
      description: 'Minutes/month gained beyond what the level-1 findings already claim',
    },
    rationale: { type: 'string' },
    confidence: CONFIDENCE,
    risks: nullableArray('string'),
  },
};

const INITIATIVE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'title',
    'recommendation',
    'claudeProduct',
    'spansFlowIds',
    'supersedes',
    'estMonthlyTimeSaved',
    'incrementalMonthlyTimeSaved',
    'sequencing',
    'rationale',
    'confidence',
  ],
  properties: {
    title: { type: 'string' },
    recommendation: { type: 'string' },
    claudeProduct: { type: 'string' },
    spansFlowIds: { type: 'array', items: { type: 'string' } },
    supersedes: {
      type: ['object', 'null'],
      additionalProperties: false,
      required: ['nodeIds', 'flowIds'],
      properties: {
        nodeIds: nullableArray('string'),
        flowIds: nullableArray('string'),
      },
    },
    estMonthlyTimeSaved: nullable('integer'),
    incrementalMonthlyTimeSaved: {
      type: ['integer', 'null'],
      description: 'Minutes/month gained beyond the level-1 and level-2 recommendations',
    },
    sequencing: nullable('string'),
    rationale: { type: 'string' },
    confidence: CONFIDENCE,
  },
};

export const STRATEGIC_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['improvesOnLowerLevels', 'verdict', 'summary', 'initiatives', 'totalIncrementalMonthlyTimeSaved'],
  properties: {
    improvesOnLowerLevels: {
      type: 'boolean',
      description: 'false when the task and sub-flow levels have already captured everything',
    },
    verdict: {
      type: 'string',
      description:
        'Always present. When improvesOnLowerLevels is false, the explicit no-gain statement with its specific reason.',
    },
    summary: { type: 'string' },
    initiatives: {
      type: 'array',
      description: 'Empty when improvesOnLowerLevels is false; otherwise 1-4 entries.',
      items: INITIATIVE_SCHEMA,
    },
    totalIncrementalMonthlyTimeSaved: nullable('integer'),
  },
};
