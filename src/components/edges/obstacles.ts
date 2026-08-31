import { createContext } from 'react';
import type { Rect } from '@/lib/edgeRouting';

/**
 * Node id → rect for the current flow, provided by Canvas. `null` means "don't route" (used
 * while a node is being dragged, so edges stay on their plain path and re-route on drop).
 * The full map — including the edge's own source/target node — is what `routeAroundNodes`
 * wants: it exempts samples near an edge's own endpoints from the collision test itself
 * (see OWN_NODE_SKIP in lib/edgeRouting.ts), so a curve that cuts across the far side of its
 * own source/target card is still caught.
 */
export const ObstaclesContext = createContext<Map<string, Rect> | null>(null);
