import styles from './SubflowIcon.module.css';

/**
 * The sub-flow mark: a bolt drawn two-tone in the sub-flow hue — outline in the colour sub-flow
 * names are set in, infill a pale tint of it. Same construction as the Tangerine icon set
 * (24px grid, 1.75px stroke, round joins), but a broader bolt than its hand-drawn `i-bolt`, which
 * is too slender for the infill to show at 14–20px. Replaces the ⚡ emoji, which renders in the
 * platform's own yellow and ignores the text colour around it.
 */
export default function SubflowIcon({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg
      className={`${styles.icon} ${className ?? ''}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M13 2.5 L4.5 13.5 H11.5 L10.5 21.5 L19.5 10.5 H12.5 L13 2.5 Z" />
    </svg>
  );
}
