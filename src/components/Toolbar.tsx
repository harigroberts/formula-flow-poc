import { useRef, useState } from 'react';
import { useWorkflowStore } from '@/store/workflowStore';
import { exportJson, exportYaml, importFile } from '@/lib/persistence';
import styles from './Toolbar.module.css';

interface ToolbarProps {
  onAnalyse: () => void;
  analysing: boolean;
}

export default function Toolbar({ onAnalyse, analysing }: ToolbarProps) {
  const { getDoc, loadDoc, currentFlow } = useWorkflowStore();
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
        <button className="btn-ghost" onClick={() => exportJson(getDoc())}>
          Export JSON
        </button>
        <button className="btn-ghost" onClick={() => exportYaml(getDoc())}>
          Export YAML
        </button>
        <button className="btn-secondary" onClick={() => fileRef.current?.click()}>
          Import
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
