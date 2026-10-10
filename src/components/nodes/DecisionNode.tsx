import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { DecisionData } from '@/types';
import DiffBadge, { diffClass, diffOf } from './DiffBadge';
import styles from './DecisionNode.module.css';

function DecisionNode({ data, selected }: NodeProps) {
  const d = data as unknown as DecisionData;
  const diff = diffOf(data);

  const badge =
    d.historicalDataExists && d.outcomeMeasured && d.outcomeDataSource
      ? { label: 'ML', variant: 'ml' }
      : d.informationCompleteness === 'gut_feel' || d.decisionBasis === 'intuition'
      ? { label: 'gut-feel', variant: 'gut' }
      : null;

  return (
    <div className={`${styles.wrapper} ${selected ? styles.selected : ''}`}>
      <DiffBadge diff={diff} side="left" />
      {/* On the diamond rather than the square wrapper, so the outline follows its shape. */}
      <div className={`${styles.diamond} ${diffClass(diff)}`} />
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
