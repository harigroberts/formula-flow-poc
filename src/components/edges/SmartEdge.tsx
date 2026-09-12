import { memo, useContext } from 'react';
import { BaseEdge, getBezierPath, type EdgeProps } from '@xyflow/react';
import { routeAroundNodes } from '@/lib/edgeRouting';
import { ObstaclesContext } from './obstacles';

// Default non-loop edge type. Renders the plain bezier React Flow's built-in `default` edge
// would, unless that curve would cross a node — then it routes around it instead. See
// lib/edgeRouting.ts for the routing itself; this component only wires it into React Flow.
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

  let path: string;
  if (route) {
    ({ path } = route);
  } else {
    [path] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
  }

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
