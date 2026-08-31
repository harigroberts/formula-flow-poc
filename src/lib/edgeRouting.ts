import { Position } from '@xyflow/react';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RouteInput {
  sourceX: number;
  sourceY: number;
  sourcePosition: Position;
  targetX: number;
  targetY: number;
  targetPosition: Position;
  /** Raw node rects to avoid. Callers should exclude the edge's own source/target node —
   *  the curve necessarily starts/ends on that node's border, so including it here would
   *  make every edge look "blocked" by its own endpoint. Inflation happens inside. */
  obstacles: Rect[];
}

export interface Route {
  path: string;
  labelX: number;
  labelY: number;
}

type Point = [number, number];

// Tuned by eye against the seeded "Billing Setup" sub-flow (Payment received? --No--> Chase payment).
const CLEARANCE = 16; // px inflation around each obstacle
const STUB = 24; // px the search start/end is pulled out from the handle before routing
const CORNER_RADIUS = 20; // px pulled back from each waypoint corner when smoothing
const TURN_PENALTY = 2; // extra grid-step cost for a direction change, favours long straight runs
const BEZIER_SAMPLES = 32;
const MIN_CELL = 10; // px, floor on grid cell size
const MAX_GRID_AXIS = 140; // cells per axis, keeps the grid under ~20k cells
const BOUNDS_PADDING = 60; // px search-area margin beyond the obstacles/endpoints
const MAX_EXPANSIONS = 20000;
// Obstacles further than this from the source/target/stub points can't plausibly be on any
// sane route between them, so they're dropped before the grid is built. Without this, the grid's
// bounds (and so its cell size, since MAX_GRID_AXIS caps cells per axis) are driven by every node
// in the whole flow — on a wide canvas that makes every cell large enough for the stub-snapping
// residual below to become a visible kink instead of a sub-pixel rounding error.
const LOCAL_WINDOW = 400;
// A bezier's own start/end point sits exactly on its source/target node's border, so the
// first and last few samples are trivially "inside" that node's own inflated rect. Samples
// within this radius of either endpoint are exempt from the collision test — set safely above
// CLEARANCE so a genuinely clear short hop between two close nodes can't land exactly on the
// inflation boundary and flicker between routed/unrouted.
const OWN_NODE_SKIP = CLEARANCE + 4;

// Duplicated from @xyflow/system's bezier-edge.ts rather than sampling a DOM path, so this
// module stays pure and testable with `tsx`. If xyflow's default curvature ever changes this
// collision check just becomes slightly conservative/permissive — never a wrong final path,
// since the A* fallback still avoids the real obstacles.
function calculateControlOffset(distance: number, curvature: number): number {
  if (distance >= 0) return 0.5 * distance;
  return curvature * 25 * Math.sqrt(-distance);
}

function getControlPoint(
  pos: Position,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  c: number,
): Point {
  switch (pos) {
    case Position.Left:
      return [x1 - calculateControlOffset(x1 - x2, c), y1];
    case Position.Right:
      return [x1 + calculateControlOffset(x2 - x1, c), y1];
    case Position.Top:
      return [x1, y1 - calculateControlOffset(y1 - y2, c)];
    case Position.Bottom:
    default:
      return [x1, y1 + calculateControlOffset(y2 - y1, c)];
  }
}

function cubicPoint(t: number, p0: Point, p1: Point, p2: Point, p3: Point): Point {
  const mt = 1 - t;
  const a = mt * mt * mt;
  const b = 3 * mt * mt * t;
  const c = 3 * mt * t * t;
  const d = t * t * t;
  return [
    a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
    a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1],
  ];
}

function inflate(r: Rect, by: number): Rect {
  return { x: r.x - by, y: r.y - by, width: r.width + 2 * by, height: r.height + 2 * by };
}

function pointInRect(x: number, y: number, r: Rect): boolean {
  return x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height;
}

function pointHitsAny(x: number, y: number, rects: Rect[]): boolean {
  for (const r of rects) if (pointInRect(x, y, r)) return true;
  return false;
}

function bezierClear(input: RouteInput, inflated: Rect[]): boolean {
  const { sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition } = input;
  const curvature = 0.25;
  const c1 = getControlPoint(sourcePosition, sourceX, sourceY, targetX, targetY, curvature);
  const c2 = getControlPoint(targetPosition, targetX, targetY, sourceX, sourceY, curvature);
  const p0: Point = [sourceX, sourceY];
  const p3: Point = [targetX, targetY];
  for (let i = 1; i < BEZIER_SAMPLES; i++) {
    const t = i / BEZIER_SAMPLES;
    const point = cubicPoint(t, p0, c1, c2, p3);
    if (distance(point, p0) < OWN_NODE_SKIP || distance(point, p3) < OWN_NODE_SKIP) continue;
    if (pointHitsAny(point[0], point[1], inflated)) return false;
  }
  return true;
}

function directionFor(pos: Position): Point {
  switch (pos) {
    case Position.Left:
      return [-1, 0];
    case Position.Right:
      return [1, 0];
    case Position.Top:
      return [0, -1];
    case Position.Bottom:
    default:
      return [0, 1];
  }
}

interface GridConfig {
  minX: number;
  minY: number;
  cellSize: number;
  cols: number;
  rows: number;
}

function buildGrid(points: Point[], obstacles: Rect[]): GridConfig {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of obstacles) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.width);
    maxY = Math.max(maxY, r.y + r.height);
  }
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  minX -= BOUNDS_PADDING;
  minY -= BOUNDS_PADDING;
  maxX += BOUNDS_PADDING;
  maxY += BOUNDS_PADDING;

  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  const cellSize = Math.max(MIN_CELL, Math.ceil(Math.max(width, height) / MAX_GRID_AXIS));
  const cols = Math.max(1, Math.ceil(width / cellSize));
  const rows = Math.max(1, Math.ceil(height / cellSize));
  return { minX, minY, cellSize, cols, rows };
}

/** Drops obstacles that can't plausibly matter for a route between `keyPoints`, so the grid's
 *  bounds — and therefore its cell size — reflect only the local area actually being searched. */
function relevantObstacles(inflated: Rect[], keyPoints: Point[]): Rect[] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of keyPoints) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  minX -= LOCAL_WINDOW;
  minY -= LOCAL_WINDOW;
  maxX += LOCAL_WINDOW;
  maxY += LOCAL_WINDOW;
  return inflated.filter((r) => r.x < maxX && r.x + r.width > minX && r.y < maxY && r.y + r.height > minY);
}

function toCell(grid: GridConfig, x: number, y: number): [number, number] {
  const cx = Math.min(grid.cols - 1, Math.max(0, Math.floor((x - grid.minX) / grid.cellSize)));
  const cy = Math.min(grid.rows - 1, Math.max(0, Math.floor((y - grid.minY) / grid.cellSize)));
  return [cx, cy];
}

function cellCenter(grid: GridConfig, cx: number, cy: number): Point {
  return [grid.minX + (cx + 0.5) * grid.cellSize, grid.minY + (cy + 0.5) * grid.cellSize];
}

function buildBlocked(grid: GridConfig, inflated: Rect[]): Uint8Array {
  const blocked = new Uint8Array(grid.cols * grid.rows);
  for (let cy = 0; cy < grid.rows; cy++) {
    for (let cx = 0; cx < grid.cols; cx++) {
      const [x, y] = cellCenter(grid, cx, cy);
      if (pointHitsAny(x, y, inflated)) blocked[cy * grid.cols + cx] = 1;
    }
  }
  return blocked;
}

// Lazy-deletion binary min-heap over state ids, ordered by an external f-score array.
class MinHeap {
  private heap: number[] = [];
  constructor(private fScore: Float64Array) {}

  get size(): number {
    return this.heap.length;
  }

  push(state: number): void {
    this.heap.push(state);
    let i = this.heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.fScore[this.heap[parent]] <= this.fScore[this.heap[i]]) break;
      [this.heap[parent], this.heap[i]] = [this.heap[i], this.heap[parent]];
      i = parent;
    }
  }

  pop(): number {
    const top = this.heap[0];
    const last = this.heap.pop() as number;
    if (this.heap.length > 0) {
      this.heap[0] = last;
      let i = 0;
      const n = this.heap.length;
      for (;;) {
        let smallest = i;
        const l = 2 * i + 1;
        const r = 2 * i + 2;
        if (l < n && this.fScore[this.heap[l]] < this.fScore[this.heap[smallest]]) smallest = l;
        if (r < n && this.fScore[this.heap[r]] < this.fScore[this.heap[smallest]]) smallest = r;
        if (smallest === i) break;
        [this.heap[i], this.heap[smallest]] = [this.heap[smallest], this.heap[i]];
        i = smallest;
      }
    }
    return top;
  }
}

const CELL_DIRS: Point[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** Maps a unit direction vector to its CELL_DIRS index. */
function dirIndex(v: Point): number {
  if (v[0] === 1) return 0;
  if (v[0] === -1) return 1;
  if (v[1] === 1) return 2;
  return 3; // v[1] === -1
}

/** 4-neighbour grid A* with a turn penalty, states = (cell, arrival direction). `startDir` seeds
 *  the search as if it had just arrived moving in that direction — continuing the stub's outward
 *  direction is then free, while turning (including an immediate reversal) costs the turn penalty
 *  like any other turn. `goalDir` is a hard constraint: the search only terminates at the goal
 *  cell when it arrives moving in that exact direction. Both matter for the same reason — the
 *  cell path is stitched to two *fixed* straight segments (handle → stub, stub → handle) whose
 *  directions are physically fixed by the node's handle position. A cell path that arrives at
 *  either end moving the "wrong" way forces that fixed segment to double back on it, which is
 *  what an unconstrained search occasionally produced: a visible overshoot-and-loop right at the
 *  node it was entering. Returns cell coordinates, or null if unreachable or the search exceeds
 *  MAX_EXPANSIONS. */
function astar(
  grid: GridConfig,
  blocked: Uint8Array,
  start: [number, number],
  goal: [number, number],
  startDir: number,
  goalDir: number,
): [number, number][] | null {
  const { cols, rows } = grid;
  const startCell = start[1] * cols + start[0];
  const goalCell = goal[1] * cols + goal[0];
  const numStates = cols * rows * 4;

  const gScore = new Float64Array(numStates).fill(Infinity);
  const fScore = new Float64Array(numStates).fill(Infinity);
  const cameFrom = new Int32Array(numStates).fill(-1);
  const closed = new Uint8Array(numStates);

  const heuristic = (cell: number) => {
    const cx = cell % cols;
    const cy = (cell / cols) | 0;
    return Math.abs(cx - goal[0]) + Math.abs(cy - goal[1]);
  };

  const startState = startCell * 4 + startDir;
  gScore[startState] = 0;
  fScore[startState] = heuristic(startCell);

  const heap = new MinHeap(fScore);
  heap.push(startState);

  let expansions = 0;
  while (heap.size > 0) {
    if (++expansions > MAX_EXPANSIONS) return null;
    const state = heap.pop();
    if (closed[state]) continue;
    closed[state] = 1;

    const cell = (state / 4) | 0;
    const dir = state % 4;
    if (cell === goalCell && dir === goalDir) {
      const path: [number, number][] = [];
      let s: number | undefined = state;
      while (s !== undefined && s !== -1) {
        const c = (s / 4) | 0;
        path.push([c % cols, (c / cols) | 0]);
        s = cameFrom[s];
      }
      path.reverse();
      return path;
    }

    const cx = cell % cols;
    const cy = (cell / cols) | 0;
    for (let d = 0; d < 4; d++) {
      const nx = cx + CELL_DIRS[d][0];
      const ny = cy + CELL_DIRS[d][1];
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const nCell = ny * cols + nx;
      if (blocked[nCell]) continue;

      const stepCost = 1 + (dir !== d ? TURN_PENALTY : 0);
      const nState = nCell * 4 + d;
      const tentativeG = gScore[state] + stepCost;
      if (tentativeG < gScore[nState]) {
        gScore[nState] = tentativeG;
        cameFrom[nState] = state;
        fScore[nState] = tentativeG + heuristic(nCell);
        heap.push(nState);
      }
    }
  }
  return null;
}

function distance(a: Point, b: Point): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

function dedupe(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || distance(last, p) > 0.5) out.push(p);
  }
  return out;
}

// String-pull merges are restricted to axis-aligned results only. Free-angle string pulling
// (drop a waypoint whenever *any* straight line between its neighbours is clear) collapses a
// staircase of grid steps into a single shallow-diagonal shortcut — technically shorter, but it
// reads as a mistake: a leg that's almost but not quite horizontal. Only merging same-row/
// same-column runs keeps every leg cleanly horizontal or vertical; corners stay rounded.
const AXIS_EPS = 0.5;

/** Collapse a run of collinear grid waypoints into one waypoint, dropping a point whenever the
 *  straight (horizontal or vertical) line between its neighbours is still clear of every
 *  obstacle. */
function stringPull(points: Point[], obstacles: Rect[]): Point[] {
  if (points.length <= 2) return points;
  const clear = (a: Point, b: Point) => {
    const axisAligned = Math.abs(a[0] - b[0]) < AXIS_EPS || Math.abs(a[1] - b[1]) < AXIS_EPS;
    if (!axisAligned) return false;
    const dist = distance(a, b);
    const steps = Math.max(1, Math.ceil(dist / 8));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = a[0] + (b[0] - a[0]) * t;
      const y = a[1] + (b[1] - a[1]) * t;
      if (pointHitsAny(x, y, obstacles)) return false;
    }
    return true;
  };

  const result: Point[] = [points[0]];
  let anchor = 0;
  for (let i = 1; i < points.length; i++) {
    if (i === points.length - 1) {
      result.push(points[i]);
      break;
    }
    if (!clear(points[anchor], points[i + 1])) {
      result.push(points[i]);
      anchor = i;
    }
  }
  return result;
}

/** Rounds each interior waypoint with a quadratic Bézier pulled back along both legs by
 *  CORNER_RADIUS (clamped to half the shorter leg), and places the label at the midpoint by
 *  approximate arc length. */
function smoothPath(points: Point[]): Route {
  if (points.length === 2) {
    const [p0, p1] = points;
    return {
      path: `M ${p0[0]} ${p0[1]} L ${p1[0]} ${p1[1]}`,
      labelX: (p0[0] + p1[0]) / 2,
      labelY: (p0[1] + p1[1]) / 2,
    };
  }

  const segments: { start: Point; end: Point }[] = [];
  let cursor = points[0];
  let d = `M ${cursor[0]} ${cursor[1]}`;

  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const corner = points[i];
    const next = points[i + 1];
    const legIn = distance(prev, corner);
    const legOut = distance(corner, next);
    const r = Math.min(CORNER_RADIUS, legIn / 2, legOut / 2);
    const inDir: Point = [(corner[0] - prev[0]) / legIn, (corner[1] - prev[1]) / legIn];
    const outDir: Point = [(next[0] - corner[0]) / legOut, (next[1] - corner[1]) / legOut];
    const roundStart: Point = [corner[0] - inDir[0] * r, corner[1] - inDir[1] * r];
    const roundEnd: Point = [corner[0] + outDir[0] * r, corner[1] + outDir[1] * r];

    segments.push({ start: cursor, end: roundStart });
    segments.push({ start: roundStart, end: roundEnd });
    d += ` L ${roundStart[0]} ${roundStart[1]} Q ${corner[0]} ${corner[1]}, ${roundEnd[0]} ${roundEnd[1]}`;
    cursor = roundEnd;
  }
  const last = points[points.length - 1];
  segments.push({ start: cursor, end: last });
  d += ` L ${last[0]} ${last[1]}`;

  const total = segments.reduce((sum, s) => sum + distance(s.start, s.end), 0);
  let remaining = total / 2;
  let labelX = last[0];
  let labelY = last[1];
  for (const s of segments) {
    const len = distance(s.start, s.end);
    if (remaining <= len) {
      const t = len === 0 ? 0 : remaining / len;
      labelX = s.start[0] + (s.end[0] - s.start[0]) * t;
      labelY = s.start[1] + (s.end[1] - s.start[1]) * t;
      break;
    }
    remaining -= len;
  }

  return { path: d, labelX, labelY };
}

/** Routes an edge around any node it would otherwise cross. Returns null when the plain
 *  bezier is already clear (caller should render its normal path) or when no route was
 *  found within the search budget. */
export function routeAroundNodes(input: RouteInput): Route | null {
  const { sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, obstacles } = input;
  if (obstacles.length === 0) return null;

  const inflated = obstacles.map((r) => inflate(r, CLEARANCE));
  if (bezierClear(input, inflated)) return null;

  const [sdx, sdy] = directionFor(sourcePosition);
  const [tdx, tdy] = directionFor(targetPosition);
  const stubSourceEnd: Point = [sourceX + sdx * STUB, sourceY + sdy * STUB];
  const stubTargetEnd: Point = [targetX + tdx * STUB, targetY + tdy * STUB];

  const keyPoints: Point[] = [[sourceX, sourceY], [targetX, targetY], stubSourceEnd, stubTargetEnd];
  const localObstacles = relevantObstacles(inflated, keyPoints);

  const grid = buildGrid(keyPoints, localObstacles);
  if (grid.cols * grid.rows > MAX_EXPANSIONS) return null;

  const blocked = buildBlocked(grid, localObstacles);
  const startCell = toCell(grid, stubSourceEnd[0], stubSourceEnd[1]);
  const goalCell = toCell(grid, stubTargetEnd[0], stubTargetEnd[1]);
  // The stub end can land inside some *other* node's clearance zone in dense layouts; force
  // it walkable so the search always has a start/goal rather than failing outright.
  blocked[startCell[1] * grid.cols + startCell[0]] = 0;
  blocked[goalCell[1] * grid.cols + goalCell[0]] = 0;

  // The cell path must leave the start moving outward (matching the fixed handle→stub segment
  // that precedes it) and arrive at the goal moving inward (matching the fixed stub→handle
  // segment that follows it) — see astar()'s doc comment for why.
  const startDir = dirIndex([sdx, sdy]);
  const goalDir = dirIndex([-tdx, -tdy]);
  const cellPath = astar(grid, blocked, startCell, goalCell, startDir, goalDir);
  if (!cellPath) return null;

  const gridPoints = cellPath.map(([cx, cy]) => cellCenter(grid, cx, cy));
  const lastIdx = gridPoints.length - 1;

  // The search guarantees arriving at the right CELL, not the exact analytic stub point, so the
  // path's two end cells get overwritten with the true stub points below. A raw grid step always
  // changes exactly one axis, so every cell center in the straight run leading up to an end cell
  // already shares the *other* axis with it — snap that whole run onto the stub's exact value on
  // that shared axis, not just the immediate neighbour. Fixing up only the one adjacent point
  // left any earlier cell centers still on the old (unsnapped) row/column, which string-pull
  // could then no longer merge across, rendering as a visible diagonal jog once corner-rounded.
  if (lastIdx >= 1) {
    const axis = cellPath[0][0] === cellPath[1][0] ? 0 : 1;
    for (let i = 1; i <= lastIdx - 1 && cellPath[i][axis] === cellPath[0][axis]; i++) {
      gridPoints[i] = axis === 0 ? [stubSourceEnd[0], gridPoints[i][1]] : [gridPoints[i][0], stubSourceEnd[1]];
    }
  }
  gridPoints[0] = stubSourceEnd;

  if (lastIdx >= 1) {
    const axis = cellPath[lastIdx][0] === cellPath[lastIdx - 1][0] ? 0 : 1;
    for (let i = lastIdx - 1; i >= 1 && cellPath[i][axis] === cellPath[lastIdx][axis]; i--) {
      gridPoints[i] = axis === 0 ? [stubTargetEnd[0], gridPoints[i][1]] : [gridPoints[i][0], stubTargetEnd[1]];
    }
  }
  gridPoints[lastIdx] = stubTargetEnd;

  const fullPoints = dedupe([[sourceX, sourceY], ...gridPoints, [targetX, targetY]]);
  const simplified = dedupe(stringPull(fullPoints, inflated));
  if (simplified.length < 2) return null;

  return smoothPath(simplified);
}
