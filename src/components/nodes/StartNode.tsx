import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { TerminalData } from '@/types';
import DiffBadge, { diffClass, diffOf } from './DiffBadge';
import styles from './TerminalNode.module.css';

function StartNode({ data, selected }: NodeProps) {
  const d = data as unknown as TerminalData;
  const diff = diffOf(data);
  return (
    <div className={`${styles.node} ${styles.start} ${selected ? styles.selected : ''} ${diffClass(diff)}`}>
      <DiffBadge diff={diff} />
      <span className={styles.name}>{d.name || 'Start'}</span>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

export default memo(StartNode);
