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
  ├─ /api/analyze  →  Express proxy (server/, port 8787)
  │                        └─ Anthropic API  →  claude-haiku-4-5
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
- `flow` — a reference to a child `Flow`; double-click to drill in
- `decision` — a conditional gateway (diamond); outgoing edges carry `sourceHandle`/`label`/`data.branch` = `"yes"` or `"no"`. Also carries optional knowledge metadata for identifying ML/decision-support opportunities (see below).
- `start` — pipeline entry point or sub-flow entry (doubles as entry node inside a child flow)
- `end` — pipeline exit point or sub-flow exit (doubles as exit node inside a child flow)

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
    api.ts              — analyzeFlow() → POST /api/analyze
    supabase.ts         — Supabase client (null when VITE_SUPABASE_* vars absent; check supabaseConfigured before use)
    useSupabaseSync.ts  — sync hook: debounced writes, realtime subscription, echo prevention, localStorage persistence
  components/
    Canvas.tsx          — ReactFlow canvas, drag-drop, double-click drill-in
    Sidebar.tsx         — drag palette (Task, Sub-flow, Decision, Start, End)
    Inspector.tsx       — edit metadata of the selected node; collapses to a thin rail when nothing is selected
    Breadcrumbs.tsx     — flow navigation bar
    Toolbar.tsx         — export/import + Assumptions + Analyse triggers + sync toggle (hidden when Supabase not configured)
    AnalysisPanel.tsx   — slide-over showing LLM findings (monthly savings + persona utilisation)
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
  index.ts              — Express app; POST /api/analyze, GET /api/health
  prompt.ts             — static system prompt with Claude product catalogue
  analyze.ts            — Anthropic SDK call with prompt caching
```

## Conventions

- **Brand tokens** — all colours and fonts come from CSS custom properties defined in `src/theme.css`; don't hardcode hex values in components.
- **State** — `useWorkflowStore` is the single source of truth. Components never hold their own copy of nodes/edges.
- **Org-wide assumptions** — frequency counts and personas live on the doc and are edited in the Assumptions slide-over; tasks reference them by id (`frequencyId` / `personaId`), never by free text.
- **Model** — always `claude-haiku-4-5` in `server/analyze.ts`; change there if upgrading.
- **Prompt caching** — the system prompt in `server/analyze.ts` uses `cache_control: { type: 'ephemeral' }` to avoid re-tokenising on repeated calls.
- **CSS Modules** — each component has a co-located `.module.css` file; global utility classes (`.btn-primary`, `.btn-secondary`, `.btn-ghost`) are in `theme.css`.
- **Supabase sync** — opt-in via "Sync off/on" toggle in the Toolbar. The hook (`useSupabaseSync`) debounces writes by 800 ms and uses a per-tab `sessionId` (in `sessionStorage`) to suppress echo updates. The workflow UUID is persisted in `localStorage('ff_workflow_id')` so the browser reconnects on refresh. JSON/YAML export is unaffected by sync state.
- **Supabase DB** — project `formula_flow_poc` (ID `xmqgxrspgtpamrwackdl`, region `eu-west-1`). Single `workflows` table: `id UUID`, `doc JSONB`, `company_name TEXT`, `flow_name TEXT`, `updated_by TEXT`, timestamps. RLS is on with an open anon policy (POC). Realtime replication is enabled on the table.

## Analysis API contract

**Request** `POST /api/analyze`:
```json
{ "flow": Flow, "nodes": WFNode[], "edges": WFEdge[],
  "frequencies": FrequencyCategory[], "personas": Persona[] }
```

The `frequencies`/`personas` registries let Claude join each task to its monthly run count
and its owner's capacity, so it can return monthly totals and persona utilisation.

**Response** `AnalysisResult`:
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

## Future stages

1. ~~**Supabase persistence**~~ — **Done.** Opt-in cloud sync via `useSupabaseSync`; real-time collaborative editing via shared UUID; `workflows` table in Supabase.
2. ~~**Decision-node knowledge metadata**~~ — **Done.** Progressive-disclosure Inspector fields (`informationCompleteness`, `decisionBasis`, + Tier-2 stakes/history fields); ML/gut-feel canvas badge; Claude produces decision-node findings.
3. ~~**Task-node knowledge-access metadata**~~ — **Done (knowledge-access / "blue" branch).** `inputAccessibility` + Tier-2 fields; RAG-KB/info-gap badge; cross-graph pass in the prompt. The "purple" judgement-type branch (`judgementType`, automation/ML signals) remains to do.
4. **Org chart & personas** — attach job titles, personas, and emails to flow owners; enable workflow handover between team members via email.
5. **Value-flow analysis** — annotate where business value is created/destroyed and surface highest-ROI automation targets.
