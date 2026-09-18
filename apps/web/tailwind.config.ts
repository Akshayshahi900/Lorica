import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],

  theme: {
    extend: {
      colors: {
        // ─────────────────────────────────────────
        // SURFACES
        // ─────────────────────────────────────────
        bg: {
          base: "#08090A",
          panel: "#101113",
          hover: "#181A1D",
          border: "#26282C",
        },

        // ─────────────────────────────────────────
        // LORICA ACCENT
        // Existing names kept so components
        // don't need to be changed.
        // ─────────────────────────────────────────
        accent: {
          violet: "#5E6AD2",
          "violet-dim": "#4F5AB8",
          "violet-glow": "rgba(94, 106, 210, 0.16)",
        },

        // ─────────────────────────────────────────
        // TYPOGRAPHY
        // ─────────────────────────────────────────
        text: {
          primary: "#F7F8F8",
          secondary: "#B8BBC2",
          muted: "#8A8F98",
        },

        // ─────────────────────────────────────────
        // SYSTEM STATES
        // ─────────────────────────────────────────
        status: {
          green: "#35D6A5",
          red: "#F87171",
          yellow: "#F2C94C",
        },
      },

      // ─────────────────────────────────────────
      // TYPOGRAPHY
      // ─────────────────────────────────────────
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "Fira Code", "monospace"],
      },

      // ─────────────────────────────────────────
      // ANIMATION
      // ─────────────────────────────────────────
      animation: {
        pulse_slow:
          "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
      },

      // ─────────────────────────────────────────
      // SUBTLE ACCENT GLOWS
      // ─────────────────────────────────────────
      boxShadow: {
        "violet-sm": "0 0 20px rgba(94, 106, 210, 0.10)",
        "violet-md": "0 0 32px rgba(94, 106, 210, 0.14)",
      },
    },
  },

  plugins: [],
};

export default config;