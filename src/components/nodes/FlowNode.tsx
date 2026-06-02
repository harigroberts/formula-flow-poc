import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { FlowRefData } from '@/types';
import styles from './FlowNode.module.css';

function FlowNode({ data, selected }: NodeProps) {
  const d = data as unknown as FlowRefData;
  return (
    <div className={`${styles.node} ${selected ? styles.selected : ''}`}>
      <Handle type="target" position={Position.Left} />
      <div className={styles.icon}>⚡</div>
      <div className={styles.name}>{d.name || 'Untitled Flow'}</div>
      {d.description && <div className={styles.desc}>{d.description}</div>}
      <div className={styles.hint}>Double-click to open</div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

export default memo(FlowNode);
