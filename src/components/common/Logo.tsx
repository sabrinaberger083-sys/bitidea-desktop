import './Logo.css';

type Size = 'sm' | 'md' | 'lg';

interface LogoProps {
  size?: Size;
  /** If true, suppresses the diamond ◆ glyph and shows only the wordmark. */
  wordmarkOnly?: boolean;
  /** If true, animates a subtle glow — useful on the welcome screen. */
  glow?: boolean;
}

const SIZE_PX: Record<Size, number> = { sm: 18, md: 28, lg: 84 };

export default function Logo({
  size = 'md',
  wordmarkOnly = false,
  glow = false,
}: LogoProps) {
  const px = SIZE_PX[size];
  return (
    <span
      className={`logo ${glow ? 'logo-glow' : ''}`}
      style={{ fontSize: px }}
      aria-label="Bitidea"
    >
      {!wordmarkOnly && <span className="logo-diamond">◆</span>}
      <span className="logo-word">BITIDEA</span>
    </span>
  );
}
