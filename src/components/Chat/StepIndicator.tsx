import type { StepEvent } from '../../types';
import './StepIndicator.css';

interface Props {
  step?: StepEvent;
  /** When true, render a subdued "active" variant. */
  active?: boolean;
}

/** `STEP 2/5 ◇◇◆◇◇` — compact multi-step progress pip. */
export default function StepIndicator({ step, active = false }: Props) {
  if (!step || step.n <= 0) return null;

  const { n, total } = step;
  // When we don't know the total, render a small spinner of three dots.
  const hasTotal = total > 0;
  const cap = hasTotal ? Math.min(total, 12) : 0;
  const pips = hasTotal
    ? Array.from({ length: cap }, (_, i) => (i < n ? '◆' : '◇'))
    : ['◆'];

  return (
    <span className={`step-pip ${active ? 'step-pip-active' : ''}`}>
      <span className="step-label">STEP</span>
      <span className="step-count">
        {n}
        {hasTotal ? `/${total}` : ''}
      </span>
      <span className="step-pips" aria-hidden>
        {pips.join('')}
      </span>
    </span>
  );
}
