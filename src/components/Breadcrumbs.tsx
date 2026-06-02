import { useWorkflowStore } from '@/store/workflowStore';
import styles from './Breadcrumbs.module.css';

export default function Breadcrumbs() {
  const { breadcrumbs, goToBreadcrumb } = useWorkflowStore();

  return (
    <nav className={styles.nav}>
      {breadcrumbs.map((crumb, i) => {
        const isLast = i === breadcrumbs.length - 1;
        return (
          <span key={crumb.flowId} className={styles.crumbGroup}>
            {i > 0 && <span className={styles.sep}>›</span>}
            <button
              className={`${styles.crumb} ${isLast ? styles.active : ''}`}
              onClick={() => !isLast && goToBreadcrumb(crumb.flowId)}
              disabled={isLast}
            >
              {crumb.name}
            </button>
          </span>
        );
      })}
    </nav>
  );
}
