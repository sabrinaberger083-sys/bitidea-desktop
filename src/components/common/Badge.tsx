import type { ReactNode } from 'react';

type Tone = 'default' | 'accent' | 'success' | 'danger' | 'warning';

interface BadgeProps {
  children: ReactNode;
  /** If true, prepends a colored pulse dot. */
  pulse?: boolean;
  tone?: Tone;
  className?: string;
}

export default function Badge({
  children,
  pulse = false,
  tone = 'default',
  className,
}: BadgeProps) {
  const toneClass =
    tone === 'accent'
      ? 'badge-accent'
      : tone === 'success'
      ? 'badge-success'
      : tone === 'danger'
      ? 'badge-danger'
      : tone === 'warning'
      ? 'badge-warning'
      : '';
  const dotClass =
    tone === 'success'
      ? 'pulse-dot success'
      : tone === 'danger'
      ? 'pulse-dot danger'
      : tone === 'warning'
      ? 'pulse-dot warning'
      : 'pulse-dot';
  return (
    <span className={`badge ${toneClass} ${className || ''}`}>
      {pulse && <span className={dotClass} aria-hidden />}
      {children}
    </span>
  );
}
