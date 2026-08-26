import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Placeholder brand palette — refine in Phase 2 when real UI is built.
        brand: {
          DEFAULT: "#1d4ed8",
          dark: "#1e293b",
        },
      },
    },
  },
  plugins: [],
};

export default config;
