import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  useNodesInitialized,
  useNodesState,
  useReactFlow,
  type NodeMouseHandler,
} from '@xyflow/react';
import { ObstaclesContext } from './edges/obstacles';
import {
  DEFAULT_EDGE_OPTIONS,
  FIT_VIEW_OPTIONS,
  MINIMAP_PROPS,
  edgeTypes,
  nodeTypes,
} from './canvas/canvasConfig';
import { useDecoratedEdges, useObstacleMap } from './canvas/useCanvasGeometry';
import { ViewDocContext } from './nodes/viewDoc';
import type { EndStateDetail, NodeDiff } from '@/lib/endState';
import type { FlowRefData, TaskData, WorkflowDoc } from '@/types';
import canvasStyles from './Canvas.module.css';
import styles from './WorkflowViewer.module.css';

/**
 * A read-only canvas for a doc that isn't the one being edited — a plan's end state, or the
 * snapshot an analysis ran on. Same node cards, edges and routing as `Canvas` (via
 * `canvasConfig` / `useCanvasGeometry`), with the node cards reading this doc through
 * `ViewDocContext` instead of the store. Nothing here can change any doc.
 */

interface WorkflowViewerProps {
  doc: WorkflowDoc;
  /** The pill in the corner — "Original", "End state". */
  label: string;
  /** Node id → diff badge, stamped onto node data at render time only. */
  diff?: Map<string, NodeDiff>;
  /** Content for the details card when a node is clicked (the end-state side). */
  details?: Map<string, EndStateDetail>;
  leafNames?: Map<string, string>;
  /** The canvas on show. Controlled, so Compare can keep both panes on the same flow. */
  flowId: string;
  onFlowChange: (flowId: string) => void;
  /** Shown instead of a canvas when `flowId` doesn't exist in this doc. */
  missingText?: string;
  miniMap?: boolean;
}

/** A stable small number per object, so a remount key can say "a different doc / diff". */
const identities = new WeakMap<object, number>();
let nextIdentity = 0;
function identity(obj: object | undefined): number {
  if (!obj) return 0;
  if (!identities.has(obj)) identities.set(obj, ++nextIdentity);
  return identities.get(obj)!;
}

/** Root → … → flowId, by `parentFlowId`. */
function pathTo(doc: WorkflowDoc, flowId: string) {
  const path = [];
  for (let f = doc.flows.find((x) => x.id === flowId); f; f = doc.flows.find((x) => x.id === f!.parentFlowId)) {
    path.unshift(f);
    if (path.length > doc.flows.length) break; // a malformed parent cycle
  }
  return path;
}

export default function WorkflowViewer(props: WorkflowViewerProps) {
  const { doc, flowId, label, onFlowChange, missingText } = props;
  const exists = doc.flows.some((f) => f.id === flowId);
  const crumbs = exists ? pathTo(doc, flowId) : pathTo(doc, doc.rootFlowId);

  return (
    <div className={styles.viewer}>
      <nav className={styles.crumbs}>
        <span className={styles.label}>{label}</span>
        {crumbs.map((f, i) => {
          const active = exists && i === crumbs.length - 1;
          return (
            <span key={f.id} className={styles.crumbGroup}>
              {i > 0 && <span className={styles.sep}>›</span>}
              <button
                className={`${styles.crumb} ${active ? styles.active : ''}`}
                onClick={() => !active && onFlowChange(f.id)}
                disabled={active}
              >
                {f.name}
              </button>
            </span>
          );
        })}
      </nav>
      {exists ? (
        <ViewDocContext.Provider value={doc}>
          {/* One provider per canvas shown: drilling in or swapping the doc starts a fresh
              React Flow store, so nothing from the previous canvas (measurements, viewport)
              leaks into the next. */}
          <ReactFlowProvider key={`${identity(doc)}:${identity(props.diff)}:${flowId}`}>
            <FlowCanvas {...props} />
          </ReactFlowProvider>
        </ViewDocContext.Provider>
      ) : (
        <div className={styles.missing}>{missingText ?? 'This flow is not part of this workflow.'}</div>
      )}
    </div>
  );
}

function FlowCanvas({ doc, flowId, onFlowChange, diff, details, leafNames, miniMap }: WorkflowViewerProps) {
  // The provider is keyed on doc, diff and flow, so these are fixed for the component's life.
  const initialNodes = useMemo(
    () =>
      doc.nodes
        .filter((n) => n.flowId === flowId)
        .map((n) => {
          const d = diff?.get(n.id);
          return { ...n, draggable: false, connectable: false, deletable: false, data: d ? { ...n.data, diff: d } : n.data };
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  // Local node state so React Flow's measurements land on the nodes — the obstacle map for
  // edge routing reads them from there, same as on the editable canvas.
  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const flowEdges = useMemo(() => doc.edges.filter((e) => e.flowId === flowId), []);
  const edges = useDecoratedEdges(doc, flowId, nodes, flowEdges);
  const obstacles = useObstacleMap(nodes);

  // Fit once the nodes are measured; the `fitView` prop alone runs too early.
  const nodesInitialized = useNodesInitialized();
  const { fitView } = useReactFlow();
  const fitted = useRef(false);
  useEffect(() => {
    if (!nodesInitialized || fitted.current) return;
    fitted.current = true;
    void fitView(FIT_VIEW_OPTIONS);
  }, [nodesInitialized, fitView]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = selectedId ? doc.nodes.find((n) => n.id === selectedId) : undefined;

  const onNodeDoubleClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      const child = (node.data as FlowRefData).childFlowId;
      if (node.type === 'flow' && doc.flows.some((f) => f.id === child)) onFlowChange(child);
    },
    [doc, onFlowChange],
  );

  return (
    <div className={`${canvasStyles.canvas} ${styles.canvas}`}>
      <ObstaclesContext.Provider value={obstacles}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onNodeClick={(_e, node) => setSelectedId(node.id)}
          onNodeDoubleClick={onNodeDoubleClick}
          onPaneClick={() => setSelectedId(null)}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          defaultEdgeOptions={DEFAULT_EDGE_OPTIONS}
          fitView
          fitViewOptions={FIT_VIEW_OPTIONS}
          minZoom={0.2}
          nodesDraggable={false}
          // Non-draggable nodes don't get React Flow's `nopan` class, so the pane's zoom handler
          // would swallow a double-click on one before `onNodeDoubleClick` sees it. Here a
          // double-click means "open this sub-flow", so it can't also mean "zoom".
          zoomOnDoubleClick={false}
          nodesConnectable={false}
          edgesFocusable={false}
          deleteKeyCode={null}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="var(--line-strong)" gap={20} size={1.25} />
          <Controls showInteractive={false} />
          {miniMap && <MiniMap {...MINIMAP_PROPS} />}
        </ReactFlow>
      </ObstaclesContext.Provider>

      {selected && (
        <aside className={styles.details}>
          <div className={styles.detailsHead}>
            <span className={styles.detailsName}>{selected.data.name || 'Untitled'}</span>
            <button className="btn-ghost" onClick={() => setSelectedId(null)} aria-label="Close">
              ✕
            </button>
          </div>
          <NodeDetails
            data={selected.data}
            diff={diff?.get(selected.id)}
            detail={details?.get(selected.id)}
            leafNames={leafNames}
            personaRole={doc.personas.find((p) => p.id === (selected.data as TaskData).personaId)?.role}
          />
        </aside>
      )}
    </div>
  );
}

const CHANGE_LABEL = { new: 'New in the end state', modified: 'Changed', removed: 'Removed in the end state', replaced: 'Replaced in the end state' };

function NodeDetails({
  data,
  diff,
  detail,
  leafNames,
  personaRole,
}: {
  data: WorkflowDoc['nodes'][number]['data'];
  diff?: NodeDiff;
  detail?: EndStateDetail;
  leafNames?: Map<string, string>;
  personaRole?: string;
}) {
  const task = data.type === 'task' ? (data as TaskData) : null;
  return (
    <div className={styles.detailsBody}>
      <p className={styles.detailsKind}>{diff ? CHANGE_LABEL[diff.kind] : 'Unchanged'}</p>
      {data.description && <p>{data.description}</p>}
      {task && (personaRole || task.humanMinutesPerRun !== undefined) && (
        <p className={styles.detailsMeta}>
          {personaRole}
          {personaRole && task.humanMinutesPerRun !== undefined && ' · '}
          {task.humanMinutesPerRun !== undefined && `${task.humanMinutesPerRun}m human time per run`}
          {task.isManual === false && ' · automated'}
        </p>
      )}
      {detail?.claudeProduct && (
        <div className={styles.detailsBlock}>
          <span className={styles.detailsLabel}>🤖 {detail.claudeProduct}</span>
          {detail.how && <p>{detail.how}</p>}
        </div>
      )}
      {detail && detail.implements.length > 0 && (
        <div className={styles.detailsBlock}>
          <span className={styles.detailsLabel}>Delivers</span>
          <ul>
            {detail.implements.map((id) => (
              <li key={id}>{leafNames?.get(id) ?? id}</li>
            ))}
          </ul>
        </div>
      )}
      {detail && detail.replaces.length > 0 && (
        <div className={styles.detailsBlock}>
          <span className={styles.detailsLabel}>Takes over from</span>
          <ul>
            {detail.replaces.map((name, i) => (
              <li key={i}>{name}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
