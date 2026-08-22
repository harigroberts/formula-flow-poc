import { useState } from 'react';
import type { AnalysisDepth } from '@/types';
import styles from './AnalysisDepthDialog.module.css';

interface DepthOption {
  depth: AnalysisDepth;
  title: string;
  description: string;
  cost: string;
}

const OPTIONS: DepthOption[] = [
  {
    depth: 'tasks',
    title: 'Tasks',
    description: 'Automation and AI opportunities for each task and decision, node by node.',
    cost: '~15s · Haiku 4.5',
  },
  {
    depth: 'subflows',
    title: 'Tasks + sub-flows',
    description:
      'Adds an integrated review of each sub-flow — can one system replace several tasks, rather than automating them one at a time?',
    cost: '~1 min · adds Opus 5',
  },
  {
    depth: 'strategic',
    title: 'Full strategic review',
    description:
      'Adds a whole-workflow recommendation across every sub-flow and department, with a suggested sequencing.',
    cost: '~2 min · adds Opus 5',
  },
];

interface Props {
  onRun: (depth: AnalysisDepth) => void;
  onClose: () => void;
}

export default function AnalysisDepthDialog({ onRun, onClose }: Props) {
  const [selected, setSelected] = useState<AnalysisDepth>('strategic');

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h2 className={styles.heading}>Analyse workflow</h2>
          <button className="btn-ghost" onClick={onClose}>
            ✕
          </button>
        </div>

        <p className={styles.hint}>
          Each level takes the level below it as input, so deeper runs build on — and can supersede —
          the findings above them.
        </p>

        <div className={styles.options}>
          {OPTIONS.map((o) => (
            <button
              key={o.depth}
              type="button"
              className={`${styles.option} ${selected === o.depth ? styles.optionSelected : ''}`}
              onClick={() => setSelected(o.depth)}
            >
              <span className={styles.optionHead}>
                <span className={styles.optionTitle}>{o.title}</span>
                <span className={styles.optionCost}>{o.cost}</span>
              </span>
              <span className={styles.optionDesc}>{o.description}</span>
            </button>
          ))}
        </div>

        <div className={styles.actions}>
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" onClick={() => onRun(selected)}>
            ✦ Analyse
          </button>
        </div>
      </div>
    </div>
  );
}
