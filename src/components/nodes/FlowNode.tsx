import { memo, useEffect, useMemo } from 'react';
import { Handle, Position, useUpdateNodeInternals, type NodeProps } from '@xyflow/react';
import { useShallow } from 'zustand/react/shallow';
import { useWorkflowStore } from '@/store/workflowStore';
import { getFlowExits, type FlowExit } from '@/lib/exits';
import type { FlowRefData } from '@/types';
import styles from './FlowNode.module.css';

function FlowNode({ id, data, selected }: NodeProps) {
  const d = data as unknown as FlowRefData;

  // Select a flat array of strings, not objects: `useShallow` compares element-wise with
  // Object.is, so the reference stays stable while the child flow's end nodes are unchanged.
  // Returning freshly-built objects here would make every store write look like a change and
  // trip React's "getSnapshot should be cached" loop.
  const flat = useWorkflowStore(
    useShallow((s) => getFlowExits(s.doc, d.childFlowId).flatMap((e) => [e.id, e.label])),
  );

  const exits = useMemo(() => {
    const out: FlowExit[] = [];
    for (let i = 0; i < flat.length; i += 2) out.push({ id: flat[i], label: flat[i + 1] });
    return out;
  }, [flat]);

  // React Flow caches handle bounds per node; without this, edges detach or render from (0,0)
  // when an exit is added or removed.
  const handleKey = exits.map((e) => e.id).join('|');
  const updateNodeInternals = useUpdateNodeInternals();
  useEffect(() => {
    updateNodeInternals(id);
  }, [id, handleKey, updateNodeInternals]);

  return (
    <div className={`${styles.node} ${selected ? styles.selected : ''}`}>
      <Handle type="target" position={Position.Left} />
      <div className={styles.icon}>⚡</div>
      <div className={styles.name}>{d.name || 'Untitled Flow'}</div>
      {d.description && <div className={styles.desc}>{d.description}</div>}
      <div className={styles.hint}>Double-click to open</div>
      {exits.length > 1 ? (
        <div className={styles.exits}>
          {exits.map((ex) => (
            <div key={ex.id} className={styles.exitRow}>
              <span className={styles.exitLabel}>{ex.label}</span>
              <Handle type="source" id={ex.id} position={Position.Right} />
            </div>
          ))}
        </div>
      ) : (
        <Handle type="source" position={Position.Right} id={exits[0]?.id} />
      )}
    </div>
  );
}

export default memo(FlowNode);
