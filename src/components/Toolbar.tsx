import { useRef, useState } from 'react';
import { useWorkflowStore } from '@/store/workflowStore';
import { exportJson, exportYaml, importFile } from '@/lib/persistence';
import { findAllLoops } from '@/lib/cycles';
import styles from './Toolbar.module.css';

import type { SyncStatus } from '@/lib/useSupabaseSync';

interface ToolbarProps {
  onAnalyse: () => void;
  analysing: boolean;
  onOpenAssumptions: () => void;
  syncEnabled?: boolean;
  onToggleSync?: () => void;
  syncStatus?: SyncStatus;
  syncConfigured?: boolean;
  onOpenSync?: () => void;
}

export default function Toolbar({
  onAnalyse,
  analysing,
  onOpenAssumptions,
  syncEnabled = false,
  onToggleSync,
  syncStatus = 'idle',
  syncConfigured = false,
  onOpenSync,
}: ToolbarProps) {
  const { getDoc, loadDoc, currentFlow, clearCurrentFlow, goToFlow, setSelectedEdge } = useWorkflowStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const [importError, setImportError] = useState('');

  const flow = currentFlow();
  // Document-wide, not just the current flow — the point is to surface a problem hiding in
  // a sub-flow the user isn't looking at. Cheap enough to recompute on every render at this
  // graph size; see the memoised version in Canvas.tsx for why that isn't needed here too.
  const unguardedLoops = findAllLoops(getDoc()).filter((l) => !l.guarded);

  const handleJumpToIssue = () => {
    const first = unguardedLoops[0];
    if (!first) return;
    goToFlow(first.flowId);
    setSelectedEdge(first.backEdgeIds[0]);
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const doc = await importFile(file);
      loadDoc(doc);
      setImportError('');
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      e.target.value = '';
    }
  };

  return (
    <header className={styles.toolbar}>
      <div className={styles.brand}>
        <span className={styles.logo}>◈</span>
        <span className={styles.title}>Formula Flow</span>
      </div>
      <div className={styles.actions}>
        <button
          className="btn-ghost"
          onClick={() => {
            if (confirm(`Clear all nodes and edges in "${flow?.name ?? 'this flow'}"? This cannot be undone.`)) {
              clearCurrentFlow();
            }
          }}
          title="Remove all nodes and edges from the current flow"
        >
          Clear flow
        </button>
        <button className="btn-ghost" onClick={() => exportJson(getDoc())}>
          Export JSON
        </button>
        <button className="btn-ghost" onClick={() => exportYaml(getDoc())}>
          Export YAML
        </button>
        <button className="btn-secondary" onClick={() => fileRef.current?.click()}>
          Import
        </button>
        {syncConfigured && (
          <>
            <span className={styles.syncDot} data-status={syncStatus} />
            <button
              className="btn-ghost"
              onClick={onToggleSync}
              title={syncEnabled ? 'Disable cloud sync' : 'Enable cloud sync'}
            >
              {syncEnabled ? 'Sync on' : 'Sync off'}
            </button>
            {syncEnabled && (
              <button className="btn-ghost" onClick={onOpenSync} title="Sync settings">
                ⇄
              </button>
            )}
          </>
        )}
        <button className="btn-ghost" onClick={onOpenAssumptions} title="Edit org-wide frequency counts and personas">
          <span style={{ fontSize: '1.25em', lineHeight: 1 }}>⚙</span> Assumptions
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,.yaml,.yml"
          style={{ display: 'none' }}
          onChange={handleImport}
        />
        {unguardedLoops.length > 0 && (
          <button
            className={styles.issueChip}
            onClick={handleJumpToIssue}
            title="Jump to the first feedback loop with no decision node to exit through"
          >
            ⚠ {unguardedLoops.length} loop{unguardedLoops.length > 1 ? 's' : ''} with no exit
          </button>
        )}
        <button
          className="btn-primary"
          onClick={onAnalyse}
          disabled={analysing}
          title={`Analyse "${flow?.name ?? 'this flow'}" with Claude`}
        >
          {analysing ? 'Analysing…' : '✦ Analyse this flow'}
        </button>
      </div>
      {importError && <div className={styles.error}>{importError}</div>}
    </header>
  );
}
