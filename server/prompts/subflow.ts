/**
 * Level 2 — one sub-flow reviewed as an integrated whole, given the level-1 findings
 * for its own nodes. The central discipline of this prompt is that "no integrated
 * improvement exists" is a correct, useful answer that must be stated plainly.
 */
export const SUBFLOW_PROMPT = `# Level 2 — integrated sub-flow analysis

## Payload structure
The user message contains a JSON object with:
- **flow** — the single sub-flow you are analysing (\`{ id, name, description, departmentId, parentFlowId }\`).
- **nodes** / **edges** — only the nodes and edges belonging to that sub-flow.
- **parentContext** — how this sub-flow is used by its parent: the parent flow's name, and the exits (\`end\` node names) through which control returns.
- **taskFindings** — the level-1, node-by-node findings already produced for these nodes. **These have already been recommended to the user.**
- **childAnalyses** — level-2 analyses of any sub-flows nested inside this one, already completed.
- **frequencies**, **personas**, **departments** — the org-wide registries.

## Your job
You are given a sub-flow and the per-task automation plan that has already been produced for it. Your **only** question is:

> Is there an integrated way to automate or improve this sub-flow as a whole that is materially better than doing those tasks one at a time?

You are not being asked to re-do the task-level analysis, and you must not restate a level-1 finding as if it were a new integrated one.

### What counts as an integrated improvement
- **One system replaces several nodes** — a single agent or integration that subsumes three or four tasks, rather than three or four separate automations.
- **Removing the hand-offs** — the tasks themselves may be cheap, but passing work between them (waiting, re-keying, chasing, re-finding context) is where the time goes.
- **Eliminating a decision** — restructuring so a decision node no longer needs to be made, or is made once upstream instead of per run.
- **Collapsing exits** — a sub-flow with several \`end\` nodes may be able to resolve failure paths automatically rather than exiting to the parent.
- **Batching** — work that is done per run could be done once per period across many runs.
- **Reordering or parallelising** — the sequence itself may be the constraint, not any single task.

### When to say there is no improvement — this is expected and important
Set \`improvesOnTaskLevel: false\` whenever the honest answer is that the task-by-task plan is already right. This is a **common and correct** outcome, not a failure. Typical cases:
- The tasks are independent — no shared data, no hand-offs, different target systems.
- There are too few nodes for integration to mean anything.
- The level-1 findings already capture essentially all the available time.
- An integrated redesign is conceivable but the extra gain over level 1 is marginal or speculative.

**Default to \`false\`.** Only claim \`true\` when you can name the specific mechanism and the specific extra time it buys. An invented integration story is worse than no story: it wastes the reader's effort and undermines the findings that are real.

When \`improvesOnTaskLevel\` is \`false\`:
- \`verdict\` must state plainly that no integrated improvement was found **and give the specific reason for this sub-flow** — name the nodes or the property of the graph that makes integration pointless. Do not write a generic sentence that would fit any sub-flow.
- Omit \`recommendation\`, \`claudeProduct\`, \`supersedesNodeIds\`, \`estMonthlyTimeSaved\` and \`incrementalMonthlyTimeSaved\`.
- Still fill in \`rationale\` — explain what you considered and why it did not pay off.

When \`improvesOnTaskLevel\` is \`true\`:
- \`verdict\` is a one-line headline of the integrated approach.
- \`supersedesNodeIds\` lists the task nodes whose individual level-1 findings this replaces.
- \`estMonthlyTimeSaved\` is the total for the integrated approach; \`incrementalMonthlyTimeSaved\` is the part **beyond** what the superseded level-1 findings already claimed. If the integrated approach saves 600 min/mo and the level-1 findings it replaces claimed 450, the increment is 150.
- \`risks\` names what could make this harder than it looks (integration effort, data quality, change management, single point of failure).

## Output
Return a single JSON object:
{
  "flowId": "<the flow's id, copied exactly>",
  "flowName": "<the flow's name>",
  "improvesOnTaskLevel": true | false,
  "verdict": "<one or two sentences — the integrated headline, or the explicit no-gain statement with its specific reason>",
  "recommendation": "<the integrated redesign in 1-3 sentences; omit when improvesOnTaskLevel is false>",
  "claudeProduct": "<product from the catalogue; omit when false>",
  "supersedesNodeIds": ["<node ids whose level-1 findings this replaces>"],
  "estMonthlyTimeSaved": <integer minutes/month for the integrated approach; omit when false or unknown>,
  "incrementalMonthlyTimeSaved": <integer minutes/month beyond the level-1 findings; omit when false or unknown>,
  "rationale": "<why — reference specific node names, hand-offs, and the level-1 findings you are building on or replacing>",
  "confidence": "high" | "medium" | "low",
  "risks": ["<what makes this harder than it looks>"]
}

Be concrete and name real nodes. Focus on what is realistic within 3-6 months.`;
