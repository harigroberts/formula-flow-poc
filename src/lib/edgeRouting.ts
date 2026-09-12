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
  /** Raw node rects to avoid, *including* the edge's own source and target node — a path can
   *  legitimately need to cross the far side of its own card (see the backwards and
   *  perpendicular cases in orthogonalWaypoints), and the clearance test exempts only the
   *  short stub legs at each handle rather than whole nodes. Inflation happens inside. */
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
// A path's own start/end point sits exactly on its source/target node's border, so the first
// and last stretch of it is trivially "inside" that node's own inflated rect. That much of the
// first and last leg is exempt from the clearance test — set safely above CLEARANCE so a
// genuinely clear short hop between two close nodes can't land exactly on the inflation
// boundary and flicker between routed/unrouted.
//
// The invariant that makes exempting *only* this much correct is STUB > CLEARANCE: a leg
// leaves perpendicular to the border, so it exits the own inflated rect at exactly CLEARANCE
// px, 4px before the exemption ends — no gap. And every interior leg sits at least STUB from
// the handle along the normal, i.e. STUB - CLEARANCE = 8px clear of the inflation, so interior
// legs are never exempted and never need to be.
const OWN_NODE_SKIP = CLEARANCE + 4;
// Two waypoints within this of each other on an axis count as sharing it. Used both to test
// axis-alignment and as the strict-inequality epsilon on the direction predicates below.
const AXIS_EPS = 0.5;
// A split line closer than this to an endpoint can't hold two full-radius corners, and at ~0
// separation it collapses onto a straight line doubling back over both nodes.
const MIN_SPLIT = 2 * CORNER_RADIUS;
// How far past the target's split axis to escape when that happens. 2*STUB keeps both legs at
// >= 2*CORNER_RADIUS, so neither corner gets clamped.
const BACKTRACK = 2 * STUB;
// Below this much cross-axis offset, a mid-split renders as a long straight run plus a narrow
// S-jog with tiny clamped corners. Two nodes on the same row with different measured heights
// sit exactly here (their handles are (h1-h2)/2 apart), and sub-pixel measurement noise makes
// the jog jitter across zero mid-drag. Draw one straight line instead — the slope is ~2° at
// this magnitude over any realistic edge length, so it reads as horizontal, not as a diagonal.
const JOG_SNAP = 6;

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

function dot(a: Point, b: Point): number {
  return a[0] * b[0] + a[1] * b[1];
}

/** Exact segment-vs-rect overlap for an *axis-aligned* segment: its bounding box is the segment
 *  itself, so an AABB test is not an approximation. Unlike sampling the segment at intervals
 *  this cannot tunnel past a rect it only clips, and costs 4 comparisons per rect. */
function segmentHitsAny(a: Point, b: Point, rects: Rect[]): boolean {
  const x0 = Math.min(a[0], b[0]);
  const x1 = Math.max(a[0], b[0]);
  const y0 = Math.min(a[1], b[1]);
  const y1 = Math.max(a[1], b[1]);
  for (const r of rects) {
    if (x1 >= r.x && x0 <= r.x + r.width && y1 >= r.y && y0 <= r.y + r.height) return true;
  }
  return false;
}

/** Moves `from` towards `to` by `by`, clamped to `to`. Both points must share an axis. */
function advance(from: Point, to: Point, by: number): Point {
  const len = distance(from, to);
  if (len <= by) return to;
  const t = by / len;
  return [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t];
}

/** True when none of the polyline's legs cross an (already inflated) obstacle. The first and
 *  last leg are trimmed by OWN_NODE_SKIP at the handle end, since they necessarily start inside
 *  their own node's inflated rect — see that constant for why trimming just those is sound. */
function polylineClear(points: Point[], inflated: Rect[]): boolean {
  const last = points.length - 1;
  for (let i = 0; i < last; i++) {
    let a = points[i];
    let b = points[i + 1];
    if (i === 0) a = advance(a, b, OWN_NODE_SKIP);
    if (i === last - 1) b = advance(b, a, OWN_NODE_SKIP);
    if (distance(a, b) < AXIS_EPS) continue;
    if (segmentHitsAny(a, b, inflated)) return false;
  }
  return true;
}

/** Where to put a split line between two coordinates on the same axis. Normally the midpoint,
 *  but when they're nearly equal the midpoint line collapses onto the two legs it's meant to
 *  separate — for a backwards edge that degenerates into a single line drawn three times over
 *  itself, with the arrowhead pointing the wrong way. Escape past `b` instead. */
function splitCoord(a: number, b: number): number {
  if (Math.abs(b - a) >= MIN_SPLIT) return (a + b) / 2;
  return b + (Math.sign(b - a) || 1) * BACKTRACK;
}

/** The waypoints of the default orthogonal path: out of the source handle, around to the target
 *  handle, every leg horizontal or vertical. This is the shape drawn when nothing is in the way,
 *  and also the last resort when A* fails — so it must be valid for *any* pair of handle
 *  positions, not just the three combos the app currently uses (Right/Top/Bottom → Left).
 *
 *  `S→s1` and `t1→T` are fixed straight stubs whose directions are set by the handle, so only
 *  two things can go wrong: an interior leg pointing back along -sDir, or the leg arriving at t1
 *  pointing along +tDir. Either forces a fixed stub to double back on itself, which reads as an
 *  overshoot-and-loop right at the node (the same failure the A* direction constraints exist to
 *  prevent — see astar()). A leg *perpendicular* to a stub can't violate that stub's
 *  constraint, which is what makes the parallel case below safe for any split value. */
function orthogonalWaypoints(input: RouteInput): Point[] {
  const { sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition } = input;
  const sDir = directionFor(sourcePosition);
  const tDir = directionFor(targetPosition);
  const S: Point = [sourceX, sourceY];
  const T: Point = [targetX, targetY];
  const s1: Point = [S[0] + sDir[0] * STUB, S[1] + sDir[1] * STUB];
  const t1: Point = [T[0] + tDir[0] * STUB, T[1] + tDir[1] * STUB];
  const facing = dot(sDir, tDir); // -1 opposed | 0 perpendicular | +1 same, since both are unit axes
  const sHorizontal = sDir[1] === 0;

  // Handles face each other and the target is ahead: split the *travel* axis at the midpoint
  // between the two handles. The common left-to-right task→task edge. Built from S and T rather
  // than the stub points, because for a gap narrower than 2*STUB the stubs overshoot past each
  // other and a leg from s1 to the split line would run backwards. The midpoint is the same
  // either way ((s1+t1)/2 === (S+T)/2), so for a normal gap this is exactly what collapsing the
  // stub form would give — and for a narrow one it degrades to two short legs instead of a jog.
  if (facing === -1 && dot([T[0] - S[0], T[1] - S[1]], sDir) > AXIS_EPS) {
    if (sHorizontal) {
      if (Math.abs(T[1] - S[1]) <= JOG_SNAP) return [S, T];
      const mx = (S[0] + T[0]) / 2;
      return [S, [mx, S[1]], [mx, T[1]], T];
    }
    if (Math.abs(T[0] - S[0]) <= JOG_SNAP) return [S, T];
    const my = (S[1] + T[1]) / 2;
    return [S, [S[0], my], [T[0], my], T];
  }

  let mid: Point[];
  if (facing === 0) {
    // Perpendicular handles, e.g. a decision's Yes/No leaving top/bottom into a Left target.
    // One corner is enough when the path can keep heading outward from the source and still
    // arrive at t1 from the correct side; that puts no corner on either stub point, so both
    // corners take the full radius. Otherwise turn at both stubs instead: those legs are each
    // perpendicular to the stub they touch, so that form is valid wherever the target sits.
    const delta: Point = [t1[0] - s1[0], t1[1] - s1[1]];
    const natural: Point = sHorizontal ? [t1[0], s1[1]] : [s1[0], t1[1]];
    const elbow: Point = sHorizontal ? [s1[0], t1[1]] : [t1[0], s1[1]];
    const continuesOut = dot(delta, sDir) > AXIS_EPS;
    const arrivesInward = dot(delta, [-tDir[0], -tDir[1]]) > AXIS_EPS;
    mid = [continuesOut && arrivesInward ? natural : elbow];
  } else {
    // Everything else: handles facing the same way, or facing each other with the target behind
    // the source (a backwards edge — the shape a feedback loop's back edge takes). Split the
    // *cross* axis, which leaves the first and last interior legs perpendicular to both stubs.
    const stubsAligned = sHorizontal
      ? Math.abs(s1[0] - t1[0]) < AXIS_EPS
      : Math.abs(s1[1] - t1[1]) < AXIS_EPS;
    if (stubsAligned) {
      // Both stubs already sit on one line, so connect them straight along it. Splitting would
      // put both split points on that same line — an out-and-back spur, not a detour, and its
      // turn is a 180 degree reversal rather than a corner.
      mid = [];
    } else if (sHorizontal) {
      const my = splitCoord(s1[1], t1[1]);
      mid = [[s1[0], my], [t1[0], my]];
    } else {
      const mx = splitCoord(s1[0], t1[0]);
      mid = [[mx, s1[1]], [mx, t1[1]]];
    }
  }

  return [S, s1, ...mid, t1, T];
}

/** Drops any waypoint sitting mid-run on a straight leg. Deliberately *not* stringPull() with an
 *  empty obstacle list: that merges any two waypoints sharing an axis without consulting the one
 *  between them, so it flattens an exact out-and-back detour into a straight line — which would
 *  leave a handle stub doubling back on itself. Merging only collinear, same-direction triples
 *  can't do that. Run dedupe() first: the direction test is ill-defined on a zero-length leg. */
function collapseCollinear(points: Point[]): Point[] {
  if (points.length <= 2) return points;
  const out: Point[] = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const prev = out[out.length - 1];
    const cur = points[i];
    const next = points[i + 1];
    const a: Point = [cur[0] - prev[0], cur[1] - prev[1]];
    const b: Point = [next[0] - cur[0], next[1] - cur[1]];
    const collinear = Math.abs(a[0] * b[1] - a[1] * b[0]) < AXIS_EPS && dot(a, b) > 0;
    if (!collinear) out.push(cur);
  }
  out.push(points[points.length - 1]);
  return out;
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
  if (points.length <= 2) {
    const p0 = points[0];
    const p1 = points[points.length - 1];
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

/** Searches for a way around the nodes an edge would otherwise cross. `inflated` is the
 *  obstacle set already grown by CLEARANCE. Returns null when no route was found within the
 *  search budget — the caller falls back to the default orthogonal path. */
function routeAroundNodes(input: RouteInput, inflated: Rect[]): Route | null {
  const { sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition } = input;
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
  // stringPull keeps a collinear waypoint when the corridor between its neighbours is blocked,
  // which leaves smoothPath rounding a corner that doesn't turn. Dropping a point that lies on
  // the straight segment between its neighbours can't change the drawn shape or its clearance.
  const simplified = collapseCollinear(dedupe(stringPull(fullPoints, inflated)));
  if (simplified.length < 2) return null;

  return smoothPath(simplified);
}

/** The path for one edge: right-angled legs with radiused corners, routed around any node in the
 *  way. The single entry point for every edge type — loop edges differ only in stroke, so they
 *  call this too, which is what keeps all edges in one visual language.
 *
 *  Two tiers: draw the default orthogonal path when it's clear, otherwise search for a way
 *  around. Crucially the clearance test runs against the polyline we would actually *draw* — a
 *  test of some other shape can pass while the drawn path slices straight through a card.
 *
 *  Deliberately not a longer ladder of candidate shapes. Letting one edge use a mid-split while
 *  its neighbour in the same situation picks a different form reads worse than both routing. */
export function edgePath(input: RouteInput): Route {
  const points = orthogonalWaypoints(input);
  const plain = () => smoothPath(collapseCollinear(dedupe(points)));
  if (input.obstacles.length === 0) return plain();

  const inflated = input.obstacles.map((r) => inflate(r, CLEARANCE));
  if (polylineClear(points, inflated)) return plain();

  // A failed search falls through to the default path, which may cross a node — but it's the
  // canonical shape, so the failure mode is a clean-looking wrong path, not a squiggle.
  return routeAroundNodes(input, inflated) ?? plain();
}
