/**
 * Level 1 — per-node findings across the whole document. This is the original
 * analysis pass; its behaviour is unchanged, only the shared context has been
 * lifted out into `shared.ts`.
 */
export const TASK_PROMPT = `# Level 1 — task-by-task analysis

## Payload structure
The user message contains a JSON object with:
- **flows** — array of all flows included in this analysis (\`{ id, name, parentFlowId }\`). The root flow has \`parentFlowId: null\`; child flows reference their parent by id.
- **nodes** — ALL nodes across every flow in the array, each tagged with \`flowId\` so you can group them by flow. Analyse task nodes from all flows, not just the root.
- **edges** — ALL edges across every flow, also tagged with \`flowId\`.
- **frequencies**, **personas** and **departments** — the org-wide registries.

## Your job
Analyse the workflow JSON provided by the user. For each **task** node that could benefit from automation or AI assistance, produce a specific, actionable finding.

Work node by node. Later analysis passes will look for integrated, multi-node redesigns — do not attempt those here.

Also analyse **decision** nodes that carry knowledge metadata. Use this logic to infer the right intervention:
- \`informationCompleteness === "full"\` AND \`decisionBasis !== "intuition"\` → leave alone; no finding needed.
- \`historicalDataExists === false\` (and the gate condition is met) → produce a finding recommending **"Start logging outcomes"**: the org has no history yet, so the priority is to instrument the decision before any model can help. Use \`claudeProduct: "Claude API / Anthropic SDK"\` to suggest a lightweight outcome-logging integration.
- \`historicalDataExists === true && outcomeMeasured === true\` → produce a finding recommending **decision-support or ML**: with history and measured outcomes (cite \`outcomeDataSource\`), a model can assist. Use \`claudeProduct: "Claude Managed Agents"\` or \`"Claude API / Anthropic SDK"\` as appropriate. Elevate priority when \`reversibility\` is \`"hard_to_reverse"\` or \`"irreversible"\` and/or \`costOfError\` is \`"high"\`.
- Otherwise (gate condition met but incomplete historical data path) → produce a finding recommending that the org complete the outcome measurement setup before investing in a model.
Decision findings use the same \`findings\` shape; omit \`estTimeSavedPerRun\` / \`estMonthlyTimeSaved\` since decisions don't have per-run minutes.

### Knowledge-access opportunities (task \`inputAccessibility\` and friends)
When a task carries knowledge-access metadata, look for ways to make the information it needs easier to reach:
- \`inputAccessibility === "instant"\` → no knowledge-access finding needed; the info is already at hand.
- \`inputAccessibility === "search"\` or \`"rebuild"\` → the worker spends \`searchTime\` minutes locating or recreating information. Recommend a **knowledge base / RAG search** (\`claudeProduct: "MCP (Model Context Protocol) / Connectors"\` or \`"Claude API / Anthropic SDK"\`) so the info is retrievable, or a **dashboard / integration** when the data lives in another system. You may set \`estTimeSavedPerRun\` from \`searchTime\` when reducing retrieval effort.
- \`inputAccessibility === "ask"\` → the task depends on a colleague's tacit knowledge (\`inputSource\`, \`expertiseLevel\`). When \`knowledgeCaptured === false\`, this is a key-person risk: recommend **capturing that knowledge into a searchable knowledge base / RAG** so it no longer requires asking an \`expertiseLevel\` expert. Elevate priority for \`"senior"\` / \`"expert"\` levels.

### Cross-graph pass (look across tasks, not just per-node)
Inspect edges: one task's \`outputs\` often feed another task's \`inputs\`. When a downstream task re-obtains that same information via \`inputAccessibility\` of \`"search"\`, \`"ask"\`, or \`"rebuild"\` (rather than receiving it directly), that signals a **database / integration / hand-off** opportunity that no single node reveals on its own — the upstream output should flow straight through. Call these out as findings spanning both nodes (reference the upstream node in the \`rationale\`). When deciding which task is upstream and which is downstream, ignore any edge listed in a loop's \`backEdges\` (see the Feedback loops section above) — those run against the normal direction of a pass through the graph, and without excluding them every node in a loop would look like both upstream and downstream of every other. A task just after a loop's retry point re-obtaining information a task just before it already had is itself worth flagging this way.

When estimating impact, scale per-run savings into monthly totals using the task's frequency:
- \`estMonthlyTimeSaved\` (minutes/month) = \`estTimeSavedPerRun\` × the \`occurrencesPerMonth\` of the task's frequency category. Omit if either input is unknown.
- In the summary, report \`totalMonthlyTimeSaved\` (sum across findings) and, where personas have capacity data, a \`personaUtilisation\` breakdown: for each persona, include (a) \`attributedHoursPerMonth\` — total current workload (\`humanMinutesPerRun × occurrencesPerMonth ÷ 60\`, summed across all their tasks), (b) \`savedHoursPerMonth\` — potential automation saving (\`estTimeSavedPerRun × occurrencesPerMonth ÷ 60\`, summed across findings attributed to this persona; omit if none), (c) \`capacityHoursPerMonth\` — \`workerCount × avgWeeklyHours × 4.33\`, and (d) \`utilisationPct\` — \`attributedHoursPerMonth / capacityHoursPerMonth × 100\`. The sum of \`savedHoursPerMonth\` across all personas should equal \`totalMonthlyTimeSaved ÷ 60\`.

## Output format — respond ONLY with valid JSON, no markdown fences:
{
  "findings": [
    {
      "nodeId": "<node id>",
      "nodeName": "<human-readable node name>",
      "recommendation": "<one clear sentence describing the automation>",
      "claudeProduct": "<product name from catalogue above>",
      "estTimeSavedPerRun": <integer minutes, omit if unknown>,
      "estMonthlyTimeSaved": <integer minutes/month = estTimeSavedPerRun × occurrencesPerMonth, omit if unknown>,
      "rationale": "<why this product fits, referencing the task details>",
      "confidence": "high" | "medium" | "low"
    }
  ],
  "summary": "<2-3 sentence overall assessment: total potential time saved, biggest wins, and suggested priority order>",
  "totalMonthlyTimeSaved": <integer minutes/month summed across findings, omit if unknown>,
  "personaUtilisation": [
    {
      "persona": "<persona role>",
      "attributedHoursPerMonth": <number — humanMinutesPerRun × occurrencesPerMonth ÷ 60, summed across all tasks for this persona>,
      "savedHoursPerMonth": <number — estTimeSavedPerRun × occurrencesPerMonth ÷ 60, summed across findings attributed to this persona; omit if no findings for this persona>,
      "capacityHoursPerMonth": <number — workerCount × avgWeeklyHours × 4.33>,
      "utilisationPct": <number 0-100>
    }
  ]
}

Focus on findings where automation is realistic within 3-6 months. Be specific — name tools and data sources from the task metadata where relevant.`;
