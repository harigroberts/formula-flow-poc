import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import cors from 'cors';
import { analyzeTasks, analyzeSubFlow, analyzeStrategic } from './analyze';

const app = express();
const PORT = 8787;

app.use(cors({ origin: 'http://localhost:5173' }));
// Level 3 sends the whole doc plus every lower-level finding, so the cap is generous.
app.use(express.json({ limit: '8mb' }));

/** Shared key check + error handling for all three analysis levels. */
function analysisRoute(label: string, run: (payload: unknown) => Promise<unknown>) {
  return async (req: Request, res: Response) => {
    try {
      if (!process.env.ANTHROPIC_API_KEY) {
        res.status(500).json({ error: 'ANTHROPIC_API_KEY is not set. Add it to your .env file.' });
        return;
      }
      res.json(await run(req.body));
    } catch (err) {
      console.error(`[analyze:${label}]`, err);
      res.status(500).json({ error: err instanceof Error ? err.message : 'Analysis failed' });
    }
  };
}

// Level 1 — per-node findings across the whole document
app.post('/api/analyze', analysisRoute('tasks', analyzeTasks));
// Level 2 — one sub-flow reviewed as an integrated whole
app.post('/api/analyze/subflow', analysisRoute('subflow', analyzeSubFlow));
// Level 3 — the entire workflow reviewed as one system
app.post('/api/analyze/strategic', analysisRoute('strategic', analyzeStrategic));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, hasKey: !!process.env.ANTHROPIC_API_KEY });
});

app.listen(PORT, () => {
  console.log(`[api] listening on http://localhost:${PORT}`);
});
