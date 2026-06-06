import { useWorkflowStore } from '@/store/workflowStore';
import styles from './SettingsPanel.module.css';

interface SettingsPanelProps {
  onClose: () => void;
}

export default function SettingsPanel({ onClose }: SettingsPanelProps) {
  const {
    frequencies,
    personas,
    addFrequency,
    updateFrequency,
    deleteFrequency,
    addPersona,
    updatePersona,
    deletePersona,
  } = useWorkflowStore();

  const freqs = frequencies();
  const people = personas();

  return (
    <div className={styles.overlay}>
      <div className={styles.panel}>
        <div className={styles.header}>
          <h2 className={styles.heading}>Assumptions</h2>
          <button className="btn-ghost" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className={styles.body}>
          <section className={styles.section}>
            <div className={styles.sectionHead}>
              <h3 className={styles.sectionTitle}>Frequency categories</h3>
              <button className="btn-secondary" onClick={addFrequency}>
                ＋ Add
              </button>
            </div>
            <p className={styles.hint}>
              How many times each cadence fires per month across the whole org — used to turn
              per-run savings into monthly totals.
            </p>
            {freqs.length === 0 && <p className={styles.none}>No frequency categories yet.</p>}
            {freqs.map((f) => (
              <div key={f.id} className={styles.freqRow}>
                <input
                  className={styles.input}
                  value={f.label}
                  onChange={(e) => updateFrequency(f.id, { label: e.target.value })}
                  placeholder="e.g. per new customer"
                />
                <input
                  className={styles.num}
                  type="number"
                  min={0}
                  value={f.occurrencesPerMonth}
                  onChange={(e) =>
                    updateFrequency(f.id, { occurrencesPerMonth: Number(e.target.value) || 0 })
                  }
                  title="Occurrences per month"
                />
                <span className={styles.unit}>/mo</span>
                <button
                  className="btn-ghost"
                  onClick={() => deleteFrequency(f.id)}
                  title="Remove"
                >
                  ✕
                </button>
              </div>
            ))}
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHead}>
              <h3 className={styles.sectionTitle}>Personas</h3>
              <button className="btn-secondary" onClick={addPersona}>
                ＋ Add
              </button>
            </div>
            <p className={styles.hint}>
              Headcount and weekly hours per role — used to measure what share of each persona's
              capacity the mapped tasks consume.
            </p>
            <div className={styles.personaHeadRow}>
              <span>Role</span>
              <span>Workers</span>
              <span>Hrs/wk</span>
              <span />
            </div>
            {people.length === 0 && <p className={styles.none}>No personas yet.</p>}
            {people.map((p) => (
              <div key={p.id} className={styles.personaRow}>
                <input
                  className={styles.input}
                  value={p.role}
                  onChange={(e) => updatePersona(p.id, { role: e.target.value })}
                  placeholder="e.g. Customer Success Manager"
                />
                <input
                  className={styles.num}
                  type="number"
                  min={0}
                  value={p.workerCount}
                  onChange={(e) =>
                    updatePersona(p.id, { workerCount: Number(e.target.value) || 0 })
                  }
                  title="Number of workers"
                />
                <input
                  className={styles.num}
                  type="number"
                  min={0}
                  value={p.avgWeeklyHours}
                  onChange={(e) =>
                    updatePersona(p.id, { avgWeeklyHours: Number(e.target.value) || 0 })
                  }
                  title="Average weekly hours"
                />
                <button
                  className="btn-ghost"
                  onClick={() => deletePersona(p.id)}
                  title="Remove"
                >
                  ✕
                </button>
              </div>
            ))}
          </section>
        </div>
      </div>
    </div>
  );
}
