import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { TaskData } from '@/types';
import styles from './TaskNode.module.css';

const statusColor: Record<string, string> = {
  todo: 'var(--color-mid-gray)',
  active: 'var(--color-orange)',
  done: 'var(--color-green)',
};

function TaskNode({ data, selected }: NodeProps) {
  const d = data as unknown as TaskData;
  return (
    <div className={`${styles.node} ${selected ? styles.selected : ''}`}>
      <Handle type="target" position={Position.Left} />
      <div className={styles.header}>
        <span
          className={styles.statusDot}
          style={{ background: statusColor[d.status] ?? 'var(--color-mid-gray)' }}
        />
        <span className={styles.name}>{d.name || 'Untitled Task'}</span>
      </div>
      {d.ownerRole && <div className={styles.role}>{d.ownerRole}</div>}
      <div className={styles.badges}>
        {d.isManual !== undefined && (
          <span className={`${styles.badge} ${d.isManual ? styles.badgeManual : styles.badgeAuto}`}>
            {d.isManual ? 'Manual' : 'Automated'}
          </span>
        )}
        {d.humanMinutesPerRun !== undefined && (
          <span className={styles.badge}>{d.humanMinutesPerRun}m</span>
        )}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

export default memo(TaskNode);
