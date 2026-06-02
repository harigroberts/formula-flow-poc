import type { AnalysisResult, AnalysisFinding } from '@/types';
import styles from './AnalysisPanel.module.css';

const confidenceColor: Record<string, string> = {
  high: 'var(--color-green)',
  medium: 'var(--color-orange)',
  low: 'var(--color-mid-gray)',
};

function FindingCard({ f }: { f: AnalysisFinding }) {
  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <span className={styles.nodeName}>{f.nodeName}</span>
        <span
          className={styles.confidence}
          style={{ color: confidenceColor[f.confidence] ?? 'var(--color-mid-gray)' }}
        >
          {f.confidence}
        </span>
      </div>
      <p className={styles.recommendation}>{f.recommendation}</p>
      <div className={styles.meta}>
        <span className={styles.product}>🤖 {f.claudeProduct}</span>
        {f.estTimeSavedPerRun !== undefined && (
          <span className={styles.timeSaved}>⏱ ~{f.estTimeSavedPerRun}m saved/run</span>
        )}
      </div>
      <p className={styles.rationale}>{f.rationale}</p>
    </div>
  );
}

interface AnalysisPanelProps {
  result: AnalysisResult | null;
  error: string | null;
  onClose: () => void;
}

export default function AnalysisPanel({ result, error, onClose }: AnalysisPanelProps) {
  return (
    <div className={styles.overlay}>
      <div className={styles.panel}>
        <div className={styles.header}>
          <h2 className={styles.heading}>Automation Analysis</h2>
          <button className="btn-ghost" onClick={onClose}>
            ✕
          </button>
        </div>

        {error && (
          <div className={styles.error}>
            <strong>Analysis failed:</strong> {error}
          </div>
        )}

        {result && (
          <>
            <div className={styles.summary}>
              <p>{result.summary}</p>
            </div>
            <div className={styles.findings}>
              {result.findings.length === 0 && (
                <p className={styles.none}>No specific automation opportunities identified.</p>
              )}
              {result.findings.map((f) => (
                <FindingCard key={f.nodeId} f={f} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
