// A fixed scatter of shapes in the wide-screen margins outside the
// content column: pointer-events-none and fixed so it never competes
// with anything clickable. Hidden below `lg:`, where the margins get too
// narrow for a shape to sit without drifting into the content column.
// Uses the base accent/pulse/ink colors at low opacity rather than the
// `-soft` badge tokens, which are tuned to sit invisibly behind badge
// text and read too pale against a light background. `motion-safe:`
// gives prefers-reduced-motion visitors the static scatter automatically.
//
// Rendered once in the root layout so every route gets it for free.
export function DecorativeBackground() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      {/* left margin, top to bottom */}
      <span className="absolute left-[3%] top-[10%] hidden h-8 w-8 rounded-full border-2 border-accent/35 motion-safe:animate-[decorative-drift_4s_ease-in-out_0s_infinite] lg:block" />
      <span className="absolute left-[8%] top-[16%] hidden h-2.5 w-2.5 rounded-full bg-pulse/45 motion-safe:animate-[decorative-drift-sm_2s_ease-in-out_0.4s_infinite] lg:block" />
      <span className="absolute left-[2%] top-[30%] hidden h-4 w-4 rounded-md border-2 border-ink/20 motion-safe:animate-[decorative-spin-cw_14s_linear_infinite] xl:block" />
      <span className="absolute left-[9%] top-[38%] hidden h-16 w-16 rounded-full border-2 border-ink/20 motion-safe:animate-[decorative-drift_6s_ease-in-out_0.8s_infinite] xl:block" />
      <span className="absolute left-[4%] top-[52%] hidden h-3 w-3 rounded-full bg-accent/40 motion-safe:animate-[decorative-drift-sm_2s_ease-in-out_1.2s_infinite] lg:block" />
      <span className="absolute left-[10%] top-[62%] hidden h-6 w-6 rounded-md border-2 border-pulse/35 motion-safe:animate-[decorative-spin-ccw_18s_linear_infinite] lg:block" />
      <span className="absolute left-[3%] top-[74%] hidden h-11 w-11 rounded-full border-2 border-accent/35 motion-safe:animate-[decorative-drift_4s_ease-in-out_0.3s_infinite] xl:block" />
      <span className="absolute left-[8%] top-[86%] hidden h-2 w-2 rounded-full bg-ink/25 motion-safe:animate-[decorative-drift-sm_2s_ease-in-out_0.9s_infinite] lg:block" />

      {/* right margin, top to bottom */}
      <span className="absolute right-[4%] top-[12%] hidden h-14 w-14 rounded-full border-2 border-ink/20 motion-safe:animate-[decorative-drift_6s_ease-in-out_0.6s_infinite] xl:block" />
      <span className="absolute right-[10%] top-[22%] hidden h-5 w-5 rounded-md border-2 border-accent/35 motion-safe:animate-[decorative-spin-cw_14s_linear_infinite] lg:block" />
      <span className="absolute right-[3%] top-[34%] hidden h-3 w-3 rounded-full bg-pulse/45 motion-safe:animate-[decorative-drift-sm_2s_ease-in-out_0.2s_infinite] lg:block" />
      <span className="absolute right-[9%] top-[46%] hidden h-9 w-9 rounded-full border-2 border-pulse/35 motion-safe:animate-[decorative-drift_4s_ease-in-out_1.1s_infinite] xl:block" />
      <span className="absolute right-[5%] top-[58%] hidden h-4 w-4 rounded-md border-2 border-ink/20 motion-safe:animate-[decorative-spin-ccw_18s_linear_infinite] lg:block" />
      <span className="absolute right-[11%] top-[68%] hidden h-2.5 w-2.5 rounded-full bg-accent/40 motion-safe:animate-[decorative-drift-sm_2s_ease-in-out_0s_infinite] lg:block" />
      <span className="absolute right-[4%] top-[80%] hidden h-20 w-20 rounded-full border-2 border-accent/35 motion-safe:animate-[decorative-drift_6s_ease-in-out_1.4s_infinite] xl:block" />
      <span className="absolute right-[10%] top-[90%] hidden h-3 w-3 rounded-full bg-ink/25 motion-safe:animate-[decorative-drift-sm_2s_ease-in-out_0.5s_infinite] lg:block" />
    </div>
  );
}
