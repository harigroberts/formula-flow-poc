/**
 * Level 3 — the entire workflow reviewed as one system, given every level-1 finding
 * and every level-2 sub-flow analysis. Same discipline as level 2: "nothing to add"
 * is a correct answer and must be stated plainly.
 */
export const STRATEGIC_PROMPT = `# Level 3 — whole-workflow strategic analysis

## Payload structure
The user message contains a JSON object with:
- **flows** — every flow in the workflow (\`{ id, name, description, departmentId, parentFlowId }\`). The root flow has \`parentFlowId: null\`.
- **nodes** / **edges** — ALL nodes and edges across every flow, tagged with \`flowId\`.
- **taskFindings** — every level-1, node-by-node finding. **Already recommended to the user.**
- **subFlowAnalyses** — every level-2 sub-flow analysis, including the ones that concluded no integrated improvement was available. **Also already recommended.**
- **frequencies**, **personas**, **departments** — the org-wide registries.

## Your job
You are given a complete workflow, the per-task automation plan, and the per-sub-flow integrated plan. Your **only** question is:

> Is there a whole-workflow move that is materially better than the task-level and sub-flow-level plans already produced?

You are the highest altitude in this analysis. Think about the workflow as one system an organisation runs, not as a set of nodes to automate.

### What counts as a strategic improvement
- **Cross-sub-flow duplication** — the same data fetched, the same record created, the same approval sought in two or more sub-flows. One system could serve all of them.
- **A single platform spanning the workflow** — where the sub-flow-level plans would each build their own integration, one shared agent or data layer may serve the whole pipeline more cheaply.
- **Departmental hand-offs** — use \`departmentId\` on flows and flow nodes. Work crossing an organisational boundary is where queues, re-keying and status-chasing accumulate; none of it belongs to any single node.
- **The shape of the graph** — sub-flows that could run in parallel instead of in sequence, branches that converge on the same outcome, decision nodes that gate work which could proceed optimistically.
- **Sequencing and dependency** — which initiative must land first for the others to be worth doing. A roadmap is itself a strategic output.
- **Where the workflow should not exist** — sometimes the highest-value observation is that a whole branch or sub-flow exists to compensate for a problem that could be fixed upstream.

### When to say there is no improvement — this is expected and important
Set \`improvesOnLowerLevels: false\` whenever the honest answer is that levels 1 and 2 have already captured everything. This is a **legitimate and useful** outcome. Typical cases:
- The sub-flows are genuinely independent — they share no data, no systems and no people.
- The sub-flow-level plans already amount to the same thing a whole-workflow initiative would produce.
- The workflow is small enough that "the whole system" and "the sub-flows" are the same scope.
- A grander programme is conceivable but its extra gain over levels 1 and 2 is marginal or speculative.

**Default to \`false\`.** Only claim \`true\` when you can name the specific mechanism and the specific extra value it buys over the lower levels. Do not repackage the sub-flow analyses into a strategic-sounding summary and call it a new finding — that is the failure mode to avoid here.

When \`improvesOnLowerLevels\` is \`false\`:
- \`verdict\` must state plainly that no whole-workflow improvement was found **and give the specific reason for this workflow** — name the sub-flows and what makes them independent. Not a generic sentence.
- \`initiatives\` must be an empty array, and \`totalIncrementalMonthlyTimeSaved\` omitted.
- \`summary\` should still be useful: confirm which lower-level recommendations to pursue and in what order.

When \`improvesOnLowerLevels\` is \`true\`:
- Produce **1 to 4** initiatives. More than that means you are listing tasks, not strategy.
- Each initiative names the flows it spans (\`spansFlowIds\`) and what it supersedes (\`supersedes.nodeIds\` / \`supersedes.flowIds\`).
- \`incrementalMonthlyTimeSaved\` is the gain **beyond** the level-1 and level-2 recommendations it replaces — never a re-count of them. \`totalIncrementalMonthlyTimeSaved\` is the sum of those increments.
- \`sequencing\` says where the initiative sits in a roadmap and what it depends on.

## Output
Return a single JSON object:
{
  "improvesOnLowerLevels": true | false,
  "verdict": "<one or two sentences — the strategic headline, or the explicit no-gain statement with its specific reason>",
  "summary": "<3-5 sentences an executive would read: what to do, in what order, and what it is worth>",
  "initiatives": [
    {
      "title": "<short name for the initiative>",
      "recommendation": "<what to build or change, in 1-3 sentences>",
      "claudeProduct": "<product from the catalogue>",
      "spansFlowIds": ["<flow ids this reaches across>"],
      "supersedes": { "nodeIds": ["<node ids>"], "flowIds": ["<flow ids>"] },
      "estMonthlyTimeSaved": <integer minutes/month for the initiative; omit if unknown>,
      "incrementalMonthlyTimeSaved": <integer minutes/month beyond levels 1 and 2; omit if unknown>,
      "sequencing": "<where this sits in a roadmap and what it depends on>",
      "rationale": "<why — reference specific flows, departments and the lower-level findings you are building on or replacing>",
      "confidence": "high" | "medium" | "low"
    }
  ],
  "totalIncrementalMonthlyTimeSaved": <integer minutes/month summed across initiatives; omit when false or unknown>
}

Be concrete and name real flows and departments. Focus on what is realistic within 6-12 months at this altitude.`;
