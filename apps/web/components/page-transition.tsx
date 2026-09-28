"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

// Keying by pathname forces React to remount on every navigation, replaying
// the fade without touching Next's own scroll-to-top behavior.
export function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div key={pathname} className="motion-safe:animate-[page-fade-in_320ms_ease-out]">
      {children}
    </div>
  );
}
