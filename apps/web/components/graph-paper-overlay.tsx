// A pastel-blue square grid behind everything else, fixed and
// pointer-events-none like every other decorative layer in this app.
// Opacity comes from --graph-paper-opacity (globals.css) rather than a
// fixed value, since the same alpha reads far louder against a
// near-black dark-mode background than against light paper.
export function GraphPaperOverlay() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-20"
      style={{
        backgroundImage:
          "linear-gradient(rgb(147 197 253 / var(--graph-paper-opacity)) 1px, transparent 1px), " +
          "linear-gradient(90deg, rgb(147 197 253 / var(--graph-paper-opacity)) 1px, transparent 1px)",
        backgroundSize: "32px 32px",
      }}
    />
  );
}
