import { useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { useWorkflowStore } from '@/store/workflowStore';
import { analyzeFlow } from '@/lib/api';
import { supabaseConfigured } from '@/lib/supabase';
import { useSupabaseSync } from '@/lib/useSupabaseSync';
import Toolbar from '@/components/Toolbar';
import Breadcrumbs from '@/components/Breadcrumbs';
import Sidebar from '@/components/Sidebar';
import Canvas from '@/components/Canvas';
import Inspector from '@/components/Inspector';
import AnalysisPanel from '@/components/AnalysisPanel';
import SettingsPanel from '@/components/SettingsPanel';
import SyncPanel from '@/components/SyncPanel';
import type { AnalysisResult } from '@/types';
import styles from './App.module.css';

export default function App() {
  const { getDoc } = useWorkflowStore();

  const [analysing, setAnalysing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const [syncEnabled, setSyncEnabled] = useState(false);
  const [showSync, setShowSync] = useState(false);

  const {
    status: syncStatus,
    workflowId,
    error: syncError,
    remoteBanner,
    dismissBanner,
    enableSync,
    disableSync,
    importById,
  } = useSupabaseSync(syncEnabled);

  const handleToggleSync = () => {
    if (syncEnabled) {
      disableSync();
      setSyncEnabled(false);
    } else {
      setSyncEnabled(true);
      enableSync();
      setShowSync(true);
    }
  };

  const handleAnalyse = async () => {
    setAnalysing(true);
    setAnalysisError(null);
    setShowAnalysis(true);
    try {
      const result = await analyzeFlow(getDoc(), getDoc().rootFlowId);
      setAnalysisResult(result);
    } catch (err) {
      setAnalysisError(err instanceof Error ? err.message : 'Unknown error');
      setAnalysisResult(null);
    } finally {
      setAnalysing(false);
    }
  };

  return (
    <ReactFlowProvider>
      <div className={styles.app}>
        <Toolbar
          onAnalyse={handleAnalyse}
          analysing={analysing}
          onOpenAssumptions={() => setShowSettings(true)}
          syncEnabled={syncEnabled}
          onToggleSync={handleToggleSync}
          syncStatus={syncStatus}
          syncConfigured={supabaseConfigured}
          onOpenSync={() => setShowSync(true)}
        />
        <div className={styles.body}>
          <div className={styles.main}>
            <Breadcrumbs />
            <div className={styles.canvasRow}>
              <Sidebar />
              <Canvas />
              <Inspector />
            </div>
          </div>
        </div>

        {showAnalysis && (
          <AnalysisPanel
            result={analysisResult}
            error={analysisError}
            loading={analysing}
            onClose={() => setShowAnalysis(false)}
          />
        )}
        {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
        {showSync && (
          <SyncPanel
            syncEnabled={syncEnabled}
            status={syncStatus}
            workflowId={workflowId}
            error={syncError}
            onClose={() => setShowSync(false)}
            onImportById={importById}
            onDisableSync={() => {
              disableSync();
              setSyncEnabled(false);
            }}
            onNewWorkflow={() => {
              localStorage.removeItem('ff_workflow_id');
              disableSync();
              setSyncEnabled(false);
              // Small delay so state settles before re-enabling
              setTimeout(() => {
                setSyncEnabled(true);
                enableSync();
              }, 50);
            }}
          />
        )}

        {remoteBanner && (
          <div className={styles.analysisToast} onClick={dismissBanner}>
            Flow updated by another user
          </div>
        )}
      </div>
    </ReactFlowProvider>
  );
}
