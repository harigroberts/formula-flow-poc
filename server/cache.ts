import { createHash } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Content-addressed cache for analysis results, backed by the `analysis_cache` table.
 *
 * Lives server-side because the cache key has to include the prompt text and model id —
 * editing a prompt must invalidate that level's entries, and the browser never sees the
 * prompts. The Supabase vars are already in `.env` (loaded by `dotenv/config` in index.ts),
 * so this needs no extra configuration.
 */

const url = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
const key = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY;

export const cacheConfigured = Boolean(url && key);

const client: SupabaseClient | null = cacheConfigured ? createClient(url!, key!) : null;

export type CacheLevel = 'tasks' | 'subflow' | 'strategic';
export type CacheStatus = 'hit' | 'miss' | 'bypass' | 'off';

/**
 * Fields a level receives from the level below. They are sent to the model but excluded
 * from the cache key, so each level is keyed on the slice of the graph it actually owns —
 * editing one sub-flow leaves the other sub-flows' cached verdicts intact.
 */
const EXCLUDE_FROM_KEY: Record<CacheLevel, string[]> = {
  tasks: [],
  subflow: ['taskFindings', 'childAnalyses'],
  strategic: ['taskFindings', 'subFlowAnalyses'],
};

function hasId(v: unknown): v is { id: unknown } {
  return typeof v === 'object' && v !== null && 'id' in v;
}

/**
 * Stable form of a payload for hashing: object keys sorted, and arrays of id-bearing
 * objects sorted by id.
 *
 * Both matter. The store rebuilds arrays as `[...otherNodes, ...updated]` on every change,
 * so `doc.nodes` reorders during ordinary editing, and `updateNodeData` spreads patches over
 * existing data so key order drifts too. Hashing the raw JSON would miss constantly.
 *
 * Plain string arrays are left alone — `tools` / `inputs` / `outputs` and `parentContext.entries`
 * / `parentContext.exits` carry meaning in their order.
 */
export function canonical(value: unknown): unknown {
  if (Array.isArray(value)) {
    const items = value.map(canonical);
    if (items.length > 1 && items.every(hasId)) {
      return [...items].sort((a, b) =>
        String((a as { id: unknown }).id).localeCompare(String((b as { id: unknown }).id)),
      );
    }
    return items;
  }
  if (typeof value === 'object' && value !== null) {
    const entries = Object.keys(value as Record<string, unknown>)
      .sort()
      .map((k) => [k, canonical((value as Record<string, unknown>)[k])] as const);
    return Object.fromEntries(entries);
  }
  return value;
}

export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export function computeCacheKey(
  level: CacheLevel,
  model: string,
  promptHash: string,
  body: unknown,
): string {
  const scoped = { ...(body as Record<string, unknown>) };
  for (const field of EXCLUDE_FROM_KEY[level]) delete scoped[field];

  return sha256(
    JSON.stringify({ level, model, promptHash, input: canonical(scoped) }),
  );
}

/**
 * A cache failure must never fail an analysis — every Supabase call here logs and falls
 * through to a normal model run.
 */
export async function readCache(cacheKey: string): Promise<unknown | null> {
  if (!client) return null;
  try {
    const { data, error } = await client
      .from('analysis_cache')
      .select('output')
      .eq('cache_key', cacheKey)
      .maybeSingle();

    if (error) {
      console.warn('[cache] read failed:', error.message);
      return null;
    }
    if (!data) return null;

    // Fire and forget — the hit counter must not add latency to a cache hit.
    void client.rpc('bump_cache_hit', { key: cacheKey }).then(({ error: rpcError }) => {
      if (rpcError) console.warn('[cache] bump failed:', rpcError.message);
    });

    return data.output;
  } catch (err) {
    console.warn('[cache] read threw:', err instanceof Error ? err.message : err);
    return null;
  }
}

export async function writeCache(
  cacheKey: string,
  level: CacheLevel,
  model: string,
  promptHash: string,
  input: unknown,
  output: unknown,
): Promise<void> {
  if (!client) return;
  try {
    // Upsert so a forced re-run replaces the stale entry rather than colliding with it.
    const { error } = await client.from('analysis_cache').upsert(
      {
        cache_key: cacheKey,
        level,
        model,
        prompt_hash: promptHash,
        input,
        output,
        last_used_at: new Date().toISOString(),
      },
      { onConflict: 'cache_key' },
    );
    if (error) console.warn('[cache] write failed:', error.message);
  } catch (err) {
    console.warn('[cache] write threw:', err instanceof Error ? err.message : err);
  }
}
