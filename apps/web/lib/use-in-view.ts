"use client";

import { useCallback, useState } from "react";

// A thin IntersectionObserver wrapper for the landing page's scroll-reveal
// sections. Fires once, then disconnects — sections stay revealed once
// seen rather than re-hiding on scroll back up, which would read as busy
// rather than "not too much motion". The hidden pre-reveal state is only
// ever applied by the caller under a `motion-safe:` class, so a
// reduced-motion visitor sees fully visible content regardless of whether
// this ever fires.
//
// Found live: the "Happening now" and stats sections could end up
// permanently invisible. Both only exist in the DOM once an async fetch
// resolves (`{activeEvents && activeEvents.length > 0 && <section ...>}`).
// The previous version wired the observer in a plain `useEffect(..., [])`,
// which runs once right after the *page's* first mount — at that point the
// section hadn't rendered yet, so `ref.current` was null and the effect
// bailed out without ever creating an observer. Because that effect never
// runs again, nothing was ever watching the section once it actually
// appeared later. A callback ref fixes this at the root: it fires exactly
// when React attaches (or detaches) the DOM node, whenever that happens to
// be — not tied to when the *component* first mounted.
export function useInView<T extends HTMLElement>(): {
  ref: (node: T | null) => void;
  revealed: boolean;
} {
  const [revealed, setRevealed] = useState(false);

  const ref = useCallback((node: T | null) => {
    if (!node) {
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setRevealed(true);
          observer.disconnect();
        }
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.15 },
    );
    observer.observe(node);
  }, []);

  return { ref, revealed };
}
