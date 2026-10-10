import { useEffect, useRef, useState } from 'react';
import type { PlanController } from '@/lib/usePlan';
import { checkState, tally, type PlanTreeNode } from '@/lib/planSelection';
import SubflowIcon from './SubflowIcon';
import styles from './SelectionTree.module.css';

/**
 * The right-hand side of the Plan workspace: what the customer wants built. Strategy sits in its
 * own box on top; below it, the workflow as a tree — each flow's task findings and its sub-flows,
 * nested as on the canvas. Ticking a row ticks everything under it, and ✎ annotates any row.
 * What's ticked or annotated travels with the next message as the selection block.
 *
 * Hand-rolled rather than a library tree, so it stays in the app's own visual language: the same
 * cards, chips and checkboxes as the rest of the workspace, and the canvas's node cues — the
 * teal bolt for sub-flows, ◆ for decisions. Each sub-flow is a card nested in its parent, so the
 * tree's structure reads at a glance.
 */

const confidenceColor: Record<string, string> = {
  high: 'var(--success-ink)',
  medium: 'var(--warning-ink)',
  low: 'var(--fg-subtle)',
};

const GLYPH: Partial<Record<PlanTreeNode['kind'], React.ReactNode>> = {
  subflow: <SubflowIcon size={16} />,
  decision: '◆',
};

function Checkbox({
  state,
  disabled,
  onChange,
  label,
}: {
  state: 'all' | 'some' | 'none';
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === 'some';
  }, [state]);
  return (
    <input
      ref={ref}
      type="checkbox"
      className={styles.checkbox}
      checked={state === 'all'}
      disabled={disabled}
      // A partial row ticks everything on click, like a tri-state tree should.
      onChange={() => onChange(state !== 'all')}
      aria-label={label}
    />
  );
}

function hours(minutes: number) {
  return minutes >= 60 ? `~${Math.round(minutes / 60)}h/mo` : `~${minutes}m/mo`;
}

/** Expand / collapse: a square with a + or −, drawn in CSS so it stays crisp and centred. */
function Expander({ open, onClick, label }: { open: boolean; onClick: () => void; label: string }) {
  return (
    <button
      className={styles.expander}
      onClick={onClick}
      aria-expanded={open}
      aria-label={`${open ? 'Collapse' : 'Expand'} ${label}`}
      title={open ? 'Collapse' : 'Expand'}
    />
  );
}

function TreeRow({ node, plan }: { node: PlanTreeNode; plan: PlanController }) {
  const [open, setOpen] = useState(true);
  const [notesOpen, setNotesOpen] = useState(false);
  const s = plan.selection[node.id];
  const state = checkState(node, plan.selection);
  const showNotes = notesOpen || !!s?.notes;
  const hasChildren = node.children.length > 0;
  const coveredBy = node.coveredBy.filter((id) => plan.selection[id]?.checked);
  const glyph = GLYPH[node.kind];
  const isSubflow = node.kind === 'subflow';
  const names = (ids: string[]) => ids.map((id) => plan.leafNames.get(id) ?? id).join(', ');

  // A sub-flow is a card of its own — heading on the same tint as the Strategy and workflow
  // headers, with everything inside it enclosed — so where each one starts and ends is plain.
  return (
    <li className={isSubflow ? styles.subflowCard : styles.item}>
      <div
        className={[
          styles.row,
          isSubflow ? styles.subflowHead : state === 'all' ? styles.rowChecked : '',
        ].join(' ')}
      >
        {hasChildren ? (
          <Expander open={open} onClick={() => setOpen((o) => !o)} label={node.label} />
        ) : (
          <span className={styles.expanderSpacer} />
        )}
        <Checkbox
          state={state}
          disabled={plan.readOnly}
          onChange={(on) => plan.toggle(node.id, on)}
          label={node.label}
        />
        <div className={styles.main}>
          <div className={styles.top}>
            <span className={`${styles.name} ${isSubflow ? styles.nameSubflow : ''}`}>
              {glyph && <span className={styles.glyph}>{glyph}</span>}
              {node.label}
            </span>
            <span className={styles.chips}>
              {plan.implemented.has(node.id) && (
                <span className={styles.inPlan} title="The end state on show delivers this">
                  ✓ in plan
                </span>
              )}
              {node.noGain && <span className={styles.noGain}>No gain over task-by-task</span>}
              {node.monthlySaved !== undefined && (
                <span className={styles.saving}>{hours(node.monthlySaved)}</span>
              )}
              {node.confidence && (
                <span className={styles.confidence} style={{ color: confidenceColor[node.confidence] }}>
                  {node.confidence}
                </span>
              )}
              <button
                className={`${styles.notesToggle} ${s?.notes ? styles.notesToggleOn : ''}`}
                onClick={() => setNotesOpen((o) => !o)}
                title={showNotes ? 'Hide notes' : 'Add notes or changes for this item'}
              >
                ✎
              </button>
            </span>
          </div>
          {node.detail && <p className={styles.detail}>{node.detail}</p>}
          {node.product && <span className={styles.product}>🤖 {node.product}</span>}
          {coveredBy.length > 0 &&
            (state !== 'none' ? (
              <p className={styles.covered}>
                Also covered by {names(coveredBy)}, which is ticked too — Claude will ask which to
                build.
              </p>
            ) : (
              <p className={styles.coveredMuted}>Covered by {names(coveredBy)}.</p>
            ))}
          {showNotes && (
            <textarea
              className={styles.notes}
              value={s?.notes ?? ''}
              onChange={(e) => plan.setNotes(node.id, e.target.value)}
              placeholder="Changes or constraints for this item — e.g. “use HubSpot, not Salesforce”"
              rows={2}
              disabled={plan.readOnly}
              autoFocus={notesOpen && !s?.notes}
            />
          )}
        </div>
      </div>
      {hasChildren && open && (
        <ul className={styles.children}>
          {node.children.map((c) => (
            <TreeRow key={c.id} node={c} plan={plan} />
          ))}
        </ul>
      )}
    </li>
  );
}

/** A top-level box: Strategy, or the workflow itself. Its header ticks everything in it. */
function GroupCard({ node, plan }: { node: PlanTreeNode; plan: PlanController }) {
  const [open, setOpen] = useState(true);
  const { on, total } = tally(node, plan.selection);

  return (
    <section className={styles.group}>
      <div className={styles.groupHead}>
        <Expander open={open} onClick={() => setOpen((o) => !o)} label={node.label} />
        {total > 0 ? (
          <Checkbox
            state={checkState(node, plan.selection)}
            disabled={plan.readOnly}
            onChange={(checked) => plan.toggle(node.id, checked)}
            label={`All of ${node.label}`}
          />
        ) : (
          <span className={styles.expanderSpacer} />
        )}
        <button className={styles.groupLabel} onClick={() => setOpen((o) => !o)}>
          {node.label}
        </button>
        {total > 0 && (
          <span className={styles.groupCount}>
            {on}/{total}
          </span>
        )}
      </div>
      {open && (
        <>
          {node.note && <p className={styles.groupNote}>{node.note}</p>}
          {node.children.length > 0 && (
            <ul className={styles.list}>
              {node.children.map((c) => (
                <TreeRow key={c.id} node={c} plan={plan} />
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

export default function SelectionTree({ plan }: { plan: PlanController }) {
  const { selected, notes } = plan.counts;
  return (
    <section className={styles.tree}>
      <header className={styles.head}>
        <div>
          <h3 className={styles.title}>Recommendations</h3>
          <p className={styles.sub}>
            {selected} selected · {notes} note{notes === 1 ? '' : 's'}
            {plan.selectionChanged && plan.exchanges.length > 0 && !plan.readOnly && (
              <span className={styles.unsent}> · not sent yet</span>
            )}
          </p>
        </div>
        {(selected > 0 || notes > 0) && !plan.readOnly && (
          <button className="btn-ghost" onClick={plan.clearSelection}>
            Clear
          </button>
        )}
      </header>
      <p className={styles.hint}>
        Tick what the customer wants built — ticking a sub-flow ticks everything in it. Use ✎ to
        change any recommendation. The selection goes with your next message.
      </p>
      <div className={styles.scroll}>
        {plan.tree && (
          <>
            <GroupCard node={plan.tree.strategy} plan={plan} />
            <GroupCard node={plan.tree.workflow} plan={plan} />
          </>
        )}
      </div>
    </section>
  );
}
