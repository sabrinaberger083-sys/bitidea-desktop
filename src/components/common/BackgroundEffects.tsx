/** Renders the three fixed layers that sit behind the whole app:
 *  - bg-layer: radial-gradient atmosphere + solid fallback
 *  - bg-grid: animated 48px grid masked by a radial fade
 *  - scanline: extremely faint CRT overlay
 *  All three layers are defined in tokens.css / globals.css.
 */
export default function BackgroundEffects() {
  return (
    <>
      <div className="bg-layer" aria-hidden />
      <div className="bg-grid" aria-hidden />
      <div className="scanline" aria-hidden />
    </>
  );
}
