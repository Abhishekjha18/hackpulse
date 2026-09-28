import "./globals.css";

import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import Script from "next/script";

import { DecorativeBackground } from "../components/decorative-background";
import { GraphPaperOverlay } from "../components/graph-paper-overlay";
import { Nav } from "../components/nav";
import { PageTransition } from "../components/page-transition";
import { AuthProvider } from "../lib/auth-context";
import { ThemeProvider } from "../lib/theme-context";

const sans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
  variable: "--font-sans",
  display: "swap",
});
const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "HackPulse",
  description: "A self-hosted, API-first hackathon submission-and-judging portal.",
};

// The app ships two considered themes (light default, dark opt-in via
// the navbar toggle), never an OS-driven third option — a browser that
// auto-forces dark mode on an undeclared-scheme page (Brave and Chrome
// both ship this) once repainted our custom palette and inverted image
// backgrounds, including the <select> chevron SVG, sitting it as an
// oversized block on top of the selected text. "light dark" here just
// tells the browser both are genuinely supported; :root's own
// `color-scheme` declaration in globals.css (kept in sync with the
// data-theme attribute below) is what actually controls which one
// renders, so the browser never has to guess.
export const viewport: Viewport = {
  colorScheme: "light dark",
};

// Runs before paint, blocking (a plain inline <script>, not deferred) —
// the only way to apply a stored dark-mode preference without a flash of
// the wrong theme on first render. Reads directly from localStorage
// rather than a cookie/header because the choice is purely a client-side
// preference with no server-rendering dependency on it.
const THEME_INIT_SCRIPT = `
(function () {
  try {
    if (localStorage.getItem("theme") === "dark") {
      document.documentElement.setAttribute("data-theme", "dark");
    }
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>
        <Script id="theme-init" strategy="beforeInteractive">
          {THEME_INIT_SCRIPT}
        </Script>
        <GraphPaperOverlay />
        <DecorativeBackground />
        <ThemeProvider>
          <AuthProvider>
            <Nav />
            <main className="mx-auto max-w-5xl px-4 py-8">
              <PageTransition>{children}</PageTransition>
            </main>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
