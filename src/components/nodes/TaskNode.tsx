import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { TaskData } from '@/types';
import { useDocSelector } from './viewDoc';
import DiffBadge, { diffClass, diffOf } from './DiffBadge';
import styles from './TaskNode.module.css';

function TaskNode({ data, selected }: NodeProps) {
  const d = data as unknown as TaskData;
  const role = useDocSelector((doc) => doc.personas.find((p) => p.id === d.personaId)?.role);
  const diff = diffOf(data);

  // Knowledge-access signal derived from inputAccessibility.
  const knowledge =
    d.inputAccessibility === 'ask'
      ? { label: 'RAG/KB', variant: 'badgeKnowRag' }
      : d.inputAccessibility === 'search' || d.inputAccessibility === 'rebuild'
      ? { label: 'info-gap', variant: 'badgeKnowGap' }
      : null;

  return (
    <div className={`${styles.node} ${selected ? styles.selected : ''} ${diffClass(diff)}`}>
      <DiffBadge diff={diff} />
      <Handle type="target" position={Position.Left} />
      <div className={styles.header}>
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
          <span className={`${styles.badge} ${styles.badgeMeasure}`}>{d.humanMinutesPerRun}m</span>
        )}
        {knowledge && (
          <span className={`${styles.badge} ${styles[knowledge.variant as 'badgeKnowRag' | 'badgeKnowGap']}`}>
            {knowledge.label}
          </span>
        )}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

export default memo(TaskNode);
