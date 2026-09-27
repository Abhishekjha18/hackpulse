import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Each entry wraps a CSS custom property (defined in globals.css,
        // one value set under :root for light, another under
        // :root[data-theme="dark"]) rather than a static hex, so the
        // same "bg-accent" class renders correctly in both themes without
        // any dark: variant needed anywhere in JSX. The rgb(... /
        // <alpha-value>) form is what lets an opacity modifier like
        // `border-pulse/30` still work on top of a variable.
        paper: "rgb(var(--color-paper) / <alpha-value>)",
        surface: "rgb(var(--color-surface) / <alpha-value>)",
        "surface-alt": "rgb(var(--color-surface-alt) / <alpha-value>)",
        line: "rgb(var(--color-line) / <alpha-value>)",
        ink: "rgb(var(--color-ink) / <alpha-value>)",
        muted: "rgb(var(--color-muted) / <alpha-value>)",
        accent: {
          DEFAULT: "rgb(var(--color-accent) / <alpha-value>)",
          dark: "rgb(var(--color-accent-dark) / <alpha-value>)",
          soft: "rgb(var(--color-accent-soft) / <alpha-value>)",
        },
        pulse: {
          DEFAULT: "rgb(var(--color-pulse) / <alpha-value>)",
          soft: "rgb(var(--color-pulse-soft) / <alpha-value>)",
        },
        success: {
          DEFAULT: "rgb(var(--color-success) / <alpha-value>)",
          soft: "rgb(var(--color-success-soft) / <alpha-value>)",
        },
        warning: {
          DEFAULT: "rgb(var(--color-warning) / <alpha-value>)",
          soft: "rgb(var(--color-warning-soft) / <alpha-value>)",
        },
        danger: {
          DEFAULT: "rgb(var(--color-danger) / <alpha-value>)",
          soft: "rgb(var(--color-danger-soft) / <alpha-value>)",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "-apple-system", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      // Typography tokens — one size+leading+tracking bundle per heading
      // role, so a call site is `text-h1 font-semibold` instead of
      // hand-picking a size/leading/tracking combo per file. display/h1
      // use clamp() so they scale smoothly across viewport widths with no
      // breakpoint jump; h2/h3 are fixed (already close to the most common
      // existing sizes, so most pages barely shift — they mainly gain
      // proper leading/tracking and a consistent weight).
      fontSize: {
        display: [
          "clamp(1.75rem, 1.35rem + 2vw, 2.5rem)",
          { lineHeight: "1.1", letterSpacing: "-0.02em" },
        ],
        h1: [
          "clamp(1.375rem, 1.2rem + 0.85vw, 1.625rem)",
          { lineHeight: "1.2", letterSpacing: "-0.015em" },
        ],
        h2: ["1.125rem", { lineHeight: "1.3", letterSpacing: "-0.01em" }],
        h3: ["1rem", { lineHeight: "1.35", letterSpacing: "-0.005em" }],
      },
    },
  },
  plugins: [],
};

export default config;
