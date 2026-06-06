# Formula Flow — POC

A React app for mapping company workflows as editable diagrams, then using Claude Haiku to identify automation and AI-assistance opportunities.

## Quick start

```bash
cp .env.example .env          # add your ANTHROPIC_API_KEY
npm install
npm run dev                   # starts Vite (5173) + Express API (8787) concurrently
```

Open http://localhost:5173. The app loads a seeded "Customer Onboarding" workflow.

## Architecture

```
Browser (Vite/React)
  └─ /api/analyze  →  Express proxy (server/, port 8787)
                           └─ Anthropic API  →  claude-haiku-4-5
```

The API key lives server-side only. The Vite dev server proxies `/api/*` to `http://localhost:8787`.

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

**Node types:**
- `task` — a unit of work; carries rich metadata (persona/owner, time, frequency, tools, pain points, etc.)
- `flow` — a reference to a child `Flow`; double-click to drill in
- `decision` — a conditional gateway (diamond); outgoing edges carry `sourceHandle`/`label`/`data.branch` = `"yes"` or `"no"`
- `start` — pipeline entry point or sub-flow entry (doubles as entry node inside a child flow)
- `end` — pipeline exit point or sub-flow exit (doubles as exit node inside a child flow)

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
    persistence.ts      — exportJson, exportYaml, importFile
    api.ts              — analyzeFlow() → POST /api/analyze
  components/
    Canvas.tsx          — ReactFlow canvas, drag-drop, double-click drill-in
    Sidebar.tsx         — drag palette (Task, Sub-flow, Decision, Start, End)
    Inspector.tsx       — edit metadata of the selected node; collapses to a thin rail when nothing is selected
    Breadcrumbs.tsx     — flow navigation bar
    Toolbar.tsx         — export/import + Assumptions + Analyse triggers
    AnalysisPanel.tsx   — slide-over showing LLM findings (monthly savings + persona utilisation)
    SettingsPanel.tsx   — "Assumptions" slide-over: edit frequency counts & persona capacity
    nodes/
      TaskNode.tsx       — task card node
      FlowNode.tsx       — sub-flow reference node
      DecisionNode.tsx   — diamond gateway node (Yes/No branches)
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

1. **Supabase persistence** — replace in-memory store with Supabase Realtime; collaborative editing.
2. **Org chart & personas** — attach job titles, personas, and emails to flow owners; enable workflow handover between team members via email.
3. **Value-flow analysis** — annotate where business value is created/destroyed and surface highest-ROI automation targets.
