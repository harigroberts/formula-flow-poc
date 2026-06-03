import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { TerminalData } from '@/types';
import styles from './TerminalNode.module.css';

function EndNode({ data, selected }: NodeProps) {
  const d = data as unknown as TerminalData;
  return (
    <div className={`${styles.node} ${styles.end} ${selected ? styles.selected : ''}`}>
      <Handle type="target" position={Position.Left} />
      <span className={styles.name}>{d.name || 'End'}</span>
    </div>
  );
}

export default memo(EndNode);
