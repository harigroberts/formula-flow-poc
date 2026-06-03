import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { DecisionData } from '@/types';
import styles from './DecisionNode.module.css';

function DecisionNode({ data, selected }: NodeProps) {
  const d = data as unknown as DecisionData;
  return (
    <div className={`${styles.wrapper} ${selected ? styles.selected : ''}`}>
      <div className={styles.diamond} />
      <Handle type="target" position={Position.Left} />
      <Handle type="source" id="yes" position={Position.Top} />
      <Handle type="source" id="no" position={Position.Bottom} />
      <div className={styles.content}>
        <span className={styles.name}>{d.name || 'Decision?'}</span>
      </div>
      <span className={styles.labelYes}>Yes</span>
      <span className={styles.labelNo}>No</span>
    </div>
  );
}

export default memo(DecisionNode);
