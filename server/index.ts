import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { analyzeWorkflow } from './analyze';

const app = express();
const PORT = 8787;

app.use(cors({ origin: 'http://localhost:5173' }));
app.use(express.json({ limit: '2mb' }));

app.post('/api/analyze', async (req, res) => {
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      res.status(500).json({ error: 'ANTHROPIC_API_KEY is not set. Add it to your .env file.' });
      return;
    }
    const result = await analyzeWorkflow(req.body);
    res.json(result);
  } catch (err) {
    console.error('[analyze]', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Analysis failed' });
  }
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, hasKey: !!process.env.ANTHROPIC_API_KEY });
});

app.listen(PORT, () => {
  console.log(`[api] listening on http://localhost:${PORT}`);
});
