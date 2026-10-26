/** Purely decorative starfield. Hidden from assistive tech; the app works identically without it. */
export function CosmicBackground() {
  return (
    <div className="cosmic-bg" aria-hidden="true">
      <div className="cosmic-bg__nebula" />
      <div className="cosmic-bg__stars" />
    </div>
  );
}
