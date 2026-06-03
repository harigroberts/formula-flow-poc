import { useWorkflowStore } from '@/store/workflowStore';
import type { TaskData, FlowRefData, DecisionData, TerminalData } from '@/types';
import styles from './Inspector.module.css';

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className={styles.field}>
      <span className={styles.label}>{label}</span>
      {children}
    </label>
  );
}

function TagInput({
  value,
  onChange,
  placeholder,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
}) {
  const raw = value.join(', ');
  return (
    <input
      className={styles.input}
      defaultValue={raw}
      placeholder={placeholder}
      onBlur={(e) => {
        const tags = e.target.value
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean);
        onChange(tags);
      }}
    />
  );
}

export default function Inspector() {
  const { selectedNode, updateNodeData, deleteNode, selectedNodeId, setSelectedNode } =
    useWorkflowStore();

  const node = selectedNode();
  if (!node) {
    return (
      <aside className={styles.panel}>
        <p className={styles.empty}>Select a node to inspect it.</p>
      </aside>
    );
  }

  const isTask = node.data.type === 'task';
  const isDecision = node.data.type === 'decision';
  const isTerminal = node.data.type === 'start' || node.data.type === 'end';
  const data = node.data;

  const nodeTypeLabel = {
    task: 'Task',
    flow: 'Sub-flow',
    decision: 'Decision',
    start: 'Start',
    end: 'End',
  }[node.data.type] ?? 'Node';

  const update = (patch: Partial<TaskData | FlowRefData | DecisionData | TerminalData>) => {
    updateNodeData(node.id, patch);
  };

  const handleDelete = () => {
    deleteNode(node.id);
    setSelectedNode(null);
  };

  return (
    <aside className={styles.panel}>
      <div className={styles.header}>
        <h2 className={styles.heading}>{nodeTypeLabel}</h2>
        <button className="btn-ghost" onClick={handleDelete} title="Delete node">
          ✕ Delete
        </button>
      </div>

      <div className={styles.fields}>
        <Field label={isDecision ? 'Condition / Question' : 'Name'}>
          <input
            className={styles.input}
            value={(data as TaskData).name}
            onChange={(e) => update({ name: e.target.value })}
            placeholder={isDecision ? 'e.g. Contract approved?' : undefined}
          />
        </Field>

        <Field label="Description">
          <textarea
            className={styles.textarea}
            value={(data as TaskData).description ?? ''}
            onChange={(e) => update({ description: e.target.value })}
            rows={3}
          />
        </Field>

        {(isDecision || isTerminal) && null}

        {isTask && (
          <>
            <Field label="Owner / Role">
              <input
                className={styles.input}
                value={(data as TaskData).ownerRole ?? ''}
                onChange={(e) => update({ ownerRole: e.target.value })}
                placeholder="e.g. Customer Success Manager"
              />
            </Field>

            <Field label="Status">
              <select
                className={styles.select}
                value={(data as TaskData).status ?? 'todo'}
                onChange={(e) =>
                  update({ status: e.target.value as TaskData['status'] })
                }
              >
                <option value="todo">To do</option>
                <option value="active">Active</option>
                <option value="done">Done</option>
              </select>
            </Field>

            <div className={styles.row}>
              <Field label="Human time (min)">
                <input
                  className={styles.input}
                  type="number"
                  min={0}
                  value={(data as TaskData).humanMinutesPerRun ?? ''}
                  onChange={(e) =>
                    update({ humanMinutesPerRun: Number(e.target.value) || undefined })
                  }
                  placeholder="0"
                />
              </Field>
              <Field label="Frequency">
                <input
                  className={styles.input}
                  value={(data as TaskData).frequency ?? ''}
                  onChange={(e) => update({ frequency: e.target.value })}
                  placeholder="e.g. daily"
                />
              </Field>
            </div>

            <Field label="Tools used (comma separated)">
              <TagInput
                value={(data as TaskData).tools ?? []}
                onChange={(v) => update({ tools: v })}
                placeholder="e.g. Salesforce, Gmail"
              />
            </Field>

            <Field label="Inputs (comma separated)">
              <TagInput
                value={(data as TaskData).inputs ?? []}
                onChange={(v) => update({ inputs: v })}
                placeholder="e.g. Signed contract"
              />
            </Field>

            <Field label="Outputs (comma separated)">
              <TagInput
                value={(data as TaskData).outputs ?? []}
                onChange={(v) => update({ outputs: v })}
                placeholder="e.g. CRM record"
              />
            </Field>

            <Field label="Data sources (comma separated)">
              <TagInput
                value={(data as TaskData).dataSources ?? []}
                onChange={(v) => update({ dataSources: v })}
                placeholder="e.g. Salesforce CRM"
              />
            </Field>

            <div className={styles.checkRow}>
              <label className={styles.checkLabel}>
                <input
                  type="checkbox"
                  checked={(data as TaskData).isManual ?? true}
                  onChange={(e) => update({ isManual: e.target.checked })}
                />
                Manual task
              </label>
              <label className={styles.checkLabel}>
                <input
                  type="checkbox"
                  checked={(data as TaskData).dataDriven ?? false}
                  onChange={(e) => update({ dataDriven: e.target.checked })}
                />
                Data-driven
              </label>
            </div>

            <Field label="Pain points">
              <textarea
                className={styles.textarea}
                value={(data as TaskData).painPoints ?? ''}
                onChange={(e) => update({ painPoints: e.target.value })}
                rows={3}
                placeholder="What slows this step down or makes it error-prone?"
              />
            </Field>
          </>
        )}
      </div>
    </aside>
  );
}
