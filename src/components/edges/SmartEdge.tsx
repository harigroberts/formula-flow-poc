import { memo, useContext } from 'react';
import { BaseEdge, type EdgeProps } from '@xyflow/react';
import { edgePath } from '@/lib/edgeRouting';
import { ObstaclesContext } from './obstacles';

// Default non-loop edge type: right-angled legs with radiused corners, routed around any node in
// the way. All the geometry lives in lib/edgeRouting.ts — shared with the loopback edge type, so
// every edge on the canvas is one visual language and only the stroke differs. This component
// only wires it into React Flow.
function SmartEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  markerStart,
  markerEnd,
}: EdgeProps) {
  const obstacleMap = useContext(ObstaclesContext);

  const { path } = edgePath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    obstacles: obstacleMap ? [...obstacleMap.values()] : [],
  });

  return (
    <BaseEdge
      path={path}
      markerStart={markerStart}
      markerEnd={markerEnd}
      style={style}
      interactionWidth={20}
    />
  );
}

export default memo(SmartEdge);
