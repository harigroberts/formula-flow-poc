import { useEffect, useRef, useState } from 'react';
import { useWorkflowStore } from '@/store/workflowStore';
import { orderSubFlows, type AnalysisStage } from '@/lib/analysisRunner';
import type {
  AnalysisDepth,
  AnalysisFinding,
  AnalysisResult,
  MultiLevelAnalysis,
  StrategicAnalysis,
  StrategicInitiative,
  SubFlowAnalysis,
} from '@/types';
import styles from './AnalysisPanel.module.css';

const confidenceColor: Record<string, string> = {
  high: 'var(--color-green)',
  medium: 'var(--color-orange)',
  low: 'var(--color-mid-gray)',
};

/** One tab per analysis level — the tab id doubles as the level id. */
type Tab = AnalysisDepth;

const LEVEL_ORDER: Record<AnalysisDepth, number> = { tasks: 1, subflows: 2, strategic: 3 };
const STAGE_ORDER: Record<AnalysisStage, number> = {
  idle: 0,
  tasks: 1,
  subflows: 2,
  strategic: 3,
  done: 4,
};

/** Where this level stands: still queued, in flight, finished, or outside the chosen depth. */
function levelState(
  tab: Tab,
  analysis: MultiLevelAnalysis,
  stage: AnalysisStage,
): 'pending' | 'running' | 'ready' | 'not-run' {
  const level = LEVEL_ORDER[tab];
  if (level > LEVEL_ORDER[analysis.depth]) return 'not-run';
  if (stage === 'done' || STAGE_ORDER[stage] > level) return 'ready';
  if (STAGE_ORDER[stage] === level) return 'running';
  return 'pending';
}

function Spinner({ label }: { label: string }) {
  return (
    <div className={styles.loading}>
      <span className={styles.spinner} />
      <p>{label}</p>
    </div>
  );
}

function Placeholder({ children }: { children: React.ReactNode }) {
  return <p className={styles.none}>{children}</p>;
}

function Minutes({ value, prefix }: { value: number; prefix: string }) {
  return (
    <span className={styles.timeSaved}>
      {prefix} ~{Math.round(value / 60)}h/mo ({value}m)
    </span>
  );
}

/** Shown when the server returned a stored result instead of calling the model. */
function CachedBadge({ when }: { when: boolean | undefined }) {
  if (!when) return null;
  return (
    <span className={styles.cachedBadge} title="Reused from a previous run — the model wasn't called">
      ⓘ cached
    </span>
  );
}

/* ------------------------------------------------------------------ level 1 */

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

function TasksTab({ result, cached }: { result: AnalysisResult; cached?: boolean }) {
  return (
    <div className={styles.body}>
      <div className={styles.leftCol}>
        <div className={styles.summary}>
          {cached && (
            <div className={styles.cachedRow}>
              <CachedBadge when={cached} />
            </div>
          )}
          <p>{result.summary}</p>
          {result.totalMonthlyTimeSaved !== undefined && (
            <p className={styles.totalSaved}>
              Total potential saving:{' '}
              <strong>~{Math.round(result.totalMonthlyTimeSaved / 60)}h/month</strong> (
              {result.totalMonthlyTimeSaved}m)
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
          <Placeholder>No specific automation opportunities identified.</Placeholder>
        )}
        {result.findings.map((f, i) => (
          <FindingCard key={`${f.nodeId}-${i}`} f={f} />
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ level 2 */

function SubFlowCard({ a, cached }: { a: SubFlowAnalysis; cached?: boolean }) {
  if (!a.improvesOnTaskLevel) {
    return (
      <div className={`${styles.card} ${styles.cardMuted}`}>
        <div className={styles.cardHeader}>
          <span className={styles.nodeName}>{a.flowName}</span>
          <span className={styles.badgeGroup}>
            <CachedBadge when={cached} />
            <span className={styles.noGainBadge}>ⓘ No gain over task-by-task</span>
          </span>
        </div>
        <p className={styles.recommendation}>{a.verdict}</p>
        <p className={styles.rationale}>{a.rationale}</p>
      </div>
    );
  }

  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <span className={styles.nodeName}>{a.flowName}</span>
        <span className={styles.badgeGroup}>
          <CachedBadge when={cached} />
          <span
            className={styles.confidence}
            style={{ color: confidenceColor[a.confidence] ?? 'var(--color-mid-gray)' }}
          >
            {a.confidence}
          </span>
        </span>
      </div>
      <p className={styles.verdict}>{a.verdict}</p>
      {a.recommendation && <p className={styles.recommendation}>{a.recommendation}</p>}
      <div className={styles.meta}>
        {a.claudeProduct && <span className={styles.product}>🤖 {a.claudeProduct}</span>}
        {a.incrementalMonthlyTimeSaved !== undefined && (
          <Minutes value={a.incrementalMonthlyTimeSaved} prefix="➕ extra" />
        )}
        {a.estMonthlyTimeSaved !== undefined && (
          <Minutes value={a.estMonthlyTimeSaved} prefix="📅 total" />
        )}
        {a.supersedesNodeIds && a.supersedesNodeIds.length > 0 && (
          <span className={styles.supersedes}>
            replaces {a.supersedesNodeIds.length} task finding
            {a.supersedesNodeIds.length === 1 ? '' : 's'}
          </span>
        )}
      </div>
      <p className={styles.rationale}>{a.rationale}</p>
      {a.risks && a.risks.length > 0 && (
        <ul className={styles.risks}>
          {a.risks.map((r, i) => (
            <li key={i}>⚠ {r}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SubFlowsTab({
  analyses,
  cached,
}: {
  analyses: SubFlowAnalysis[];
  cached: Record<string, boolean>;
}) {
  const doc = useWorkflowStore((s) => s.doc);
  const ordered = orderSubFlows(doc, analyses);
  const improved = ordered.filter((a) => a.improvesOnTaskLevel).length;

  return (
    <div className={styles.singleCol}>
      {ordered.length === 0 ? (
        <Placeholder>
          This workflow has no sub-flows large enough to review as an integrated whole. Add a
          sub-flow with two or more tasks to use this level.
        </Placeholder>
      ) : (
        <>
          <p className={styles.levelIntro}>
            {improved} of {ordered.length} sub-flow{ordered.length === 1 ? '' : 's'} can be improved
            by an integrated approach rather than task by task.
          </p>
          {ordered.map((a) => (
            <SubFlowCard key={a.flowId} a={a} cached={cached[a.flowId]} />
          ))}
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ level 3 */

function InitiativeCard({ init, index }: { init: StrategicInitiative; index: number }) {
  const doc = useWorkflowStore((s) => s.doc);
  const flowNames = init.spansFlowIds
    .map((id) => doc.flows.find((f) => f.id === id)?.name)
    .filter(Boolean) as string[];

  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <span className={styles.nodeName}>
          {index + 1}. {init.title}
        </span>
        <span
          className={styles.confidence}
          style={{ color: confidenceColor[init.confidence] ?? 'var(--color-mid-gray)' }}
        >
          {init.confidence}
        </span>
      </div>
      <p className={styles.recommendation}>{init.recommendation}</p>
      <div className={styles.meta}>
        <span className={styles.product}>🤖 {init.claudeProduct}</span>
        {init.incrementalMonthlyTimeSaved !== undefined && (
          <Minutes value={init.incrementalMonthlyTimeSaved} prefix="➕ extra" />
        )}
        {init.estMonthlyTimeSaved !== undefined && (
          <Minutes value={init.estMonthlyTimeSaved} prefix="📅 total" />
        )}
      </div>
      {flowNames.length > 0 && (
        <p className={styles.spans}>Spans: {flowNames.join(' · ')}</p>
      )}
      {init.sequencing && <p className={styles.sequencing}>🗓 {init.sequencing}</p>}
      <p className={styles.rationale}>{init.rationale}</p>
    </div>
  );
}

function StrategicTab({ s, cached }: { s: StrategicAnalysis; cached?: boolean }) {
  return (
    <div className={styles.singleCol}>
      <div className={s.improvesOnLowerLevels ? styles.verdictBanner : styles.verdictBannerMuted}>
        <span className={styles.verdictHead}>
          <span className={styles.verdictLabel}>
            {s.improvesOnLowerLevels
              ? '✦ Strategic opportunity'
              : 'ⓘ No gain over the lower levels'}
          </span>
          <CachedBadge when={cached} />
        </span>
        <p className={styles.verdictText}>{s.verdict}</p>
      </div>

      <p className={styles.strategicSummary}>{s.summary}</p>

      {s.totalIncrementalMonthlyTimeSaved !== undefined && (
        <p className={styles.totalSaved}>
          Additional saving beyond the task and sub-flow levels:{' '}
          <strong>~{Math.round(s.totalIncrementalMonthlyTimeSaved / 60)}h/month</strong> (
          {s.totalIncrementalMonthlyTimeSaved}m)
        </p>
      )}

      {s.initiatives.map((init, i) => (
        <InitiativeCard key={`${init.title}-${i}`} init={init} index={i} />
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------- panel */

interface AnalysisPanelProps {
  analysis: MultiLevelAnalysis | null;
  stage: AnalysisStage;
  error: string | null;
  onClose: () => void;
}

export default function AnalysisPanel({ analysis, stage, error, onClose }: AnalysisPanelProps) {
  const [tab, setTab] = useState<Tab>('tasks');
  // Once the user picks a tab themselves, stop auto-advancing.
  const pinned = useRef(false);

  useEffect(() => {
    if (pinned.current || stage !== 'done' || !analysis) return;
    if (analysis.strategic) setTab('strategic');
    else if (analysis.subFlows.length > 0) setTab('subflows');
  }, [stage, analysis]);

  const selectTab = (t: Tab) => {
    pinned.current = true;
    setTab(t);
  };

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'tasks', label: 'Tasks', count: analysis?.tasks?.findings.length },
    { id: 'subflows', label: 'Sub-flows', count: analysis?.subFlows.length },
    { id: 'strategic', label: 'Strategy' },
  ];

  const state = analysis ? levelState(tab, analysis, stage) : 'pending';

  return (
    <div className={styles.overlay}>
      <div className={styles.panel}>
        <div className={styles.header}>
          <h2 className={styles.heading}>Automation Analysis</h2>
          <button className="btn-ghost" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className={styles.tabs} role="tablist">
          {tabs.map((t) => {
            const s = analysis ? levelState(t.id, analysis, stage) : 'pending';
            return (
              <button
                key={t.id}
                role="tab"
                aria-selected={tab === t.id}
                className={`${styles.tab} ${tab === t.id ? styles.tabActive : ''}`}
                onClick={() => selectTab(t.id)}
              >
                {t.label}
                {s === 'ready' && t.count !== undefined && (
                  <span className={styles.tabCount}>{t.count}</span>
                )}
                {s === 'running' && <span className={styles.tabDot} />}
              </button>
            );
          })}
        </div>

        {error && (
          <div className={styles.error}>
            <strong>Analysis failed:</strong> {error}
          </div>
        )}

        {!analysis && !error && <Spinner label="Starting analysis…" />}

        {analysis && state === 'not-run' && (
          <Placeholder>
            This level wasn&apos;t part of the run. Choose a deeper option when you analyse to
            include it.
          </Placeholder>
        )}

        {analysis && (state === 'pending' || state === 'running') && !error && (
          <Spinner
            label={
              tab === 'tasks'
                ? 'Analysing each task with Claude Haiku…'
                : tab === 'subflows'
                  ? 'Reviewing each sub-flow as an integrated whole with Claude Opus…'
                  : 'Reviewing the whole workflow with Claude Opus…'
            }
          />
        )}

        {analysis && state === 'ready' && (
          <>
            {tab === 'tasks' &&
              (analysis.tasks ? (
                <TasksTab result={analysis.tasks} cached={analysis.cached.tasks} />
              ) : (
                <Placeholder>No task analysis available.</Placeholder>
              ))}
            {tab === 'subflows' && (
              <SubFlowsTab analyses={analysis.subFlows} cached={analysis.cached} />
            )}
            {tab === 'strategic' &&
              (analysis.strategic ? (
                <StrategicTab s={analysis.strategic} cached={analysis.cached.strategic} />
              ) : (
                <Placeholder>No strategic analysis available.</Placeholder>
              ))}
          </>
        )}
      </div>
    </div>
  );
}
