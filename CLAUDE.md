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
  nodes: (WFNode & { flowId })[] // tagged with which canvas they live on
  edges: (WFEdge & { flowId })[] // tagged the same way
}
```

**Node types:**
- `task` — a unit of work; carries rich metadata (owner, time, tools, pain points, etc.)
- `flow` — a reference to a child `Flow`; double-click to drill in

Navigation is breadcrumb-based: entering a flow pushes it onto the breadcrumb stack; clicking a parent crumb pops back.

## Directory map

```
src/
  types.ts              — all TypeScript types (WorkflowDoc, TaskData, FlowRefData, AnalysisResult)
  theme.css             — Anthropic brand CSS custom properties + base styles
  store/
    workflowStore.ts    — Zustand store; single source of truth for the whole doc
  lib/
    seed.ts             — seed WorkflowDoc (Customer Onboarding example)
    persistence.ts      — exportJson, exportYaml, importFile
    api.ts              — analyzeFlow() → POST /api/analyze
  components/
    Canvas.tsx          — ReactFlow canvas, drag-drop, double-click drill-in
    Sidebar.tsx         — drag palette (Task, Sub-flow)
    Inspector.tsx       — edit all metadata of the selected node
    Breadcrumbs.tsx     — flow navigation bar
    Toolbar.tsx         — export/import buttons + Analyse trigger
    AnalysisPanel.tsx   — slide-over showing LLM findings
    nodes/
      TaskNode.tsx       — task card node
      FlowNode.tsx       — sub-flow reference node
server/
  index.ts              — Express app; POST /api/analyze, GET /api/health
  prompt.ts             — static system prompt with Claude product catalogue
  analyze.ts            — Anthropic SDK call with prompt caching
```

## Conventions

- **Brand tokens** — all colours and fonts come from CSS custom properties defined in `src/theme.css`; don't hardcode hex values in components.
- **State** — `useWorkflowStore` is the single source of truth. Components never hold their own copy of nodes/edges.
- **Model** — always `claude-haiku-4-5` in `server/analyze.ts`; change there if upgrading.
- **Prompt caching** — the system prompt in `server/analyze.ts` uses `cache_control: { type: 'ephemeral' }` to avoid re-tokenising on repeated calls.
- **CSS Modules** — each component has a co-located `.module.css` file; global utility classes (`.btn-primary`, `.btn-secondary`, `.btn-ghost`) are in `theme.css`.

## Analysis API contract

**Request** `POST /api/analyze`:
```json
{ "flow": Flow, "nodes": WFNode[], "edges": WFEdge[] }
```

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
      "rationale": "The task is purely data extraction from a PDF — a straightforward Claude task.",
      "confidence": "high"
    }
  ],
  "summary": "3 of 5 tasks are strong automation candidates …"
}
```

## Future stages

1. **Supabase persistence** — replace in-memory store with Supabase Realtime; collaborative editing.
2. **Org chart & personas** — attach job titles, personas, and emails to flow owners; enable workflow handover between team members via email.
3. **Value-flow analysis** — annotate where business value is created/destroyed and surface highest-ROI automation targets.
