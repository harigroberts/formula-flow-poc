import { useCallback, useRef, useState } from 'react';
import { useWorkflowStore } from '@/store/workflowStore';
import { runAnalysis, type AnalysisStage } from '@/lib/analysisRunner';
import type { AnalysisDepth, MultiLevelAnalysis, WorkflowDoc } from '@/types';

/**
 * Owns the multi-level analysis run. Deliberately kept out of the Zustand store —
 * analysis output must never end up in the synced or exported `WorkflowDoc`.
 */
export function useAnalysis() {
  const { getDoc } = useWorkflowStore();

  const [analysis, setAnalysis] = useState<MultiLevelAnalysis | null>(null);
  const [stage, setStage] = useState<AnalysisStage>('idle');
  const [error, setError] = useState<string | null>(null);
  // The doc the run analysed. The chat is built on this, not the live canvas, so it keeps
  // describing what was analysed while the user carries on editing.
  const [analysedDoc, setAnalysedDoc] = useState<WorkflowDoc | null>(null);

  // Guards against a stale run overwriting a newer one's results.
  const runId = useRef(0);

  const run = useCallback(
    async (depth: AnalysisDepth, fresh = false) => {
      const id = ++runId.current;
      const doc = getDoc();
      setAnalysedDoc(doc);
      setError(null);
      setAnalysis({ depth, tasks: null, subFlows: [], strategic: null, cached: {} });
      setStage('tasks');

      try {
        await runAnalysis(
          doc,
          depth,
          ({ stage: s, analysis: a }) => {
            if (id !== runId.current) return;
            setStage(s);
            setAnalysis(a);
          },
          { fresh },
        );
      } catch (err) {
        if (id !== runId.current) return;
        setError(err instanceof Error ? err.message : 'Unknown error');
        setStage('done');
      }
    },
    [getDoc],
  );

  const reset = useCallback(() => {
    runId.current += 1;
    setAnalysis(null);
    setAnalysedDoc(null);
    setStage('idle');
    setError(null);
  }, []);

  return { analysis, analysedDoc, stage, error, run, reset };
}
