# Formula Flow — POC

A React app for mapping company workflows as editable diagrams, then using Claude Haiku to identify automation and AI-assistance opportunities.

## Quick start

```bash
cp .env.example .env          # add your ANTHROPIC_API_KEY
npm install
npm run dev                   # starts Vite (5173) + Express API (8787) concurrently
```

Open http://localhost:5173. The app loads a seeded "Customer Onboarding" workflow.

To enable cloud sync, also add to `.env`:
```
VITE_SUPABASE_URL=https://xmqgxrspgtpamrwackdl.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key from Supabase dashboard>
```
Without these vars the sync UI is hidden and the app works fully offline.

## Architecture

```
Browser (Vite/React)
  ├─ /api/analyze{,/subflow,/strategic}  →  Express proxy (server/, port 8787)
  │                        └─ Anthropic API  →  claude-haiku-4-5  (level 1: per-task)
  │                                          →  claude-opus-5     (levels 2-3: sub-flow, strategic)
  └─ Supabase JS client  →  Supabase (eu-west-1, project xmqgxrspgtpamrwackdl)
                                 ├─ REST  →  workflows table (JSONB doc storage)
                                 └─ Realtime  →  postgres_changes on workflows
```

The Anthropic API key lives server-side only. The Vite dev server proxies `/api/*` to `http://localhost:8787`. The Supabase anon key is safe to expose in the browser (RLS enforces access).

## Data model

Everything lives in a single **`WorkflowDoc`** (in-memory; save/load via JSON or YAML):

```ts
WorkflowDoc {
  version: 1
  rootFlowId: string          // which Flow is the top-level canvas
  flows: Flow[]               // each Flow is a named sub-canvas
  frequencies: FrequencyCategory[] // org-wide cadence buckets (see below)
  personas: Persona[]              // org-wide role roster (see below)
  nodes: (WFNode & { flowId })[] // tagged with which canvas they live on
  edges: (WFEdge & { flowId })[] // tagged the same way
}
```

**Org-wide assumptions** (edited in the **Assumptions** slide-over, opened from the Toolbar):

```ts
FrequencyCategory { id, label, occurrencesPerMonth }       // e.g. "per new customer" → 8/mo
Persona           { id, role, workerCount, avgWeeklyHours } // e.g. "CSM" → 3 workers × 40h
```

A `task` references these by id (`frequencyId`, `personaId`) rather than free text, so a
value can be edited in one place and rolled up:
- **frequencyId → occurrencesPerMonth** lets the analysis multiply *time saved per run* into
  *time saved per month* (and total it for future dashboards). The count is for the whole
  category org-wide (e.g. the number of new customers that month), not per person.
- **personaId → workerCount × avgWeeklyHours** gives each role's total monthly capacity, so
  we can measure what **% of a persona's time** is accounted for by the tasks attributed to
  them across all flows (utilisation).

`normalizeDoc()` in `lib/persistence.ts` migrates legacy docs (old free-text `frequency` /
`ownerRole` task fields) into these registries on import/load, so older JSON/YAML still works.

The `Flow` type also carries an optional `companyName?: string` on the root flow, editable in the Inspector when no node is selected on the root canvas.

**Node types:**
- `task` — a unit of work; carries rich metadata (persona/owner, time, frequency, tools, pain points, knowledge-access, etc.)
- `flow` — a reference to a child `Flow`; double-click to drill in. When the child flow has two or more
  `end` nodes the card grows a footer with one labelled **exit** row per end node, each with its own
  connection point (see *Sub-flow exits* below)
- `decision` — a conditional gateway (diamond); outgoing edges carry `sourceHandle`/`label`/`data.branch` = `"yes"` or `"no"`. Also carries optional knowledge metadata for identifying ML/decision-support opportunities (see below).
- `start` — pipeline entry point or sub-flow entry (doubles as entry node inside a child flow)
- `end` — pipeline exit point or sub-flow exit (doubles as exit node inside a child flow). Inside a child
  flow, each `end` node **is** one of that sub-flow's named exits

**Sub-flow exits** — a sub-flow can finish in more than one state. Its exits are **derived live** from the
`end` nodes on the child canvas (`getFlowExits()` in `lib/exits.ts`), ordered by their y position; they are
never stored on `FlowRefData`, so adding, renaming or deleting an End node inside the child immediately
changes the parent's exit points. Each outgoing edge of a `flow` node records which exit it leaves from,
mirroring the decision-branch convention:

```ts
WFEdge {
  sourceHandle: 'n-billing-end-failed'  // the child flow's `end` node id — the durable link
  data: { exit: 'Payment failed' }      // that node's name — refreshed when the end node is renamed
}
```

With 0 or 1 exits the flow node renders exactly as before (one centred handle, no footer). `normalizeDoc()`
backfills `sourceHandle`/`data.exit` on legacy edges and clears handles that no longer resolve.

**Decision node knowledge metadata** (all optional; edited via progressive disclosure in the Inspector):

The Inspector reveals fields in two tiers based on what the user has already entered.

*Tier 1 — always shown:*
- `informationCompleteness?: 'full' | 'partial' | 'gut_feel'` — how complete the available information is at decision time
- `decisionBasis?: 'rules' | 'experience' | 'intuition'` — what the call is based on

*Tier 2 — revealed when `informationCompleteness !== 'full'` OR `decisionBasis === 'intuition'`:*
- `reversibility?: 'reversible' | 'hard_to_reverse' | 'irreversible'` — how easily the decision can be undone (stakes)
- `costOfError?: 'low' | 'medium' | 'high'` — consequence of a wrong call (stakes)
- `historicalDataExists?: boolean` — whether past outcomes have been recorded
  - (when `true`) `outcomeMeasured?: boolean` — whether outcomes are tracked with measurable results
    - (when `true`) `outcomeDataSource?: string` — where outcome data lives (e.g. "Salesforce closed-won/lost history")

The canvas shows a small badge derived from the metadata: **ML** (green) when history + measured outcomes + source are all present; **gut-feel** (orange) when `informationCompleteness === 'gut_feel'` or `decisionBasis === 'intuition'`.

Claude's analysis produces decision-node findings using this logic:
- `informationCompleteness === 'full'` and not intuition → leave alone
- `historicalDataExists === false` → recommend "Start logging outcomes"
- `historicalDataExists === true && outcomeMeasured === true` → recommend decision-support / ML (priority elevated by `reversibility` / `costOfError`)

**Task node knowledge-access metadata** (all optional; same progressive-disclosure pattern in the Inspector, placed where the old "Status" field was — `status`/`TaskStatus` have been removed):

*Tier 1 — always shown:*
- `inputAccessibility?: 'instant' | 'search' | 'ask' | 'rebuild'` ("Additional information accessibility") — how reachable the info this task needs is

*Tier 2 — revealed by the `inputAccessibility` answer:*
- `searchTime?: number` (minutes) — when `!== 'instant'`
- `inputSource?: string` — when `'ask'` or `'rebuild'`
- `knowledgeCaptured?: boolean` and `expertiseLevel?: 'junior' | 'mid' | 'senior' | 'expert'` — when `'ask'` (tacit/colleague knowledge)

Task cards show a badge: **RAG/KB** (green) when `inputAccessibility === 'ask'`; **info-gap** (orange) when `'search'` / `'rebuild'`. The prompt also runs a **cross-graph pass** — when one task's `outputs` feed a downstream task that re-obtains the same info via search/ask/rebuild, that's flagged as a database/integration/hand-off opportunity. (Only the "blue" right-hand side of the design — knowledge access — is implemented; the "purple" judgement-type branch is future work.)

Navigation is breadcrumb-based: entering a flow pushes it onto the breadcrumb stack; clicking a parent crumb pops back.

## Directory map

```
src/
  types.ts              — all TypeScript types (WorkflowDoc, TaskData, FlowRefData, DecisionData, TerminalData, WFEdgeData, AnalysisResult)
  theme.css             — Anthropic brand CSS custom properties + base styles
  store/
    workflowStore.ts    — Zustand store; single source of truth for the whole doc
  lib/
    seed.ts             — seed WorkflowDoc (Customer Onboarding example)
    persistence.ts      — exportJson, exportYaml, importFile, normalizeDoc
    api.ts              — analyzeTasks / analyzeSubFlow / analyzeStrategic → the three /api/analyze* endpoints
    analysisRunner.ts   — chains the three analysis levels, feeding each into the next; emits progress per stage
    useAnalysis.ts      — hook owning the multi-level run (result, stage, error); kept out of the store on purpose
    supabase.ts         — Supabase client (null when VITE_SUPABASE_* vars absent; check supabaseConfigured before use)
    useSupabaseSync.ts  — sync hook: debounced writes, realtime subscription, echo prevention, localStorage persistence
  components/
    Canvas.tsx          — ReactFlow canvas, drag-drop, double-click drill-in
    Sidebar.tsx         — drag palette (Task, Sub-flow, Decision, Start, End)
    Inspector.tsx       — edit metadata of the selected node; collapses to a thin rail when nothing is selected
    Breadcrumbs.tsx     — flow navigation bar
    Toolbar.tsx         — export/import + Assumptions + Analyse triggers + sync toggle (hidden when Supabase not configured)
    AnalysisPanel.tsx   — slide-over with a tab per level (Tasks / Sub-flows / Strategy), filling in as each pass lands
    AnalysisDepthDialog.tsx — modal shown on "Analyse": pick how deep to run (tasks / +sub-flows / +strategic)
    SettingsPanel.tsx   — "Assumptions" slide-over: edit frequency counts & persona capacity
    SyncPanel.tsx       — "Cloud Sync" slide-over: status, sync ID copy/share, join-by-ID, danger zone
    nodes/
      TaskNode.tsx       — task card node; renders RAG-KB/info-gap badge from knowledge-access metadata
      FlowNode.tsx       — sub-flow reference node
      DecisionNode.tsx   — diamond gateway node (Yes/No branches); renders ML/gut-feel badge from knowledge metadata
      StartNode.tsx      — pipeline/flow entry terminator
      EndNode.tsx        — pipeline/flow exit terminator
      TerminalNode.module.css — shared styles for Start and End nodes
server/
  index.ts              — Express app; POST /api/analyze{,/subflow,/strategic}, GET /api/health
  analyze.ts            — the three Anthropic SDK calls, prompt caching, JSON parsing, LEVELS descriptor
  cache.ts              — analysis result cache: canonical hashing + Supabase read/write
  schemas.ts            — JSON schemas constraining the level-2 / level-3 structured outputs
  prompts/
    shared.ts           — SHARED_CONTEXT: node vocabulary, registries, product catalogue (all three levels)
    task.ts             — TASK_PROMPT (level 1, per-node)
    subflow.ts          — SUBFLOW_PROMPT (level 2, one sub-flow as an integrated whole)
    strategic.ts        — STRATEGIC_PROMPT (level 3, the whole workflow as one system)
```

## Conventions

- **Brand tokens** — all colours and fonts come from CSS custom properties defined in `src/theme.css`; don't hardcode hex values in components.
- **State** — `useWorkflowStore` is the single source of truth. Components never hold their own copy of nodes/edges.
- **Sub-flow exits** — derived from the child flow's `end` nodes via `getFlowExits()`, never duplicated onto
  `FlowRefData`. Edges leaving a `flow` node carry `sourceHandle` (the end node's id) and `data.exit` (its
  name); `FlowNode` must call `useUpdateNodeInternals()` whenever that handle set changes, and must select
  from the store via `useShallow` over a flat string array so React Flow doesn't see a new snapshot each render.
- **Org-wide assumptions** — frequency counts and personas live on the doc and are edited in the Assumptions slide-over; tasks reference them by id (`frequencyId` / `personaId`), never by free text.
- **Models** — two, both declared at the top of `server/analyze.ts`: `TASK_MODEL` (`claude-haiku-4-5`) for the
  high-volume per-node pass, `INTEGRATION_MODEL` (`claude-opus-5`) for the two integrative passes, which run with
  adaptive thinking at `effort: 'high'` and are **streamed** (thinking tokens count toward `max_tokens`).
- **Prompt caching** — the system is an array of two `cache_control: { type: 'ephemeral' }` blocks:
  `SHARED_CONTEXT` then the level-specific prompt. Because the shared block is byte-identical across levels, the
  two Opus passes and the N sub-flow calls share a cached prefix. Cache is per-model, so the Haiku pass caches
  separately. Verify with the `[analyze:*] … cache_read=` line each call logs.
- **Structured outputs** — levels 2 and 3 constrain their replies with `output_config.format` against the schemas
  in `server/schemas.ts`. Strict schemas need every property in `required`, so optional fields are declared
  nullable and `stripNulls()` in `analyze.ts` converts the nulls back to absent keys. Level 1 stays on
  prompt-instructed JSON.
- **"No improvement" is a real answer** — levels 2 and 3 must say so explicitly when the level below already has
  it right. That's enforced in three places, and all three need to stay in step: the prompts tell the model to
  default to "no gain", the schemas make `improvesOnTaskLevel` / `improvesOnLowerLevels` and `verdict` required,
  and `AnalysisPanel` renders that case as a distinct muted card rather than hiding it.
- **Analysis cache** — `server/cache.ts` stores every level's result in the `analysis_cache` table, keyed by a
  sha256 of the canonicalised input. It is **server-side because the key must include the prompt text and model
  id** — editing a prompt has to invalidate that level's entries, and the browser never sees the prompts. The
  server reads the same `VITE_SUPABASE_*` vars from `.env`; when they're absent, caching is a silent no-op.
  **Every Supabase call falls through on error — a broken cache must never fail an analysis.**
- **Cache key scoping** — each level is keyed on *the slice of the graph it owns*, not on everything sent to the
  model. `EXCLUDE_FROM_KEY` in `cache.ts` drops the findings a level receives from the level below
  (`taskFindings`, `childAnalyses`, `subFlowAnalyses`). So editing one sub-flow re-runs that sub-flow plus the
  two whole-doc levels, while the *other* sub-flows keep their cached verdicts. The accepted tradeoff: a cached
  sub-flow verdict may have been computed against slightly older task findings.
- **What keeps the hit rate up** — three things are load-bearing, not cosmetic, and breaking any of them makes
  the cache miss constantly:
  1. `slimNode` / `slimEdge` in `lib/api.ts` — React Flow writes `selected` onto a node or edge when you click
     it, so without slimming, merely selecting something on the canvas changes the payload.
  2. `canonical()` in `cache.ts` sorts object keys and id-bearing arrays — the store rebuilds arrays as
     `[...otherNodes, ...updated]` on every change, so `doc.nodes` reorders during ordinary editing.
  3. `parentContext.exits` must come from `getFlowExits()` (y-ordered, id tie-break), never from filtering
     `doc.nodes` directly — that gives arbitrary store order, which is both wrong for the model and unstable.
  Plain string arrays (`tools`, `inputs`, `outputs`, `exits`) are deliberately *not* sorted; their order means
  something.
- **CSS Modules** — each component has a co-located `.module.css` file; global utility classes (`.btn-primary`, `.btn-secondary`, `.btn-ghost`) are in `theme.css`.
- **Supabase sync** — opt-in via "Sync off/on" toggle in the Toolbar. The hook (`useSupabaseSync`) debounces writes by 800 ms and uses a per-tab `sessionId` (in `sessionStorage`) to suppress echo updates. The workflow UUID is persisted in `localStorage('ff_workflow_id')` so the browser reconnects on refresh. JSON/YAML export is unaffected by sync state.
- **Supabase DB** — project `formula_flow_poc` (ID `xmqgxrspgtpamrwackdl`, region `eu-west-1`). Two tables, both
  with RLS on and an open `anon_all` policy (POC):
  - `workflows` — `id UUID`, `doc JSONB`, `company_name TEXT`, `flow_name TEXT`, `updated_by TEXT`, timestamps.
    Realtime replication is enabled on this table.
  - `analysis_cache` — `cache_key TEXT PK`, `level TEXT` (`tasks`/`subflow`/`strategic`), `model TEXT`,
    `prompt_hash TEXT`, `input JSONB`, `output JSONB`, `hit_count INT`, timestamps. Plus a
    `bump_cache_hit(key)` SQL function, because supabase-js can't express `hit_count = hit_count + 1` directly.
    No realtime. Safe to `truncate` at any time — it only costs the next run its cache hits.

## Analysis API contract

Analysis runs in **three chained levels**, each taking the level(s) below it as input. The
client orchestrates them (`lib/analysisRunner.ts`) rather than the server, so the panel can
fill in level by level. The user picks how deep to go in the depth dialog; `AnalysisDepth`
(`'tasks' | 'subflows' | 'strategic'`) stops the chain early.

```
runAnalysis(doc, depth, onProgress, { fresh })
  ├─ 1. POST /api/analyze            whole doc                     → AnalysisResult
  ├─ 2. POST /api/analyze/subflow    per non-root flow, deepest     → SubFlowAnalysis
  │        tier first, parallel within a tier; fed that flow's
  │        task findings + any nested sub-flow analyses
  └─ 3. POST /api/analyze/strategic  whole doc + all task findings  → StrategicAnalysis
           + all sub-flow analyses
```

Every route is cached (see the Caching conventions above). Append **`?fresh=1`** to bypass the
lookup and overwrite the stored entry — it's a query param rather than a body field precisely so
the body stays byte-identical to what gets hashed. The "Ignore cached results" checkbox in the
depth dialog sets it. Each response carries **`X-Analysis-Cache: hit | miss | bypass | off`**
(`off` = Supabase not configured); `cors()` lists it in `exposedHeaders`, without which the browser
cannot read it and the "cached" badge silently never appears. The client surfaces this as
`MultiLevelAnalysis.cached`, keyed by `'tasks'`, `'strategic'`, or a sub-flow's `flowId`.

Every request carries the shared graph and registry fields:

```json
{ "flows": Flow[], "nodes": WFNode[], "edges": WFEdge[],
  "frequencies": FrequencyCategory[], "personas": Persona[], "departments": Department[] }
```

Nodes and edges are slimmed by `slimNode()` / `slimEdge()` in `lib/api.ts` — React Flow's canvas geometry and selection
state are stripped, since the payload is echoed through all three passes. The `frequencies` /
`personas` registries let Claude join each task to its monthly run count and its owner's
capacity; `departments` lets the strategic pass see cross-department hand-offs.

Level 2 additionally sends `{ flow, parentContext: { parentFlowName, exits }, taskFindings,
childAnalyses }`, scoped to that one flow. Level 3 additionally sends `{ taskFindings,
subFlowAnalyses }`. The findings fields are sent to the model but excluded from the cache key —
see **Cache key scoping** above.

Sub-flows with fewer than two task/decision nodes are skipped — there is no integration story
in a single node.

**Level 1 response** `AnalysisResult`:
```json
{
  "findings": [
    {
      "nodeId": "n-crm",
      "nodeName": "Create CRM record",
      "recommendation": "Use Claude API to extract contract fields and populate Salesforce automatically.",
      "claudeProduct": "Claude API / Anthropic SDK",
      "estTimeSavedPerRun": 18,
      "estMonthlyTimeSaved": 144,
      "rationale": "The task is purely data extraction from a PDF — a straightforward Claude task.",
      "confidence": "high"
    }
  ],
  "summary": "3 of 5 tasks are strong automation candidates …",
  "totalMonthlyTimeSaved": 540,
  "personaUtilisation": [
    { "persona": "Customer Success Manager", "attributedHoursPerMonth": 6,
      "capacityHoursPerMonth": 520, "utilisationPct": 1.2 }
  ]
}
```

`estMonthlyTimeSaved`, `totalMonthlyTimeSaved`, and `personaUtilisation` are optional —
present only when the relevant frequency/persona data is filled in.

**Level 2 response** `SubFlowAnalysis` — one per sub-flow:
```json
{
  "flowId": "flow-billing",
  "flowName": "Billing Setup",
  "improvesOnTaskLevel": true,
  "verdict": "All three billing tasks are one linear Salesforce→Stripe pipeline run by the same person …",
  "recommendation": "Build a single Closed-Won-triggered billing agent that provisions customer, subscription and invoice in one transaction.",
  "claudeProduct": "Claude Managed Agents",
  "supersedesNodeIds": ["n-stripe-customer", "n-subscription", "n-invoice"],
  "estMonthlyTimeSaved": 600,
  "incrementalMonthlyTimeSaved": 150,
  "rationale": "…",
  "confidence": "medium",
  "risks": ["Stripe webhook reliability"]
}
```

When `improvesOnTaskLevel` is `false`, only `verdict`, `rationale` and `confidence` accompany it —
the verdict carries the explicit reason no integrated approach beats task-by-task for this sub-flow.

**Level 3 response** `StrategicAnalysis`:
```json
{
  "improvesOnLowerLevels": true,
  "verdict": "The same contract facts are re-extracted in all three flows …",
  "summary": "<executive recommendation with a suggested order>",
  "initiatives": [
    {
      "title": "Canonical onboarding record",
      "recommendation": "Extract the contract once and serve all three departments.",
      "claudeProduct": "Claude API / Anthropic SDK",
      "spansFlowIds": ["flow-root", "flow-billing", "flow-provisioning"],
      "supersedes": { "nodeIds": ["n-crm"], "flowIds": [] },
      "estMonthlyTimeSaved": 240,
      "incrementalMonthlyTimeSaved": 80,
      "sequencing": "Phase 1 — prerequisite for both sub-flow agents",
      "rationale": "…",
      "confidence": "medium"
    }
  ],
  "totalIncrementalMonthlyTimeSaved": 180
}
```

`initiatives` is empty when `improvesOnLowerLevels` is `false`. Both levels report
`incrementalMonthlyTimeSaved` — the gain **beyond** the levels below, never a re-count of them.

## Future stages

1. ~~**Supabase persistence**~~ — **Done.** Opt-in cloud sync via `useSupabaseSync`; real-time collaborative editing via shared UUID; `workflows` table in Supabase.
2. ~~**Decision-node knowledge metadata**~~ — **Done.** Progressive-disclosure Inspector fields (`informationCompleteness`, `decisionBasis`, + Tier-2 stakes/history fields); ML/gut-feel canvas badge; Claude produces decision-node findings.
3. ~~**Task-node knowledge-access metadata**~~ — **Done (knowledge-access / "blue" branch).** `inputAccessibility` + Tier-2 fields; RAG-KB/info-gap badge; cross-graph pass in the prompt. The "purple" judgement-type branch (`judgementType`, automation/ML signals) remains to do.
4. ~~**Multi-level analysis**~~ — **Done.** Sub-flow and whole-workflow strategic passes chained on top of the per-task pass, each taking the level(s) below as input, with "no improvement over the level below" as an explicit first-class result. Results are cached in Supabase by a content hash of each level's own graph slice, so an unchanged workflow re-analyses in well under a second.
5. **Org chart & personas** — attach job titles, personas, and emails to flow owners; enable workflow handover between team members via email.
6. **Value-flow analysis** — annotate where business value is created/destroyed and surface highest-ROI automation targets.
