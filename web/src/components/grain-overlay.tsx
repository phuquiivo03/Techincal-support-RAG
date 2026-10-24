/**
 * Global paper-grain texture layer (see docs/DESIGN_GUIDE.md §3).
 * Purely decorative: fixed, above content, click-through.
 */
export function GrainOverlay() {
  return <div aria-hidden className="grain-overlay" />;
}
