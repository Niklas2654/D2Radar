/** The neon radar behind the app (styles.css, .backdrop). */
export function Backdrop() {
  return (
    <div className="backdrop" aria-hidden>
      <div className="backdrop-glow" />
      <div className="backdrop-grid" />
    </div>
  );
}
