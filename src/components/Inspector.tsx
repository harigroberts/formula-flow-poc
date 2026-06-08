import { useState } from 'react';
import { useWorkflowStore } from '@/store/workflowStore';
import type { TaskData, FlowRefData, DecisionData, TerminalData } from '@/types';
import styles from './Inspector.module.css';


const NEW_OPTION = '__new__';

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
  const {
    selectedNode,
    updateNodeData,
    deleteNode,
    setSelectedNode,
    frequencies,
    personas,
    addFrequency,
    addPersona,
    currentFlow,
    updateCurrentFlow,
  } = useWorkflowStore();
  const [collapsed, setCollapsed] = useState(false);

  const node = selectedNode();
  const flow = currentFlow();

  if (collapsed) {
    return (
      <aside className={`${styles.panel} ${styles.collapsed}`}>
        <button
          className={styles.expandBtn}
          onClick={() => setCollapsed(false)}
          title="Expand inspector"
        >
          <span className={styles.railIcon}>‹</span>
          <span className={styles.railLabel}>Inspector</span>
        </button>
      </aside>
    );
  }

  const isRoot = flow?.id === useWorkflowStore.getState().doc.rootFlowId;

  // When nothing is selected, show editable properties for the current flow.
  if (!node) {
    return (
      <aside className={styles.panel}>
        <div className={styles.header}>
          <button
            className={styles.collapseBtn}
            onClick={() => setCollapsed(true)}
            title="Collapse inspector"
          >
            ›
          </button>
          <h2 className={styles.heading}>Flow properties</h2>
        </div>
        <div className={styles.fields}>
          {isRoot && (
            <Field label="Company name">
              <input
                className={styles.input}
                value={flow?.companyName ?? ''}
                onChange={(e) =>
                  updateCurrentFlow({ companyName: e.target.value || undefined })
                }
                placeholder="e.g. Acme Corp"
              />
            </Field>
          )}
          <Field label="Name">
            <input
              className={styles.input}
              value={flow?.name ?? ''}
              onChange={(e) => updateCurrentFlow({ name: e.target.value })}
            />
          </Field>
          <Field label="Description">
            <textarea
              className={styles.textarea}
              value={flow?.description ?? ''}
              onChange={(e) => updateCurrentFlow({ description: e.target.value })}
              rows={3}
            />
          </Field>
          <Field label="Department">
            <input
              className={styles.input}
              value={flow?.department ?? ''}
              onChange={(e) => updateCurrentFlow({ department: e.target.value || undefined })}
              placeholder="e.g. Sales Operations"
            />
          </Field>
        </div>
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

  const handlePersonaChange = (value: string) => {
    if (value === NEW_OPTION) {
      const role = window.prompt('Name the new role / persona')?.trim();
      if (!role) return;
      const id = addPersona();
      // Rename the freshly-created persona to the entered label.
      useWorkflowStore.getState().updatePersona(id, { role });
      update({ personaId: id });
      return;
    }
    update({ personaId: value || undefined });
  };

  const handleFrequencyChange = (value: string) => {
    if (value === NEW_OPTION) {
      const label = window.prompt('Name the new frequency category')?.trim();
      if (!label) return;
      const id = addFrequency();
      useWorkflowStore.getState().updateFrequency(id, { label });
      update({ frequencyId: id });
      return;
    }
    update({ frequencyId: value || undefined });
  };

  const personaList = personas();
  const frequencyList = frequencies();

  return (
    <aside className={styles.panel}>
      <div className={styles.header}>
        <button
          className={styles.collapseBtn}
          onClick={() => setCollapsed(true)}
          title="Collapse inspector"
        >
          ›
        </button>
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

        {data.type === 'flow' && (
          <Field label="Department">
            <input
              className={styles.input}
              value={(data as FlowRefData).department ?? ''}
              onChange={(e) => update({ department: e.target.value || undefined })}
              placeholder="e.g. Sales Operations"
            />
          </Field>
        )}

        {(isDecision || isTerminal) && null}

        {isTask && (
          <>
            <Field label="Owner / Role">
              <select
                className={styles.select}
                value={(data as TaskData).personaId ?? ''}
                onChange={(e) => handlePersonaChange(e.target.value)}
              >
                <option value="">— Unassigned —</option>
                {personaList.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.role}
                  </option>
                ))}
                <option value={NEW_OPTION}>＋ New role…</option>
              </select>
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
                <select
                  className={styles.select}
                  value={(data as TaskData).frequencyId ?? ''}
                  onChange={(e) => handleFrequencyChange(e.target.value)}
                >
                  <option value="">— None —</option>
                  {frequencyList.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.label}
                    </option>
                  ))}
                  <option value={NEW_OPTION}>＋ New…</option>
                </select>
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
