import { useEffect, useRef, useState } from 'react';
import type { PlanController } from '@/lib/usePlan';
import {
  checkState,
  selectableLeaves,
  type SelectionGroup,
  type SelectionItem,
  type SelectionLeaf,
} from '@/lib/planSelection';
import styles from './SelectionTree.module.css';

/**
 * The right-hand side of the Plan workspace: every recommendation from the three analysis
 * levels, to tick ("the customer wants this built") and annotate ("…but in HubSpot"). What's
 * ticked or annotated travels with the next message as the selection block.
 */

const confidenceColor: Record<string, string> = {
  high: 'var(--success-ink)',
  medium: 'var(--warning-ink)',
  low: 'var(--fg-subtle)',
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
      onChange={(e) => onChange(e.target.checked)}
      aria-label={label}
    />
  );
}

function hours(minutes: number) {
  return minutes >= 60 ? `~${Math.round(minutes / 60)}h/mo` : `~${minutes}m/mo`;
}

function LeafRow({ leaf, plan }: { leaf: SelectionLeaf; plan: PlanController }) {
  const s = plan.selection[leaf.id];
  const [notesOpen, setNotesOpen] = useState(false);
  const showNotes = notesOpen || !!s?.notes;
  const coveredBy = leaf.supersededBy.filter((id) => plan.selection[id]?.checked);

  if (leaf.disabled) {
    return (
      <div className={`${styles.leaf} ${styles.leafDisabled}`}>
        <span className={styles.noCheck}>–</span>
        <div className={styles.leafMain}>
          <div className={styles.leafTop}>
            <span className={styles.leafName}>{leaf.label}</span>
            <span className={styles.noGain}>No gain over task-by-task</span>
          </div>
          <p className={styles.leafDetail}>{leaf.detail}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`${styles.leaf} ${s?.checked ? styles.leafChecked : ''}`}>
      <Checkbox
        state={s?.checked ? 'all' : 'none'}
        disabled={plan.readOnly}
        onChange={(checked) => plan.setChecked([leaf.id], checked)}
        label={leaf.label}
      />
      <div className={styles.leafMain}>
        <div className={styles.leafTop}>
          <span className={styles.leafName}>{leaf.label}</span>
          <span className={styles.chips}>
            {plan.implemented.has(leaf.id) && (
              <span className={styles.inPlan} title="The end state on show delivers this">
                ✓ in plan
              </span>
            )}
            {leaf.monthlySaved !== undefined && (
              <span className={styles.saving}>{hours(leaf.monthlySaved)}</span>
            )}
            {leaf.confidence && (
              <span className={styles.confidence} style={{ color: confidenceColor[leaf.confidence] }}>
                {leaf.confidence}
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
        <p className={styles.leafDetail}>{leaf.detail}</p>
        {leaf.product && <span className={styles.product}>🤖 {leaf.product}</span>}
        {coveredBy.length > 0 &&
          (s?.checked ? (
            <p className={styles.covered}>
              Overlaps {coveredBy.map((id) => plan.leafNames.get(id) ?? id).join(', ')}, which is
              also ticked — Claude will ask which version to build.
            </p>
          ) : (
            <p className={styles.coveredMuted}>
              Covered by {coveredBy.map((id) => plan.leafNames.get(id) ?? id).join(', ')}.
            </p>
          ))}
        {showNotes && (
          <textarea
            className={styles.notes}
            value={s?.notes ?? ''}
            onChange={(e) => plan.setNotes(leaf.id, e.target.value)}
            placeholder="Changes or constraints for this item — e.g. “use HubSpot, not Salesforce”"
            rows={2}
            disabled={plan.readOnly}
            autoFocus={notesOpen && !s?.notes}
          />
        )}
      </div>
    </div>
  );
}

function GroupRow({ group, plan, depth }: { group: SelectionGroup; plan: PlanController; depth: number }) {
  const [open, setOpen] = useState(true);
  const leaves = selectableLeaves(group);
  const state = checkState(group, plan.selection);
  const checked = leaves.filter((l) => plan.selection[l.id]?.checked).length;

  return (
    <div className={depth === 0 ? styles.group : styles.subgroup}>
      <div className={styles.groupHead}>
        <button
          className={styles.caret}
          onClick={() => setOpen((o) => !o)}
          aria-label={open ? 'Collapse' : 'Expand'}
        >
          {open ? '▾' : '▸'}
        </button>
        {leaves.length > 0 ? (
          <Checkbox
            state={state}
            disabled={plan.readOnly}
            onChange={(on) => plan.setChecked(leaves.map((l) => l.id), on)}
            label={`All of ${group.label}`}
          />
        ) : (
          <span className={styles.noCheck} />
        )}
        <button className={styles.groupLabel} onClick={() => setOpen((o) => !o)}>
          {group.label}
        </button>
        {leaves.length > 0 && (
          <span className={styles.groupCount}>
            {checked}/{leaves.length}
          </span>
        )}
      </div>
      {open && (
        <div className={styles.children}>
          {group.note && <p className={styles.groupNote}>{group.note}</p>}
          {group.children.map((item: SelectionItem) =>
            item.kind === 'group' ? (
              <GroupRow key={item.id} group={item} plan={plan} depth={depth + 1} />
            ) : (
              <LeafRow key={item.id} leaf={item} plan={plan} />
            ),
          )}
        </div>
      )}
    </div>
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
        Tick what the customer wants built, and use ✎ to change any recommendation. The selection
        goes with your next message.
      </p>
      <div className={styles.scroll}>
        {plan.tree.map((g) => (
          <GroupRow key={g.id} group={g} plan={plan} depth={0} />
        ))}
      </div>
    </section>
  );
}
