import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  darkMode: ["class"],
  theme: {
    extend: {
      colors: {
        gold: { DEFAULT: "#d4b24c", light: "#e5cf94", dark: "#b8860b" },
        maroon: { DEFAULT: "#7a1e2c" },
      },
      fontFamily: {
        serif: ["var(--font-display)", "Cormorant Garamond", "Times New Roman", "serif"],
        sans: ["var(--font-ui-face)", "Source Sans 3", "Segoe UI", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "Cormorant Garamond", "serif"],
      },
      keyframes: {
        shimmer: {
          "0%": { backgroundPosition: "0% 50%" },
          "100%": { backgroundPosition: "100% 50%" },
        },
      },
      animation: {
        shimmer: "shimmer 4s ease infinite",
      },
    },
  },
  plugins: [],
};
export default config;
