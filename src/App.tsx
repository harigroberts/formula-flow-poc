import { useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { useWorkflowStore } from '@/store/workflowStore';
import { analyzeFlow } from '@/lib/api';
import Toolbar from '@/components/Toolbar';
import Breadcrumbs from '@/components/Breadcrumbs';
import Sidebar from '@/components/Sidebar';
import Canvas from '@/components/Canvas';
import Inspector from '@/components/Inspector';
import AnalysisPanel from '@/components/AnalysisPanel';
import type { AnalysisResult } from '@/types';
import styles from './App.module.css';

export default function App() {
  const { getDoc, currentFlowId } = useWorkflowStore();
  const [analysing, setAnalysing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [showAnalysis, setShowAnalysis] = useState(false);

  const handleAnalyse = async () => {
    setAnalysing(true);
    setAnalysisError(null);
    setShowAnalysis(true);
    try {
      const result = await analyzeFlow(getDoc(), currentFlowId);
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
        <Toolbar onAnalyse={handleAnalyse} analysing={analysing} />
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
            onClose={() => setShowAnalysis(false)}
          />
        )}
        {analysing && !showAnalysis && (
          <div className={styles.analysisToast}>Analysing with Claude Haiku…</div>
        )}
      </div>
    </ReactFlowProvider>
  );
}
