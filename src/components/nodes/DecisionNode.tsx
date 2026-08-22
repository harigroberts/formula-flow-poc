import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { DecisionData } from '@/types';
import styles from './DecisionNode.module.css';

function DecisionNode({ data, selected }: NodeProps) {
  const d = data as unknown as DecisionData;

  const badge =
    d.historicalDataExists && d.outcomeMeasured && d.outcomeDataSource
      ? { label: 'ML', variant: 'ml' }
      : d.informationCompleteness === 'gut_feel' || d.decisionBasis === 'intuition'
      ? { label: 'gut-feel', variant: 'gut' }
      : null;

  return (
    <div className={`${styles.wrapper} ${selected ? styles.selected : ''}`}>
      <div className={styles.diamond} />
      <Handle type="target" position={Position.Left} />
      <Handle type="source" id="yes" position={Position.Top} />
      <Handle type="source" id="no" position={Position.Bottom} />
      <div className={styles.content}>
        <span className={styles.name}>{d.name || 'Decision?'}</span>
      </div>
      {badge && (
        <span className={`${styles.badge} ${styles[badge.variant as 'ml' | 'gut']}`}>
          {badge.label}
        </span>
      )}
      <span className={styles.labelYes}>Yes</span>
      <span className={styles.labelNo}>No</span>
    </div>
  );
}

export default memo(DecisionNode);
