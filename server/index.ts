import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import cors from 'cors';
import { LEVELS } from './analyze';
import { primeChat, streamChat } from './chat';
import type { ChatContext, ChatTurn } from '../src/types';
import {
  cacheConfigured,
  computeCacheKey,
  readCache,
  writeCache,
  type CacheLevel,
  type CacheStatus,
} from './cache';

const app = express();
const PORT = 8787;

app.use(
  cors({
    origin: 'http://localhost:5173',
    // Without this the browser cannot read the header and the "cached" badge never appears.
    exposedHeaders: ['X-Analysis-Cache'],
  }),
);
// Level 3 sends the whole doc plus every lower-level finding, so the cap is generous.
app.use(express.json({ limit: '8mb' }));

/** Replies 500 and returns false when there is no key to call the model with. */
function requireApiKey(res: Response): boolean {
  if (process.env.ANTHROPIC_API_KEY) return true;
  res.status(500).json({ error: 'ANTHROPIC_API_KEY is not set. Add it to your .env file.' });
  return false;
}

/**
 * Shared key check, cache lookup and error handling for all three analysis levels.
 *
 * `fresh` is a query param rather than a body field so the request body stays byte-identical
 * to what gets hashed.
 */
function analysisRoute(level: CacheLevel) {
  const { model, promptHash, run } = LEVELS[level];

  return async (req: Request, res: Response) => {
    try {
      if (!requireApiKey(res)) return;

      const fresh = req.query.fresh === '1';
      const cacheKey = computeCacheKey(level, model, promptHash, req.body);

      if (!fresh && cacheConfigured) {
        const cached = await readCache(cacheKey);
        if (cached) {
          console.log(`[analyze:${level}] cache hit ${cacheKey.slice(0, 12)}`);
          res.set('X-Analysis-Cache', 'hit' satisfies CacheStatus).json(cached);
          return;
        }
      }

      const result = await run(req.body);

      const status: CacheStatus = !cacheConfigured ? 'off' : fresh ? 'bypass' : 'miss';
      if (cacheConfigured) {
        await writeCache(cacheKey, level, model, promptHash, req.body, result);
      }

      console.log(`[analyze:${level}] cache ${status} ${cacheKey.slice(0, 12)}`);
      res.set('X-Analysis-Cache', status).json(result);
    } catch (err) {
      console.error(`[analyze:${level}]`, err);
      res.status(500).json({ error: err instanceof Error ? err.message : 'Analysis failed' });
    }
  };
}

// Level 1 — per-node findings across the whole document
app.post('/api/analyze', analysisRoute('tasks'));
// Level 2 — one sub-flow reviewed as an integrated whole
app.post('/api/analyze/subflow', analysisRoute('subflow'));
// Level 3 — the entire workflow reviewed as one system
app.post('/api/analyze/strategic', analysisRoute('strategic'));

/* ------------------------------------------------------------------ chat */

function chatContextOf(body: unknown): ChatContext | null {
  const ctx = (body as { context?: ChatContext } | undefined)?.context;
  return ctx && typeof ctx === 'object' && ctx.workflow && ctx.analysis ? ctx : null;
}

/** The conversation must alternate, starting and ending with the user. */
function chatHistoryOf(body: unknown): ChatTurn[] | null {
  const messages = (body as { messages?: unknown } | undefined)?.messages;
  if (!Array.isArray(messages) || messages.length === 0 || messages.length % 2 === 0) return null;
  const valid = messages.every(
    (m: ChatTurn, i) =>
      m?.role === (i % 2 === 0 ? 'user' : 'assistant') &&
      typeof m.content === 'string' &&
      m.content.trim().length > 0,
  );
  return valid ? (messages as ChatTurn[]) : null;
}

// Chat is conversational, so none of it goes through `analysis_cache` — only Anthropic's
// prompt cache, which `server/chat.ts` lays the thread out for.

// Writes the workflow prefix to the prompt cache before the user's first message.
app.post('/api/chat/prime', async (req, res) => {
  if (!requireApiKey(res)) return;
  const ctx = chatContextOf(req.body);
  if (!ctx) {
    res.status(400).json({ error: 'Missing chat context.' });
    return;
  }
  try {
    await primeChat(ctx);
    res.json({ ok: true });
  } catch (err) {
    console.error('[chat:prime]', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Chat prime failed' });
  }
});

// One streamed assistant reply, as newline-delimited JSON.
app.post('/api/chat', async (req, res) => {
  if (!requireApiKey(res)) return;
  const ctx = chatContextOf(req.body);
  const history = chatHistoryOf(req.body);
  if (!ctx || !history) {
    res.status(400).json({ error: 'Invalid chat request.' });
    return;
  }
  await streamChat(ctx, history, res);
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, hasKey: !!process.env.ANTHROPIC_API_KEY, cache: cacheConfigured });
});

app.listen(PORT, () => {
  console.log(
    `[api] listening on http://localhost:${PORT} (analysis cache ${cacheConfigured ? 'on' : 'off'})`,
  );
});
