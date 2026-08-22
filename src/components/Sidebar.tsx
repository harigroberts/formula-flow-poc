import styles from './Sidebar.module.css';

function DraggableItem({ label, type, icon, iconColor, iconClass }: { label: string; type: string; icon: string; iconColor?: string; iconClass?: string }) {
  const onDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData('application/flow-node-type', type);
    e.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div className={styles.item} draggable onDragStart={onDragStart}>
      <span className={`${styles.icon} ${iconClass ?? ''}`} style={iconColor ? { color: iconColor } : undefined}>{icon}</span>
      <span className={styles.label}>{label}</span>
    </div>
  );
}

export default function Sidebar() {
  return (
    <aside className={styles.sidebar}>
      <div className={styles.section}>
        <h3 className={styles.heading}>Add to canvas</h3>
        <p className={styles.hint}>Drag onto the canvas</p>
        <DraggableItem label="Task" type="task" icon="✦" iconClass={styles.iconXL} />
        <DraggableItem label="Sub-flow" type="flow" icon="⚡" />
        <DraggableItem label="Decision" type="decision" icon="◆" iconClass={styles.iconLarge} />
        <DraggableItem label="Start" type="start" icon="▶" iconColor="var(--color-green)" iconClass={styles.iconLarge} />
        <DraggableItem label="End" type="end" icon="■" iconColor="var(--color-red)" iconClass={styles.iconLarge} />
      </div>
      <div className={styles.section}>
        <h3 className={styles.heading}>Tips</h3>
        <ul className={styles.tips}>
          <li>Connect nodes by dragging from a handle</li>
          <li>Double-click a sub-flow to drill in</li>
          <li>Select a node to edit its details</li>
          <li>Press Delete to remove selected</li>
        </ul>
      </div>
    </aside>
  );
}
