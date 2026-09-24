/**
 * Canonical form of a JSON payload, shared by the server and the browser. The server hashes
 * it for the analysis cache key and serialises it into the chat's cached prompt prefix; the
 * browser hashes it to fingerprint the workflow a saved conversation was about. Keeping one
 * implementation is what makes those agree byte for byte.
 */

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

