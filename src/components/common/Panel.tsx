import type { HTMLAttributes, ReactNode } from 'react';
import './Panel.css';

interface PanelProps extends HTMLAttributes<HTMLDivElement> {
  /** If true, adds 4 corner bracket decorations. */
  corners?: boolean;
  /** Subtle top gradient stripe (like concept-card::before). */
  topStripe?: boolean;
  /** Whether the panel should glow when the mouse enters. */
  hoverGlow?: boolean;
  children: ReactNode;
}

export default function Panel({
  corners = false,
  topStripe = false,
  hoverGlow = false,
  className,
  children,
  ...rest
}: PanelProps) {
  const cls = [
    'panel',
    topStripe ? 'panel-top-stripe' : '',
    hoverGlow ? 'panel-hover-glow' : '',
    className || '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={cls} {...rest}>
      {children}
      {corners && (
        <>
          <span className="bracket tl" aria-hidden />
          <span className="bracket tr" aria-hidden />
          <span className="bracket bl" aria-hidden />
          <span className="bracket br" aria-hidden />
        </>
      )}
    </div>
  );
}
