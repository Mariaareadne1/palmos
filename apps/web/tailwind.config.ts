import type { Config } from "tailwindcss";

/**
 * palmós theme — see globals.css for the token definitions.
 * Everything routes through CSS variables so the design system
 * has a single source of truth.
 */
const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/editor/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/perform/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    // Replace (not extend) color palette: black on white, two accents.
    colors: {
      transparent: "transparent",
      current: "currentColor",
      paper: "var(--paper)",
      "paper-warm": "var(--paper-warm)",
      ink: "var(--ink)",
      "ink-faint": "var(--ink-faint)",
      hairline: "var(--hairline)",
      "hairline-soft": "var(--hairline-soft)",
      accent: "var(--accent)",
      "accent-2": "var(--accent-2)",
    },
    fontFamily: {
      mono: ["var(--font-mono)", "ui-monospace", "monospace"],
    },
    fontSize: {
      // 11–13px UI text
      xs: ["11px", "16px"],
      sm: ["12px", "18px"],
      base: ["13px", "20px"],
      lg: ["16px", "22px"],
    },
    borderRadius: {
      // corners square or barely rounded
      none: "0",
      sm: "2px",
      DEFAULT: "0",
    },
    extend: {
      spacing: {
        "panel-l": "260px",
        "panel-r": "300px",
      },
    },
  },
  plugins: [],
};
export default config;
