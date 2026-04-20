import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'danger';
type Size = 'sm' | 'md';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  /** If true, render a trailing arrow glyph. */
  arrow?: boolean;
  children: ReactNode;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', arrow = false, children, className, ...rest },
  ref,
) {
  const cls = [
    'btn',
    variant === 'primary' ? 'btn-primary' : '',
    variant === 'secondary' ? 'btn-secondary' : '',
    variant === 'danger' ? 'btn-danger' : '',
    size === 'sm' ? 'btn-sm' : '',
    className || '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button ref={ref} className={cls} {...rest}>
      <span>{children}</span>
      {arrow && <span className="arrow" aria-hidden>→</span>}
    </button>
  );
});

export default Button;
