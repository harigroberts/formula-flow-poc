import { useRef, useState } from 'react';
import { useWorkflowStore } from '@/store/workflowStore';
import { exportJson, exportYaml, importFile } from '@/lib/persistence';
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
  const { getDoc, loadDoc, currentFlow, clearCurrentFlow } = useWorkflowStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const [importError, setImportError] = useState('');

  const flow = currentFlow();

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
