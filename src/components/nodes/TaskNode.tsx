import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { TaskData } from '@/types';
import { useWorkflowStore } from '@/store/workflowStore';
import styles from './TaskNode.module.css';

const statusColor: Record<string, string> = {
  todo: 'var(--color-mid-gray)',
  active: 'var(--color-orange)',
  done: 'var(--color-green)',
};

function TaskNode({ data, selected }: NodeProps) {
  const d = data as unknown as TaskData;
  const role = useWorkflowStore((s) =>
    s.doc.personas.find((p) => p.id === d.personaId)?.role
  );
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
      {role && <div className={styles.role}>{role}</div>}
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
