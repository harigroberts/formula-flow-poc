import { useEffect, useRef, useState } from 'react';
import type { PlanController } from '@/lib/usePlan';
import { exportJson, exportYaml } from '@/lib/persistence';
import PlanChat, { type ViewMode } from './PlanChat';
import SelectionTree from './SelectionTree';
import WorkflowViewer from './WorkflowViewer';
import chatStyles from './ChatTab.module.css';
import styles from './PlanWorkspace.module.css';

/**
 * The Plan workspace: a full-screen overlay where the consultant turns the analysis into what
 * the customer has decided to build.
 *
 * - **Build** — saved plans, the conversation, and the recommendations tree.
 * - **End state** — the proposed workflow on its own, read-only.
 * - **Compare** — the original on top, the end state below, kept on the same flow.
 */

type Mode = 'build' | ViewMode;

function formatWhen(iso: string): string {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

function SessionsRail({ plan }: { plan: PlanController }) {
  return (
    <aside className={chatStyles.sidebar}>
      <button className={chatStyles.newButton} onClick={plan.startSession}>
        + New plan
      </button>

      {plan.persistence === 'no-project' && (
        <p className={chatStyles.sidebarHint}>Turn on Cloud Sync to save plans for this project.</p>
      )}
      {plan.persistence === 'on' && plan.sessions.length === 0 && (
        <p className={chatStyles.sidebarHint}>Saved plans for this project appear here.</p>
      )}

      <ul className={chatStyles.threadList}>
        {plan.sessions.map((c) => (
          <li key={c.id}>
            <button
              className={[
                chatStyles.threadItem,
                c.id === plan.activeId ? chatStyles.threadActive : '',
                c.stale ? chatStyles.threadStale : '',
              ].join(' ')}
              onClick={() => void plan.openSession(c.id)}
              title={c.stale ? 'Made for a different version of the workflow — read only' : c.title}
            >
              <span className={chatStyles.threadTitle}>{c.planTitle ?? c.title}</span>
              <span className={chatStyles.threadMeta}>
                {c.stale ? 'different workflow · read only' : formatWhen(c.updatedAt)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}

export default function PlanWorkspace({
  plan,
  onClose,
}: {
  plan: PlanController;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<Mode>('build');
  /** The flow on show in the End state / Compare views; null = the root. */
  const [flowId, setFlowId] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const { prime, refreshSessions, endState, sourceDoc } = plan;

  // The workspace only opens once there's a finished analysis, so opening it is the signal to
  // cache the thread's prefix ahead of the first message. Idempotent per analysis run.
  useEffect(() => prime(), [prime]);

  // Pick up plans a collaborator on the same sync ID has saved since.
  useEffect(() => {
    void refreshSessions();
  }, [refreshSessions]);

  // A different proposal starts at its root; with none to show, there's only Build.
  useEffect(() => setFlowId(null), [endState]);
  useEffect(() => {
    if (!endState) setMode('build');
  }, [endState]);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === rootRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void rootRef.current?.requestFullscreen();
  };

  const view = (proposalId: string, next: ViewMode) => {
    plan.viewProposal(proposalId);
    setMode(next);
  };

  const shownFlow = flowId ?? sourceDoc?.rootFlowId ?? endState?.doc.rootFlowId ?? '';
  const viewer = {
    flowId: shownFlow,
    onFlowChange: setFlowId,
  };

  const modes: { id: Mode; label: string }[] = [
    { id: 'build', label: 'Build' },
    { id: 'end', label: 'End state' },
    { id: 'compare', label: 'Compare' },
  ];

  return (
    <div className={styles.overlay} ref={rootRef}>
      <header className={styles.header}>
        <div className={styles.titleBlock}>
          <h2 className={styles.heading}>Plan</h2>
          {endState && <span className={styles.subtitle}>{endState.proposal.title}</span>}
        </div>

        <div className={styles.modes} role="tablist">
          {modes.map((m) => (
            <button
              key={m.id}
              role="tab"
              aria-selected={mode === m.id}
              className={`${styles.mode} ${mode === m.id ? styles.modeActive : ''}`}
              onClick={() => setMode(m.id)}
              disabled={m.id !== 'build' && !endState}
              title={m.id !== 'build' && !endState ? 'Available once Claude has proposed a plan' : undefined}
            >
              {m.label}
            </button>
          ))}
        </div>

        <div className={styles.actions}>
          {mode !== 'build' && plan.proposals.length > 1 && (
            <select
              className={styles.versionSelect}
              value={plan.viewing?.id ?? ''}
              onChange={(e) => plan.viewProposal(e.target.value)}
              aria-label="Which proposal to show"
            >
              {plan.proposals.map((p) => (
                <option key={p.id} value={p.id}>
                  Version {p.version}: {p.input.title}
                </option>
              ))}
            </select>
          )}
          {endState && (
            <>
              <button className="btn-ghost" onClick={() => exportJson(endState.doc, 'end-state')}>
                Export JSON
              </button>
              <button className="btn-ghost" onClick={() => exportYaml(endState.doc, 'end-state')}>
                Export YAML
              </button>
            </>
          )}
          <button
            className="btn-ghost"
            onClick={toggleFullscreen}
            title={fullscreen ? 'Exit full screen' : 'Full screen'}
          >
            {fullscreen ? '⤡' : '⛶'}
          </button>
          <button className="btn-ghost" onClick={onClose} title="Close">
            ✕
          </button>
        </div>
      </header>

      {mode === 'build' && (
        <div className={styles.build}>
          <SessionsRail plan={plan} />
          <PlanChat plan={plan} onView={view} />
          <SelectionTree plan={plan} />
        </div>
      )}

      {mode === 'end' && endState && (
        <div className={styles.views}>
          <WorkflowViewer
            doc={endState.doc}
            label="End state"
            diff={endState.endDiff}
            details={endState.details}
            leafNames={plan.leafNames}
            missingText="This sub-flow isn’t part of the end state."
            miniMap
            {...viewer}
          />
          <Legend />
        </div>
      )}

      {mode === 'compare' && endState && sourceDoc && (
        <div className={`${styles.views} ${styles.compare}`}>
          <WorkflowViewer
            doc={sourceDoc}
            label="Original"
            diff={endState.sourceDiff}
            missingText="New in the end state — this sub-flow doesn’t exist in the original."
            {...viewer}
          />
          <WorkflowViewer
            doc={endState.doc}
            label="End state"
            diff={endState.endDiff}
            details={endState.details}
            leafNames={plan.leafNames}
            missingText="Removed — this sub-flow isn’t part of the end state."
            {...viewer}
          />
          <Legend />
        </div>
      )}
    </div>
  );
}

function Legend() {
  return (
    <div className={styles.legend}>
      <span className={`${styles.swatch} ${styles.swatchNew}`}>New</span>
      <span className={`${styles.swatch} ${styles.swatchChanged}`}>Changed</span>
      <span className={`${styles.swatch} ${styles.swatchRemoved}`}>Removed / replaced</span>
      <span className={styles.legendHint}>Double-click a sub-flow to open it · click a node for details</span>
    </div>
  );
}
