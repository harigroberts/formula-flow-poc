import { useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { supabaseConfigured } from '@/lib/supabase';
import { useSupabaseSync } from '@/lib/useSupabaseSync';
import { useAnalysis } from '@/lib/useAnalysis';
import { useChat } from '@/lib/useChat';
import { usePlan } from '@/lib/usePlan';
import Toolbar from '@/components/Toolbar';
import Breadcrumbs from '@/components/Breadcrumbs';
import Sidebar from '@/components/Sidebar';
import Canvas from '@/components/Canvas';
import Inspector from '@/components/Inspector';
import AnalysisPanel from '@/components/AnalysisPanel';
import AnalysisDepthDialog from '@/components/AnalysisDepthDialog';
import PlanWorkspace from '@/components/PlanWorkspace';
import SettingsPanel from '@/components/SettingsPanel';
import SyncPanel from '@/components/SyncPanel';
import type { AnalysisDepth } from '@/types';
import styles from './App.module.css';

export default function App() {
  const {
    analysis,
    analysedDoc,
    stage,
    error: analysisError,
    run: runAnalysis,
  } = useAnalysis();

  const [showDepthDialog, setShowDepthDialog] = useState(false);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showPlan, setShowPlan] = useState(false);

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

  // Here rather than in the panel, so the conversation survives closing and reopening it. The
  // sync ID is the project conversations are saved under — none while sync is off.
  const chat = useChat(analysedDoc, analysis, stage, analysisError, workflowId);
  // The Plan workspace's session lives here for the same reason, saved under the same sync ID.
  const plan = usePlan(analysedDoc, analysis, stage, analysisError, workflowId);

  const openPlan = () => {
    setShowAnalysis(false);
    setShowPlan(true);
  };

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

  const handleRunAnalysis = (depth: AnalysisDepth, fresh: boolean) => {
    setShowDepthDialog(false);
    setShowAnalysis(true);
    void runAnalysis(depth, fresh);
  };

  return (
    <ReactFlowProvider>
      <div className={styles.app}>
        <Toolbar
          onAnalyse={() => setShowDepthDialog(true)}
          analysing={stage !== 'idle' && stage !== 'done'}
          onOpenAssumptions={() => setShowSettings(true)}
          syncEnabled={syncEnabled}
          onToggleSync={handleToggleSync}
          syncStatus={syncStatus}
          syncConfigured={supabaseConfigured}
          onOpenSync={() => setShowSync(true)}
          onOpenPlan={openPlan}
          planAvailable={plan.available}
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

        {showDepthDialog && (
          <AnalysisDepthDialog
            onRun={handleRunAnalysis}
            onClose={() => setShowDepthDialog(false)}
          />
        )}
        {showAnalysis && (
          <AnalysisPanel
            analysis={analysis}
            stage={stage}
            error={analysisError}
            chat={chat}
            onOpenPlan={plan.available ? openPlan : undefined}
            onClose={() => setShowAnalysis(false)}
          />
        )}
        {showPlan && plan.available && (
          <PlanWorkspace plan={plan} onClose={() => setShowPlan(false)} />
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
