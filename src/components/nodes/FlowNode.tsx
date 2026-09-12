import { memo, useEffect, useMemo } from 'react';
import { Handle, Position, useUpdateNodeInternals, type NodeProps } from '@xyflow/react';
import { useShallow } from 'zustand/react/shallow';
import { useWorkflowStore } from '@/store/workflowStore';
import { getFlowEntries } from '@/lib/entries';
import { getFlowExits, type FlowExit } from '@/lib/exits';
import type { FlowRefData } from '@/types';
import styles from './FlowNode.module.css';

/** Rebuild `{ id, label }` pairs from the flat string array the store selector returns. */
function unflatten(flat: string[]): FlowExit[] {
  const out: FlowExit[] = [];
  for (let i = 0; i < flat.length; i += 2) out.push({ id: flat[i], label: flat[i + 1] });
  return out;
}

function FlowNode({ id, data, selected }: NodeProps) {
  const d = data as unknown as FlowRefData;

  // Select a flat array of strings, not objects: `useShallow` compares element-wise with
  // Object.is, so the reference stays stable while the child flow's end nodes are unchanged.
  // Returning freshly-built objects here would make every store write look like a change and
  // trip React's "getSnapshot should be cached" loop.
  const flatExits = useWorkflowStore(
    useShallow((s) => getFlowExits(s.doc, d.childFlowId).flatMap((e) => [e.id, e.label])),
  );
  const flatEntries = useWorkflowStore(
    useShallow((s) => getFlowEntries(s.doc, d.childFlowId).flatMap((e) => [e.id, e.label])),
  );

  const exits = useMemo(() => unflatten(flatExits), [flatExits]);
  const entries = useMemo(() => unflatten(flatEntries), [flatEntries]);

  // React Flow caches handle bounds per node; without this, edges detach or render from (0,0)
  // when an entry or exit is added or removed.
  const handleKey = [...entries, ...exits].map((e) => e.id).join('|');
  const updateNodeInternals = useUpdateNodeInternals();
  useEffect(() => {
    updateNodeInternals(id);
  }, [id, handleKey, updateNodeInternals]);

  // A lone exit still named the generic default carries no information worth a labelled row
  // or the divider that sets it off — just a plain connector, centred on the card's edge, same
  // as a flow node with no named exits at all. Entries work the same way; they have two generic
  // defaults because a `start` node is called "Start" everywhere else in the app, while "Entry"
  // is the name that reads naturally on the parent's card.
  const generic = (label: string, ...defaults: string[]) => defaults.includes(label.trim().toLowerCase());
  const showExitLabels = exits.length > 1 || (exits.length === 1 && !generic(exits[0].label, 'exit'));
  const showEntryLabels = entries.length > 1 || (entries.length === 1 && !generic(entries[0].label, 'start', 'entry'));
  // Labelled entries share the footer band with the exits rather than getting a bar of their own
  // above the title — same divider, same row height, no extra vertical space on the card.
  const showFooter = showEntryLabels || showExitLabels;

  return (
    <div className={`${styles.node} ${selected ? styles.selected : ''}`}>
      {!showEntryLabels && <Handle type="target" position={Position.Left} id={entries[0]?.id} />}
      <div className={styles.header}>
        <span className={styles.icon}>⚡</span>
        <span className={styles.name}>{d.name || 'Untitled Flow'}</span>
      </div>
      {d.description && <div className={styles.desc}>{d.description}</div>}
      {!showExitLabels && <Handle type="source" position={Position.Right} id={exits[0]?.id} />}
      {showFooter && (
        <div className={styles.footer}>
          {showEntryLabels && (
            <div className={styles.entries}>
              {entries.map((en) => (
                <div key={en.id} className={styles.entryRow}>
                  <Handle type="target" id={en.id} position={Position.Left} />
                  <span className={styles.entryLabel}>{en.label}</span>
                </div>
              ))}
            </div>
          )}
          {showExitLabels && (
            <div className={styles.exits}>
              {exits.map((ex) => (
                <div key={ex.id} className={styles.exitRow}>
                  <span className={styles.exitLabel}>{ex.label}</span>
                  <Handle type="source" id={ex.id} position={Position.Right} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default memo(FlowNode);
