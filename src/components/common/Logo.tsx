import type { CSSProperties } from 'react';
import './Logo.css';

type Size = 'sm' | 'md' | 'lg';

interface LogoProps {
  size?: Size;
  /** If true, suppresses the diamond ◆ glyph and shows only the wordmark. */
  wordmarkOnly?: boolean;
  /** If true, animates a subtle glow — useful on the welcome screen. */
  glow?: boolean;
  /** If true, reveals the wordmark with a staged brand animation. */
  animated?: boolean;
}

const SIZE_PX: Record<Size, number> = { sm: 18, md: 28, lg: 84 };

export default function Logo({
  size = 'md',
  wordmarkOnly = false,
  glow = false,
  animated = false,
}: LogoProps) {
  const px = SIZE_PX[size];
  const letters = 'BITIDEA'.split('');
  return (
    <span
      className={`logo ${glow ? 'logo-glow' : ''} ${animated ? 'logo-animated' : ''}`}
      style={{ fontSize: px }}
      aria-label="Bitidea"
    >
      {!wordmarkOnly && <span className="logo-diamond">◆</span>}
      {animated ? (
        <span className="logo-word logo-word-animated" aria-hidden>
          {letters.map((letter, index) => (
            <span
              key={`${letter}-${index}`}
              className="logo-letter"
              style={{ '--logo-letter-index': index } as CSSProperties}
            >
              {letter}
            </span>
          ))}
        </span>
      ) : (
        <span className="logo-word">BITIDEA</span>
      )}
    </span>
  );
}
