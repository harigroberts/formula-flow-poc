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
        {f.estMonthlyTimeSaved !== undefined && (
          <span className={styles.timeSaved}>📅 ~{f.estMonthlyTimeSaved}m saved/mo</span>
        )}
      </div>
      <p className={styles.rationale}>{f.rationale}</p>
    </div>
  );
}

interface AnalysisPanelProps {
  result: AnalysisResult | null;
  error: string | null;
  loading: boolean;
  onClose: () => void;
}

export default function AnalysisPanel({ result, error, loading, onClose }: AnalysisPanelProps) {
  return (
    <div className={styles.overlay}>
      <div className={styles.panel}>
        <div className={styles.header}>
          <h2 className={styles.heading}>Automation Analysis</h2>
          <button className="btn-ghost" onClick={onClose}>
            ✕
          </button>
        </div>

        {loading && !result && !error && (
          <div className={styles.loading}>
            <span className={styles.spinner} />
            <p>Analysing your flow with Claude Haiku…</p>
          </div>
        )}

        {error && (
          <div className={styles.error}>
            <strong>Analysis failed:</strong> {error}
          </div>
        )}

        {result && (
          <div className={styles.body}>
            <div className={styles.leftCol}>
              <div className={styles.summary}>
                <p>{result.summary}</p>
                {result.totalMonthlyTimeSaved !== undefined && (
                  <p className={styles.totalSaved}>
                    Total potential saving: <strong>
                      ~{Math.round(result.totalMonthlyTimeSaved / 60)}h/month
                    </strong>{' '}
                    ({result.totalMonthlyTimeSaved}m)
                  </p>
                )}
              </div>

              {result.personaUtilisation && result.personaUtilisation.length > 0 && (
                <div className={styles.utilisation}>
                  <h3 className={styles.utilTitle}>Persona utilisation</h3>
                  {result.personaUtilisation.map((u) => (
                    <div key={u.persona} className={styles.utilRow}>
                      <div className={styles.utilHead}>
                        <span className={styles.utilName}>{u.persona}</span>
                        <span className={styles.utilPct}>{Math.round(u.utilisationPct)}%</span>
                      </div>
                      <div className={styles.utilBar}>
                        <div
                          className={styles.utilFill}
                          style={{ width: `${Math.min(100, Math.max(0, u.utilisationPct))}%` }}
                        />
                      </div>
                      <span className={styles.utilDetail}>
                        {Math.round(u.attributedHoursPerMonth)}h attributed of{' '}
                        {Math.round(u.capacityHoursPerMonth)}h capacity / month
                        {u.savedHoursPerMonth !== undefined && (
                          <span className={styles.utilSaving}>
                            {' '}· ~{Math.round(u.savedHoursPerMonth)}h potential saving
                          </span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className={styles.rightCol}>
              {result.findings.length === 0 && (
                <p className={styles.none}>No specific automation opportunities identified.</p>
              )}
              {result.findings.map((f) => (
                <FindingCard key={f.nodeId} f={f} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
