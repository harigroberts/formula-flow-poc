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

/* ------------------------------------------------------------------ plan */

/*
 * The plan thread's tool input. Unlike the schemas above this one is NOT strict: strict
 * schemas allow at most 16 union-typed (nullable) parameters, and the end state has more
 * optional fields than that. So optional fields are simply left out of `required` and the
 * model omits them; `validateEndState()` in src/lib/endState.ts checks every proposal
 * server-side instead, and a failure goes back to the model as a tool error to fix.
 */

const CHANGE = { type: 'string', enum: ['unchanged', 'modified', 'new'] } as const;
const string = { type: 'string' } as const;
const strings = { type: 'array', items: { type: 'string' } } as const;

const END_STATE_FLOW = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'name', 'parentFlowId', 'change'],
  properties: {
    id: string,
    name: string,
    description: string,
    parentFlowId: { type: ['string', 'null'], description: 'null only for the root flow' },
    change: CHANGE,
  },
};

const END_STATE_NODE = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'flowId', 'type', 'change'],
  properties: {
    id: { type: 'string', description: 'The original id for a kept node; new ids start "new-"' },
    flowId: string,
    type: { type: 'string', enum: ['task', 'flow', 'decision', 'start', 'end'] },
    change: CHANGE,
    name: string,
    description: string,
    replacesNodeIds: { ...strings, description: 'Original node ids this node takes over from' },
    personaId: string,
    frequencyId: string,
    humanMinutesPerRun: {
      type: 'number',
      description: 'Human minutes that remain per run once the plan is delivered',
    },
    isManual: { type: 'boolean' },
    tools: strings,
    childFlowId: string,
    automation: {
      type: 'object',
      additionalProperties: false,
      required: ['claudeProduct', 'how', 'implements'],
      properties: {
        claudeProduct: string,
        how: string,
        implements: { ...strings, description: 'Selection leaf ids this node delivers' },
      },
    },
  },
};

const END_STATE_EDGE = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'flowId', 'source', 'target'],
  properties: {
    id: string,
    flowId: string,
    source: string,
    target: string,
    sourceHandle: string,
    targetHandle: string,
    label: string,
    branch: { type: 'string', enum: ['yes', 'no'] },
    exit: string,
    entry: string,
    retryRatePct: { type: 'number' },
  },
};

/** Input of the plan thread's `propose_end_state` tool — see `EndStateProposal` in src/types.ts. */
export const END_STATE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'summary', 'flows', 'nodes', 'edges', 'removedNodeIds'],
  properties: {
    title: { type: 'string', description: 'A short name for this end state' },
    summary: { type: 'string', description: 'One or two sentences on what changes' },
    flows: { type: 'array', items: END_STATE_FLOW },
    nodes: { type: 'array', items: END_STATE_NODE },
    edges: { type: 'array', items: END_STATE_EDGE },
    removedNodeIds: strings,
    estMonthlyTimeSaved: {
      type: 'integer',
      description: 'Minutes/month the end state saves against the original workflow',
    },
  },
};
