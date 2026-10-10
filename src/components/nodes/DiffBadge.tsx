import type { NodeDiff } from '@/lib/endState';
import styles from './DiffBadge.module.css';

/**
 * How a node differs between the original workflow and a plan's end state. `WorkflowViewer`
 * stamps it onto `data.diff` at render time — like the loop decoration on edges, it never
 * reaches a stored document — so on the editable canvas this always renders nothing.
 */

const LABEL: Record<NodeDiff['kind'], string> = {
  new: 'New',
  modified: 'Changed',
  removed: 'Removed',
  replaced: 'Replaced',
};

export const diffOf = (data: unknown) => (data as { diff?: NodeDiff }).diff;

/** Class for the card's outline element: rings new and changed work, fades what's gone. */
export function diffClass(diff: NodeDiff | undefined): string {
  return diff ? styles[`host_${diff.kind}`] : '';
}

export default function DiffBadge({
  diff,
  side = 'right',
}: {
  diff: NodeDiff | undefined;
  side?: 'right' | 'left';
}) {
  if (!diff) return null;
  return (
    <span className={`${styles.corner} ${side === 'left' ? styles.left : ''}`}>
      <span className={`${styles.badge} ${styles[diff.kind]}`}>{LABEL[diff.kind]}</span>
      {diff.product && diff.kind !== 'removed' && diff.kind !== 'replaced' && (
        <span className={styles.product} title={`Automated with ${diff.product}`}>
          🤖 {diff.product}
        </span>
      )}
    </span>
  );
}
