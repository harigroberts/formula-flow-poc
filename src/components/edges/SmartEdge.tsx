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
  label,
  labelStyle,
  labelShowBg,
  labelBgStyle,
  labelBgPadding,
  labelBgBorderRadius,
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
  let labelX: number;
  let labelY: number;
  if (route) {
    ({ path, labelX, labelY } = route);
  } else {
    const [p, lx, ly] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
    path = p;
    labelX = lx;
    labelY = ly;
  }

  return (
    <BaseEdge
      path={path}
      labelX={labelX}
      labelY={labelY}
      label={label}
      labelStyle={labelStyle}
      labelShowBg={labelShowBg}
      labelBgStyle={labelBgStyle}
      labelBgPadding={labelBgPadding}
      labelBgBorderRadius={labelBgBorderRadius}
      markerStart={markerStart}
      markerEnd={markerEnd}
      style={style}
      interactionWidth={20}
    />
  );
}

export default memo(SmartEdge);
