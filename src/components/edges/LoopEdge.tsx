import { memo, useCallback, useContext } from 'react';
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, useStoreApi, type EdgeProps } from '@xyflow/react';
import { useWorkflowStore } from '@/store/workflowStore';
import { routeAroundNodes } from '@/lib/edgeRouting';
import { ObstaclesContext } from './obstacles';
import type { WFEdgeData } from '@/types';
import styles from './LoopEdge.module.css';

interface LoopEdgeData extends WFEdgeData {
  /** Stamped on at render time by Canvas — never part of the stored document. */
  loop?: { guarded: boolean };
}

function LoopEdge({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  markerEnd,
  selected,
}: EdgeProps) {
  const d = data as LoopEdgeData | undefined;
  const guarded = d?.loop?.guarded ?? true;
  const obstacleMap = useContext(ObstaclesContext);

  // The pill sits in React Flow's edge-label-renderer portal, a separate DOM subtree from the
  // edge's own <g> — so clicking it never reaches React Flow's built-in edge click handling.
  // Replicate that handling directly rather than relying on the (much thinner) invisible
  // interaction stroke underneath, which only covers the path centerline.
  const store = useStoreApi();
  const setSelectedEdge = useWorkflowStore((s) => s.setSelectedEdge);
  const handleLabelClick = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation();
      store.getState().addSelectedEdges([id]);
      setSelectedEdge(id);
    },
    [store, id, setSelectedEdge],
  );

  let path: string;
  let labelX: number;
  let labelY: number;

  if (source === target) {
    // getSmoothStepPath degenerates on a self-loop (source and target share a node), so
    // draw a small arc hanging off the node instead.
    const radius = 44;
    const midX = (sourceX + targetX) / 2;
    const midY = Math.max(sourceY, targetY) + radius;
    path = `M ${sourceX} ${sourceY} C ${sourceX} ${sourceY + radius}, ${midX - radius} ${midY}, ${midX} ${midY} C ${midX + radius} ${midY}, ${targetX} ${targetY + radius}, ${targetX} ${targetY}`;
    labelX = midX;
    labelY = midY + 4;
  } else {
    const route = obstacleMap
      ? routeAroundNodes({
          sourceX,
          sourceY,
          sourcePosition,
          targetX,
          targetY,
          targetPosition,
          obstacles: [...obstacleMap.values()],
        })
      : null;

    if (route) {
      path = route.path;
      labelX = route.labelX;
      labelY = route.labelY;
    } else {
      const [p, lx, ly] = getSmoothStepPath({
        sourceX,
        sourceY,
        sourcePosition,
        targetX,
        targetY,
        targetPosition,
        borderRadius: 12,
        offset: 28,
      });
      path = p;
      labelX = lx;
      labelY = ly;
    }
  }

  const color = guarded ? 'var(--color-mustard)' : 'var(--color-error)';

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        interactionWidth={20}
        style={{
          stroke: color,
          strokeWidth: selected ? 2.5 : 2,
          strokeDasharray: '5 4',
        }}
      />
      <EdgeLabelRenderer>
        <div
          className={`${styles.label} nodrag nopan`}
          data-variant={guarded ? 'guarded' : 'unguarded'}
          onClick={handleLabelClick}
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
          }}
        >
          {guarded
            ? d?.retryRatePct !== undefined
              ? `↺ retry · ${d.retryRatePct}%`
              : '↺ retry'
            : '⚠ no exit'}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

export default memo(LoopEdge);
