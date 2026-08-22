import { useWorkflowStore } from '@/store/workflowStore';
import styles from './Breadcrumbs.module.css';

export default function Breadcrumbs() {
  const { breadcrumbs, goToBreadcrumb, doc } = useWorkflowStore();
  const rootFlow = doc.flows.find(f => f.id === doc.rootFlowId);
  const companyName = rootFlow?.companyName;

  return (
    <nav className={styles.nav}>
      {companyName && (
        <>
          <span className={styles.company}>{companyName}</span>
          <span className={styles.sep}>›</span>
        </>
      )}
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
