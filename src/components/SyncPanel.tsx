import { useState } from 'react';
import type { SyncStatus } from '@/lib/useSupabaseSync';
import styles from './SyncPanel.module.css';

const STATUS_TEXT: Record<SyncStatus, string> = {
  idle: 'Sync is off',
  connecting: 'Connecting…',
  saving: 'Saving…',
  synced: 'Synced',
  error: 'Sync error',
};

interface SyncPanelProps {
  syncEnabled: boolean;
  status: SyncStatus;
  workflowId: string | null;
  error: string | null;
  onClose: () => void;
  onImportById: (id: string) => Promise<void>;
  onDisableSync: () => void;
  onNewWorkflow: () => void;
}

export default function SyncPanel({
  syncEnabled,
  status,
  workflowId,
  error,
  onClose,
  onImportById,
  onDisableSync,
  onNewWorkflow,
}: SyncPanelProps) {
  const [importId, setImportId] = useState('');
  const [copied, setCopied] = useState(false);
  const [importError, setImportError] = useState('');

  const handleCopy = async () => {
    if (!workflowId) return;
    await navigator.clipboard.writeText(workflowId);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleLoad = async () => {
    if (!importId.trim()) return;
    setImportError('');
    try {
      await onImportById(importId);
      setImportId('');
    } catch {
      setImportError('Could not load workflow. Check the ID and try again.');
    }
  };

  const handleNewWorkflow = () => {
    if (
      confirm(
        'Start a new workflow? This will create a new sync ID and disconnect from the current one.'
      )
    ) {
      onNewWorkflow();
    }
  };

  const statusText =
    status === 'error' && error
      ? `Sync error — ${error}`
      : STATUS_TEXT[status];

  return (
    <div className={styles.overlay}>
      <div className={styles.panel}>
        <div className={styles.header}>
          <h2 className={styles.heading}>Cloud Sync</h2>
          <button className="btn-ghost" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className={styles.body}>
          {/* Status */}
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Status</h3>
            <div className={styles.statusRow}>
              <span className={styles.dot} data-status={status} />
              <span className={styles.statusText}>{statusText}</span>
            </div>
          </section>

          {/* Sync ID */}
          {workflowId && (
            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>Sync ID</h3>
              <div className={styles.idRow}>
                <input
                  className={styles.idInput}
                  value={workflowId}
                  readOnly
                />
                <button className="btn-secondary" onClick={handleCopy}>
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
              <p className={styles.hint}>
                Share this ID so others can open the same workflow and collaborate in real time.
              </p>
            </section>
          )}

          {/* Join another workflow */}
          {syncEnabled && (
            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>Join another workflow</h3>
              <div className={styles.idRow}>
                <input
                  className={styles.idInput}
                  value={importId}
                  onChange={(e) => setImportId(e.target.value)}
                  placeholder="Paste sync ID…"
                />
                <button
                  className="btn-secondary"
                  onClick={handleLoad}
                  disabled={!importId.trim() || status === 'connecting'}
                >
                  {status === 'connecting' ? 'Loading…' : 'Load'}
                </button>
              </div>
              {importError && <p className={styles.importError}>{importError}</p>}
              <p className={styles.hint}>
                This will replace your current local changes with the remote workflow.
              </p>
            </section>
          )}

          {/* Danger zone */}
          {workflowId && (
            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>Danger zone</h3>
              <div className={styles.dangerRow}>
                <button className={styles.dangerBtn} onClick={handleNewWorkflow}>
                  Start a new workflow
                </button>
                {syncEnabled && (
                  <button className={styles.dangerBtn} onClick={onDisableSync}>
                    Disconnect sync
                  </button>
                )}
              </div>
              <p className={styles.hint}>
                Starting a new workflow generates a fresh sync ID. Disconnecting pauses sync
                without clearing your local data.
              </p>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
