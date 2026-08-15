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
        bg: {
          base: "#0D0F14",
          panel: "#141720",
          hover: "#1A1F2E",
          border: "#1E2330",
        },
        accent: {
          violet: "#7C6AF7",
          "violet-dim": "#5A4ED1",
          "violet-glow": "rgba(124,106,247,0.15)",
        },
        text: {
          primary: "#F0F2F8",
          secondary: "#9AA3B2",
          muted: "#4E5668",
        },
        status: {
          green: "#2DD4A0",
          red: "#F87171",
          yellow: "#FBBF24",
        },
      },
      fontFamily: {
        mono: ["JetBrains Mono", "Fira Code", "monospace"],
        sans: ["Inter", "system-ui", "sans-serif"],
      },
      animation: {
        pulse_slow: "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
      },
    },
  },
  plugins: [],
};

export default config;
